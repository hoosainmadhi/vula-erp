import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { ValidationError, notFound } from '../utils/errors.js';
import {
  optionalCents,
  optionalDate,
  optionalString,
  paramId,
  requireCents,
  requireDate,
  requireInt,
  requireString,
} from '../utils/validate.js';
import { accountByCode } from '../services/accounting.js';
import { recordAudit } from '../services/audit.js';

export const bankingRouter = Router();
bankingRouter.use(authenticate);

const BANK_ACCOUNT_SELECT = `
  SELECT b.*, a.code AS gl_account_code, a.name AS gl_account_name
  FROM bank_accounts b LEFT JOIN accounts a ON a.id = b.gl_account_id`;

function bankAccountDetail(id: number) {
  const account = getDb().prepare(`${BANK_ACCOUNT_SELECT} WHERE b.id = ?`).get(id);
  if (!account) throw notFound('Bank account not found');
  return account;
}

bankingRouter.get(
  '/accounts',
  requirePermission('accounting.view'),
  asyncHandler(async (_req, res) => {
    const accounts = getDb()
      .prepare(`${BANK_ACCOUNT_SELECT} ORDER BY b.is_active DESC, b.name`)
      .all();
    res.json({ accounts });
  }),
);

bankingRouter.post(
  '/accounts',
  requirePermission('accounting.manage'),
  asyncHandler(async (req, res) => {
    const name = requireString(req.body?.name, 'Account name', 120);
    const glAccountId =
      req.body?.glAccountId === undefined
        ? accountByCode('1000').id
        : requireInt(req.body.glAccountId, 'GL account', 1);
    const db = getDb();
    if (!db.prepare('SELECT id FROM accounts WHERE id = ?').get(glAccountId)) {
      throw new ValidationError('GL account not found');
    }
    const result = db
      .prepare(
        `INSERT INTO bank_accounts
           (name, bank_name, account_number, gl_account_id, opening_balance_cents)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        optionalString(req.body?.bankName, 'Bank name', 120),
        optionalString(req.body?.accountNumber, 'Account number', 60),
        glAccountId,
        optionalCents(req.body?.openingBalanceCents, 'Opening balance') ?? 0,
      );
    const id = Number(result.lastInsertRowid);
    recordAudit(req.user!.id, 'create', 'bank_account', id);
    res.status(201).json({ account: bankAccountDetail(id) });
  }),
);

bankingRouter.get(
  '/transactions',
  requirePermission('accounting.view'),
  asyncHandler(async (req, res) => {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (req.query.bankAccountId) {
      where.push('t.bank_account_id = ?');
      params.push(Number(req.query.bankAccountId));
    }
    if (typeof req.query.status === 'string' && req.query.status !== 'all') {
      where.push('t.status = ?');
      params.push(req.query.status);
    }
    if (typeof req.query.from === 'string' && req.query.from !== '') {
      where.push('t.transaction_date >= ?');
      params.push(req.query.from);
    }
    if (typeof req.query.to === 'string' && req.query.to !== '') {
      where.push('t.transaction_date <= ?');
      params.push(req.query.to);
    }
    const transactions = getDb()
      .prepare(
        `SELECT t.*, je.number AS journal_number, je.description AS journal_description
         FROM bank_transactions t
         LEFT JOIN journal_entries je ON je.id = t.matched_journal_entry_id
         WHERE ${where.join(' AND ')}
         ORDER BY t.transaction_date DESC, t.id DESC LIMIT 1000`,
      )
      .all(...params);
    res.json({ transactions });
  }),
);

bankingRouter.post(
  '/transactions',
  requirePermission('accounting.manage'),
  asyncHandler(async (req, res) => {
    const bankAccountId = requireInt(req.body?.bankAccountId, 'Bank account', 1);
    if (!getDb().prepare('SELECT id FROM bank_accounts WHERE id = ?').get(bankAccountId)) {
      throw notFound('Bank account not found');
    }
    const amount = requireCents(req.body?.amountCents, 'Amount');
    if (amount === 0) throw new ValidationError('Amount cannot be zero');
    const result = getDb()
      .prepare(
        `INSERT INTO bank_transactions
           (bank_account_id, transaction_date, description, reference, amount_cents)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        bankAccountId,
        requireDate(req.body?.transactionDate, 'Transaction date'),
        requireString(req.body?.description, 'Description', 300),
        optionalString(req.body?.reference, 'Reference', 100),
        req.body?.direction === 'out' ? -amount : amount,
      );
    const id = Number(result.lastInsertRowid);
    recordAudit(req.user!.id, 'create', 'bank_transaction', id);
    res.status(201).json({
      transaction: getDb().prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id),
    });
  }),
);

