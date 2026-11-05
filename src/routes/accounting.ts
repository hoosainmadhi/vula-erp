import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { ValidationError, notFound } from '../utils/errors.js';
import {
  optionalDate,
  optionalId,
  optionalString,
  paramId,
  requireDate,
  requireEnum,
  requireInt,
  requireString,
} from '../utils/validate.js';
import { monthEnd, monthStart, today } from '../utils/dates.js';
import {
  accountLedger,
  balanceSheet,
  postJournalEntry,
  profitAndLoss,
  trialBalance,
} from '../services/accounting.js';
import { recordAudit } from '../services/audit.js';

export const accountingRouter = Router();
accountingRouter.use(authenticate);

accountingRouter.get(
  '/accounts',
  requirePermission('accounting.view'),
  asyncHandler(async (_req, res) => {
    const accounts = getDb()
      .prepare(
        `SELECT a.*,
                COALESCE((SELECT COUNT(*) FROM journal_items ji WHERE ji.account_id = a.id), 0) AS entry_count
         FROM accounts a ORDER BY a.code`,
      )
      .all();
    res.json({ accounts });
  }),
);

accountingRouter.post(
  '/accounts',
  requirePermission('accounting.manage'),
  asyncHandler(async (req, res) => {
    const code = requireString(req.body?.code, 'Code', 20);
    const name = requireString(req.body?.name, 'Name', 150);
    const type = requireEnum(req.body?.type, 'Type', [
      'asset',
      'liability',
      'equity',
      'income',
      'expense',
    ] as const);
    try {
      const result = getDb()
        .prepare('INSERT INTO accounts (code, name, type, description) VALUES (?, ?, ?, ?)')
        .run(code, name, type, optionalString(req.body?.description, 'Description', 500));
      res.status(201).json({
        account: getDb()
          .prepare('SELECT * FROM accounts WHERE id = ?')
          .get(Number(result.lastInsertRowid)),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        throw new ValidationError('An account with that code already exists');
      }
      throw error;
    }
  }),
);

accountingRouter.put(
  '/accounts/:id',
  requirePermission('accounting.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb()
      .prepare(
        'UPDATE accounts SET name = ?, type = ?, description = ?, is_active = ? WHERE id = ?',
      )
      .run(
        requireString(req.body?.name, 'Name', 150),
        requireEnum(req.body?.type, 'Type', [
          'asset',
          'liability',
          'equity',
          'income',
          'expense',
        ] as const),
        optionalString(req.body?.description, 'Description', 500),
        req.body?.isActive === false ? 0 : 1,
        id,
      );
    if (result.changes === 0) throw notFound('Account not found');
    res.json({ account: getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id) });
  }),
);

accountingRouter.delete(
  '/accounts/:id',
  requirePermission('accounting.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const used = getDb()
      .prepare('SELECT COUNT(*) AS count FROM journal_items WHERE account_id = ?')
      .get(id) as {
      count: number;
    };
    if (used.count > 0)
      throw new ValidationError('This account has ledger entries and cannot be deleted');
    const result = getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('Account not found');
    res.json({ ok: true });
  }),
);

accountingRouter.get(
  '/journals',
  requirePermission('accounting.view'),
  asyncHandler(async (_req, res) => {
    res.json({ journals: getDb().prepare('SELECT * FROM journals ORDER BY code').all() });
  }),
);

accountingRouter.get(
  '/journal-entries',
  requirePermission('accounting.view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const where: string[] = ["je.status <> 'void'"];
    const params: unknown[] = [];
    if (req.query.from) {
      where.push('je.entry_date >= ?');
      params.push(String(req.query.from));
    }
    if (req.query.to) {
      where.push('je.entry_date <= ?');
      params.push(String(req.query.to));
    }
    if (req.query.journalId) {
      where.push('je.journal_id = ?');
      params.push(Number(req.query.journalId));
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where.push('(je.number LIKE ? OR je.description LIKE ? OR je.reference LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const limit = Math.min(Number(req.query.limit ?? 200), 500);
    const journalEntries = db
      .prepare(
        `SELECT je.*, j.code AS journal_code, j.name AS journal_name,
                (SELECT COALESCE(SUM(ji.debit_cents), 0) FROM journal_items ji WHERE ji.journal_entry_id = je.id) AS total_cents
         FROM journal_entries je JOIN journals j ON j.id = je.journal_id
         WHERE ${where.join(' AND ')}
         ORDER BY je.entry_date DESC, je.id DESC LIMIT ?`,
      )
      .all(...params, limit);
    res.json({ journalEntries });
  }),
);

accountingRouter.get(
  '/journal-entries/:id',
  requirePermission('accounting.view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const entry = db
      .prepare(
        `SELECT je.*, j.code AS journal_code, j.name AS journal_name
         FROM journal_entries je JOIN journals j ON j.id = je.journal_id WHERE je.id = ?`,
      )
      .get(paramId(req.params.id));
    if (!entry) throw notFound('Journal entry not found');
    const items = db
      .prepare(
        `SELECT ji.*, a.code AS account_code, a.name AS account_name, p.name AS partner_name
         FROM journal_items ji
         JOIN accounts a ON a.id = ji.account_id
         LEFT JOIN partners p ON p.id = ji.partner_id
         WHERE ji.journal_entry_id = ? ORDER BY ji.id`,
      )
      .all(Number(req.params.id));
    res.json({ journalEntry: entry, items });
  }),
);

accountingRouter.post(
  '/journal-entries',
  requirePermission('accounting.manage'),
  asyncHandler(async (req, res) => {
    const rawItems = req.body?.items;
    if (!Array.isArray(rawItems) || rawItems.length < 2) {
      throw new ValidationError('A journal entry needs at least two lines');
    }
    const items = rawItems.map((entry, index) => {
      const item = entry as Record<string, unknown>;
      return {
        accountId: requireInt(item.accountId, `Line ${index + 1} account`, 1),
        partnerId: optionalId(item.partnerId, `Line ${index + 1} partner`),
        description: optionalString(item.description, `Line ${index + 1} description`, 500),
        debitCents:
          item.debitCents === undefined || item.debitCents === null
            ? 0
            : requireInt(item.debitCents, `Line ${index + 1} debit`, 0),
        creditCents:
          item.creditCents === undefined || item.creditCents === null
            ? 0
            : requireInt(item.creditCents, `Line ${index + 1} credit`, 0),
      };
    });

    const id = postJournalEntry({
      journalCode: requireString(req.body?.journalCode, 'Journal', 10),
      entryDate: requireDate(req.body?.entryDate, 'Entry date'),
      description: requireString(req.body?.description, 'Description', 500),
      reference: optionalString(req.body?.reference, 'Reference', 200),
      userId: req.user!.id,
      items,
    });
    recordAudit(req.user!.id, 'post', 'journal_entry', id);
    res.status(201).json({ journalEntryId: id });
  }),
);

accountingRouter.get(
  '/reports/trial-balance',
  requirePermission('accounting.view'),
  asyncHandler(async (req, res) => {
    const asOf = optionalDate(req.query.asOf, 'As of date') ?? '9999-12-31';
    const rows = trialBalance(asOf);
    res.json({
      asOf,
      rows,
      totalDebitCents: rows.reduce((t, r) => t + r.debit_cents, 0),
      totalCreditCents: rows.reduce((t, r) => t + r.credit_cents, 0),
    });
  }),
);

accountingRouter.get(
  '/reports/profit-and-loss',
  requirePermission('accounting.view'),
  asyncHandler(async (req, res) => {
    const date = today();
    const from = optionalDate(req.query.from, 'From date') ?? monthStart(date);
    const to = optionalDate(req.query.to, 'To date') ?? monthEnd(date);
    res.json(profitAndLoss(from, to));
  }),
);

accountingRouter.get(
  '/reports/balance-sheet',
  requirePermission('accounting.view'),
  asyncHandler(async (req, res) => {
    const asOf = optionalDate(req.query.asOf, 'As of date') ?? today();
    res.json(balanceSheet(asOf));
  }),
);