/** Import statement lines from a pasted CSV: date,description,reference,amount[,direction]. */
bankingRouter.post(
  '/transactions/import',
  requirePermission('accounting.manage'),
  asyncHandler(async (req, res) => {
    const bankAccountId = requireInt(req.body?.bankAccountId, 'Bank account', 1);
    if (!getDb().prepare('SELECT id FROM bank_accounts WHERE id = ?').get(bankAccountId)) {
      throw notFound('Bank account not found');
    }
    const csv = requireString(req.body?.csv, 'CSV', 200_000);
    const lines = csv
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '');
    if (lines.length === 0) throw new ValidationError('CSV is empty');

    const db = getDb();
    const insert = db.prepare(
      `INSERT INTO bank_transactions
         (bank_account_id, transaction_date, description, reference, amount_cents)
       VALUES (?, ?, ?, ?, ?)`,
    );
    let imported = 0;
    const errors: string[] = [];
    const run = db.transaction(() => {
      for (const [index, line] of lines.entries()) {
        if (index === 0 && /date/i.test(line)) continue;
        const cells = line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
        if (cells.length < 4) {
          errors.push(`Line ${index + 1}: expected date,description,reference,amount`);
          continue;
        }
        const [date, description, reference, amountRaw] = cells;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
          errors.push(`Line ${index + 1}: date must be YYYY-MM-DD`);
          continue;
        }
        const amount = Math.round(Number((amountRaw ?? '').replace(/[^0-9.-]/g, '')) * 100);
        if (!Number.isFinite(amount) || amount === 0) {
          errors.push(`Line ${index + 1}: invalid amount`);
          continue;
        }
        insert.run(bankAccountId, date, description || 'Imported', reference || null, amount);
        imported += 1;
      }
    });
    run();
    recordAudit(req.user!.id, 'import', 'bank_transaction', bankAccountId, { imported });
    res.status(201).json({ imported, errors });
  }),
);

bankingRouter.get(
  '/candidates',
  requirePermission('accounting.view'),
  asyncHandler(async (req, res) => {
    const bankAccountId = requireInt(req.query.bankAccountId, 'Bank account', 1);
    const account = bankAccountDetail(bankAccountId) as {
      gl_account_id: number | null;
    };
    if (!account.gl_account_id) throw new ValidationError('Bank account has no GL account');
    const from = optionalDate(req.query.from, 'From date');
    const to = optionalDate(req.query.to, 'To date');

    const where = [
      'ji.account_id = ?',
      "je.status = 'posted'",
      `NOT EXISTS (
         SELECT 1 FROM bank_transactions t
         WHERE t.bank_account_id = ? AND t.matched_journal_entry_id = je.id
       )`,
    ];
    const params: unknown[] = [account.gl_account_id, bankAccountId];
    if (from) {
      where.push('je.entry_date >= ?');
      params.push(from);
    }
    if (to) {
      where.push('je.entry_date <= ?');
      params.push(to);
    }

    const candidates = getDb()
      .prepare(
        `SELECT je.id AS journal_entry_id, je.number, je.entry_date, je.description,
                ji.debit_cents, ji.credit_cents, ji.description AS line_description
         FROM journal_items ji
         JOIN journal_entries je ON je.id = ji.journal_entry_id
         WHERE ${where.join(' AND ')}
         ORDER BY je.entry_date DESC, je.id DESC LIMIT 500`,
      )
      .all(...params);
    res.json({ candidates });
  }),
);