accountingRouter.get(
  '/reports/aging',
  requirePermission('accounting.view'),
  asyncHandler(async (req, res) => {
    const asOf = optionalDate(req.query.asOf, 'As of date') ?? today();
    const direction = requireEnum(req.query.direction ?? 'sale', 'Direction', [
      'sale',
      'purchase',
    ] as const);
    const rows = getDb()
      .prepare(
        `SELECT i.id, i.number, i.partner_id, p.name AS partner_name,
                i.issue_date, i.due_date,
                i.total_cents - i.amount_paid_cents -
                  COALESCE((SELECT SUM(c.total_cents) FROM credit_notes c
                            WHERE c.invoice_id = i.id AND c.status = 'posted'), 0) AS balance_cents
         FROM invoices i
         JOIN partners p ON p.id = i.partner_id
         WHERE i.direction = ? AND i.status = 'open' AND i.issue_date <= ?
         ORDER BY p.name, i.due_date, i.id`,
      )
      .all(direction, asOf) as {
      id: number;
      number: string;
      partner_id: number;
      partner_name: string;
      issue_date: string;
      due_date: string;
      balance_cents: number;
    }[];

    const dayDiff = (dueDate: string): number =>
      Math.floor(
        (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) /
          (24 * 60 * 60 * 1000),
      );

    interface Buckets {
      current: number;
      days1_30: number;
      days31_60: number;
      days61_90: number;
      days90_plus: number;
      total: number;
    }
    const emptyBuckets = (): Buckets => ({
      current: 0,
      days1_30: 0,
      days31_60: 0,
      days61_90: 0,
      days90_plus: 0,
      total: 0,
    });

    const partners = new Map<
      number,
      { partner_id: number; partner_name: string; buckets: Buckets; invoices: number }
    >();
    const totals = emptyBuckets();

    for (const row of rows) {
      if (row.balance_cents <= 0) continue;
      const entry = partners.get(row.partner_id) ?? {
        partner_id: row.partner_id,
        partner_name: row.partner_name,
        buckets: emptyBuckets(),
        invoices: 0,
      };
      const days = dayDiff(row.due_date);
      const bucket =
        days <= 0
          ? 'current'
          : days <= 30
            ? 'days1_30'
            : days <= 60
              ? 'days31_60'
              : days <= 90
                ? 'days61_90'
                : 'days90_plus';
      entry.buckets[bucket] += row.balance_cents;
      entry.buckets.total += row.balance_cents;
      entry.invoices += 1;
      totals[bucket] += row.balance_cents;
      totals.total += row.balance_cents;
      partners.set(row.partner_id, entry);
    }

    res.json({
      asOf,
      direction,
      partners: [...partners.values()].sort((a, b) => b.buckets.total - a.buckets.total),
      totals,
    });
  }),
);

accountingRouter.get(
  '/reports/branches',
  requirePermission('accounting.view'),
  asyncHandler(async (req, res) => {
    const date = today();
    const from = optionalDate(req.query.from, 'From date') ?? monthStart(date);
    const to = optionalDate(req.query.to, 'To date') ?? monthEnd(date);
    const db = getDb();
    const warehouses = db.prepare('SELECT id, code, name FROM warehouses ORDER BY name').all() as {
      id: number;
      code: string;
      name: string;
    }[];
    const sales = db
      .prepare(
        `SELECT warehouse_id, COALESCE(SUM(subtotal_cents), 0) AS sales_cents,
                COALESCE(SUM(tax_cents), 0) AS vat_cents, COUNT(*) AS invoices
         FROM invoices
         WHERE direction = 'sale' AND status IN ('open', 'paid') AND issue_date BETWEEN ? AND ?
         GROUP BY warehouse_id`,
      )
      .all(from, to) as {
      warehouse_id: number | null;
      sales_cents: number;
      vat_cents: number;
      invoices: number;
    }[];
    const purchases = db
      .prepare(
        `SELECT warehouse_id, COALESCE(SUM(subtotal_cents), 0) AS purchases_cents,
                COUNT(*) AS bills
         FROM invoices
         WHERE direction = 'purchase' AND status IN ('open', 'paid') AND issue_date BETWEEN ? AND ?
         GROUP BY warehouse_id`,
      )
      .all(from, to) as { warehouse_id: number | null; purchases_cents: number; bills: number }[];
    const cogs = db
      .prepare(
        `SELECT sl.warehouse_id, COALESCE(SUM(-m.quantity * m.unit_cost_cents), 0) AS cogs_cents
         FROM stock_moves m
         JOIN stock_locations sl ON sl.id = m.location_id
         WHERE m.move_type = 'sale' AND date(m.created_at) BETWEEN ? AND ?
         GROUP BY sl.warehouse_id`,
      )
      .all(from, to) as { warehouse_id: number; cogs_cents: number }[];

    const rows: {
      warehouse_id: number | null;
      warehouse_code: string;
      warehouse_name: string;
      sales_cents: number;
      vat_cents: number;
      invoices: number;
      purchases_cents: number;
      bills: number;
      cogs_cents: number;
      gross_profit_cents: number;
      margin_bp: number;
    }[] = warehouses.map((warehouse) => {
      const sale = sales.find((row) => row.warehouse_id === warehouse.id);
      const purchase = purchases.find((row) => row.warehouse_id === warehouse.id);
      const cost = cogs.find((row) => row.warehouse_id === warehouse.id);
      const salesCents = sale?.sales_cents ?? 0;
      const cogsCents = cost?.cogs_cents ?? 0;
      return {
        warehouse_id: warehouse.id,
        warehouse_code: warehouse.code,
        warehouse_name: warehouse.name,
        sales_cents: salesCents,
        vat_cents: sale?.vat_cents ?? 0,
        invoices: sale?.invoices ?? 0,
        purchases_cents: purchase?.purchases_cents ?? 0,
        bills: purchase?.bills ?? 0,
        cogs_cents: cogsCents,
        gross_profit_cents: salesCents - cogsCents,
        margin_bp: salesCents > 0 ? Math.round(((salesCents - cogsCents) / salesCents) * 10000) : 0,
      };
    });
    const unassigned: (typeof rows)[number] = {
      warehouse_id: null,
      warehouse_code: '—',
      warehouse_name: 'Unassigned / no branch',
      sales_cents: sales.find((row) => row.warehouse_id === null)?.sales_cents ?? 0,
      vat_cents: sales.find((row) => row.warehouse_id === null)?.vat_cents ?? 0,
      invoices: sales.find((row) => row.warehouse_id === null)?.invoices ?? 0,
      purchases_cents: purchases.find((row) => row.warehouse_id === null)?.purchases_cents ?? 0,
      bills: purchases.find((row) => row.warehouse_id === null)?.bills ?? 0,
      cogs_cents: cogs.find((row) => row.warehouse_id === null)?.cogs_cents ?? 0,
      gross_profit_cents: 0,
      margin_bp: 0,
    };
    if (unassigned.sales_cents > 0 || unassigned.purchases_cents > 0) {
      unassigned.gross_profit_cents = unassigned.sales_cents - unassigned.cogs_cents;
      unassigned.margin_bp =
        unassigned.sales_cents > 0
          ? Math.round(
              ((unassigned.sales_cents - unassigned.cogs_cents) / unassigned.sales_cents) * 10000,
            )
          : 0;
      rows.push(unassigned);
    }

    const totals = rows.reduce(
      (total, row) => ({
        sales_cents: total.sales_cents + row.sales_cents,
        purchases_cents: total.purchases_cents + row.purchases_cents,
        cogs_cents: total.cogs_cents + row.cogs_cents,
        gross_profit_cents: total.gross_profit_cents + row.gross_profit_cents,
      }),
      { sales_cents: 0, purchases_cents: 0, cogs_cents: 0, gross_profit_cents: 0 },
    );
    res.json({ from, to, rows, totals });
  }),
);

accountingRouter.get(
  '/reports/ledger/:accountId',
  requirePermission('accounting.view'),
  asyncHandler(async (req, res) => {
    const accountId = paramId(req.params.accountId, 'account id');
    const date = today();
    const from = optionalDate(req.query.from, 'From date') ?? monthStart(date);
    const to = optionalDate(req.query.to, 'To date') ?? monthEnd(date);
    res.json(accountLedger(accountId, from, to));
  }),
);

accountingRouter.get(
  '/reports/vat',
  requirePermission('accounting.view'),
  asyncHandler(async (req, res) => {
    const date = today();
    const from = optionalDate(req.query.from, 'From date') ?? monthStart(date);
    const to = optionalDate(req.query.to, 'To date') ?? monthEnd(date);
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT a.code, a.name,
                COALESCE(SUM(ji.debit_cents), 0) AS debit_cents,
                COALESCE(SUM(ji.credit_cents), 0) AS credit_cents
         FROM journal_items ji
         JOIN journal_entries je ON je.id = ji.journal_entry_id
         JOIN accounts a ON a.id = ji.account_id
         WHERE je.status = 'posted' AND je.entry_date BETWEEN ? AND ? AND a.code IN ('1300', '2100')
         GROUP BY a.id ORDER BY a.code`,
      )
      .all(from, to) as { code: string; name: string; debit_cents: number; credit_cents: number }[];

    const output = rows.find((row) => row.code === '2100');
    const input = rows.find((row) => row.code === '1300');
    const outputVatCents = (output?.credit_cents ?? 0) - (output?.debit_cents ?? 0);
    const inputVatCents = (input?.debit_cents ?? 0) - (input?.credit_cents ?? 0);

    res.json({
      from,
      to,
      outputVatCents,
      inputVatCents,
      netVatCents: outputVatCents - inputVatCents,
      rows,
    });
  }),
);