bankingRouter.post(
  '/transactions/:id/match',
  requirePermission('accounting.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const journalEntryId = requireInt(req.body?.journalEntryId, 'Journal entry', 1);
    const db = getDb();
    const transaction = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id) as
      { bank_account_id: number; status: string } | undefined;
    if (!transaction) throw notFound('Bank transaction not found');
    const entry = db
      .prepare("SELECT id FROM journal_entries WHERE id = ? AND status = 'posted'")
      .get(journalEntryId);
    if (!entry) throw notFound('Journal entry not found');
    const already = db
      .prepare(
        'SELECT id FROM bank_transactions WHERE bank_account_id = ? AND matched_journal_entry_id = ? AND id <> ?',
      )
      .get(transaction.bank_account_id, journalEntryId, id);
    if (already) throw new ValidationError('That journal entry is already reconciled');

    db.prepare(
      "UPDATE bank_transactions SET status = 'reconciled', matched_journal_entry_id = ? WHERE id = ?",
    ).run(journalEntryId, id);
    recordAudit(req.user!.id, 'reconcile', 'bank_transaction', id, { journalEntryId });
    res.json({ ok: true });
  }),
);

bankingRouter.post(
  '/transactions/:id/unmatch',
  requirePermission('accounting.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb()
      .prepare(
        "UPDATE bank_transactions SET status = 'unreconciled', matched_journal_entry_id = NULL WHERE id = ?",
      )
      .run(id);
    if (result.changes === 0) throw notFound('Bank transaction not found');
    recordAudit(req.user!.id, 'unreconcile', 'bank_transaction', id);
    res.json({ ok: true });
  }),
);

bankingRouter.post(
  '/transactions/:id/ignore',
  requirePermission('accounting.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb()
      .prepare(
        "UPDATE bank_transactions SET status = 'ignored', matched_journal_entry_id = NULL WHERE id = ?",
      )
      .run(id);
    if (result.changes === 0) throw notFound('Bank transaction not found');
    recordAudit(req.user!.id, 'ignore', 'bank_transaction', id);
    res.json({ ok: true });
  }),
);

bankingRouter.get(
  '/summary',
  requirePermission('accounting.view'),
  asyncHandler(async (req, res) => {
    const bankAccountId = requireInt(req.query.bankAccountId, 'Bank account', 1);
    const account = bankAccountDetail(bankAccountId) as {
      gl_account_id: number | null;
      opening_balance_cents: number;
    };
    if (!account.gl_account_id) throw new ValidationError('Bank account has no GL account');

    const statement = getDb()
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS statement_cents,
                COALESCE(SUM(CASE WHEN status = 'reconciled' THEN amount_cents END), 0) AS reconciled_cents,
                COALESCE(SUM(CASE WHEN status = 'unreconciled' THEN amount_cents END), 0) AS unreconciled_cents,
                COUNT(*) AS transactions
         FROM bank_transactions WHERE bank_account_id = ?`,
      )
      .get(bankAccountId) as {
      statement_cents: number;
      reconciled_cents: number;
      unreconciled_cents: number;
      transactions: number;
    };
    const ledger = getDb()
      .prepare(
        `SELECT COALESCE(SUM(ji.debit_cents - ji.credit_cents), 0) AS ledger_cents
         FROM journal_items ji JOIN journal_entries je ON je.id = ji.journal_entry_id
         WHERE ji.account_id = ? AND je.status = 'posted'`,
      )
      .get(account.gl_account_id) as { ledger_cents: number };

    res.json({
      openingBalanceCents: account.opening_balance_cents,
      statementBalanceCents: account.opening_balance_cents + statement.statement_cents,
      reconciledBalanceCents: account.opening_balance_cents + statement.reconciled_cents,
      unreconciledCents: statement.unreconciled_cents,
      ledgerBalanceCents: ledger.ledger_cents,
      differenceCents:
        account.opening_balance_cents + statement.reconciled_cents - ledger.ledger_cents,
      transactions: statement.transactions,
    });
  }),
);
