import { getDb } from '../db.js';
import { ValidationError, notFound } from '../utils/errors.js';
import { nextNumber } from './sequences.js';

export interface JournalItemInput {
  accountId: number;
  partnerId?: number | null;
  description?: string | null;
  debitCents?: number;
  creditCents?: number;
}

export interface JournalEntryInput {
  journalCode: string;
  entryDate: string;
  description: string;
  reference?: string | null;
  sourceType?: string | null;
  sourceId?: number | null;
  userId?: number | null;
  items: JournalItemInput[];
}

export function accountByCode(code: string): { id: number; code: string; name: string } {
  const account = getDb()
    .prepare('SELECT id, code, name FROM accounts WHERE code = ?')
    .get(code) as { id: number; code: string; name: string } | undefined;
  if (!account) throw notFound(`Ledger account ${code} not found`);
  return account;
}

export function postJournalEntry(input: JournalEntryInput): number {
  const db = getDb();
  if (input.items.length < 2) throw new ValidationError('A journal entry needs at least two lines');

  let totalDebit = 0;
  let totalCredit = 0;
  for (const item of input.items) {
    const debit = item.debitCents ?? 0;
    const credit = item.creditCents ?? 0;
    if (debit < 0 || credit < 0) throw new ValidationError('Debits and credits cannot be negative');
    if (debit > 0 && credit > 0)
      throw new ValidationError('A journal line is either a debit or a credit');
    if (debit === 0 && credit === 0)
      throw new ValidationError('A journal line needs a debit or a credit');
    totalDebit += debit;
    totalCredit += credit;
  }
  if (totalDebit !== totalCredit) {
    throw new ValidationError(
      `Journal entry does not balance (debits ${totalDebit} vs credits ${totalCredit})`,
    );
  }

  if (input.sourceType && input.sourceId) {
    const existing = db
      .prepare('SELECT id FROM journal_entries WHERE source_type = ? AND source_id = ?')
      .get(input.sourceType, input.sourceId) as { id: number } | undefined;
    if (existing) return existing.id;
  }

  const journal = db.prepare('SELECT id FROM journals WHERE code = ?').get(input.journalCode) as
    { id: number } | undefined;
  if (!journal) throw notFound(`Journal ${input.journalCode} not found`);

  return db.transaction(() => {
    const number = nextNumber('journal_entry');
    const entry = db
      .prepare(
        `INSERT INTO journal_entries
           (number, journal_id, entry_date, reference, description, source_type, source_id, status, created_by, posted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?, datetime('now'))`,
      )
      .run(
        number,
        journal.id,
        input.entryDate,
        input.reference ?? null,
        input.description,
        input.sourceType ?? null,
        input.sourceId ?? null,
        input.userId ?? null,
      );
    const entryId = Number(entry.lastInsertRowid);
    const insertItem = db.prepare(
      `INSERT INTO journal_items (journal_entry_id, account_id, partner_id, description, debit_cents, credit_cents)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const item of input.items) {
      insertItem.run(
        entryId,
        item.accountId,
        item.partnerId ?? null,
        item.description ?? input.description,
        item.debitCents ?? 0,
        item.creditCents ?? 0,
      );
    }
    return entryId;
  })();
}

export function postSalesInvoice(invoiceId: number): number {
  const db = getDb();
  const invoice = db
    .prepare(
      `SELECT id, number, partner_id, subtotal_cents, tax_cents, total_cents, issue_date, journal_entry_id
       FROM invoices WHERE id = ? AND direction = 'sale'`,
    )
    .get(invoiceId) as
    | {
        id: number;
        number: string;
        partner_id: number;
        subtotal_cents: number;
        tax_cents: number;
        total_cents: number;
        issue_date: string;
        journal_entry_id: number | null;
      }
    | undefined;
  if (!invoice) throw notFound('Sales invoice not found');
  if (invoice.journal_entry_id) return invoice.journal_entry_id;

  const receivable = accountByCode('1100');
  const revenue = accountByCode('4000');
  const vatOutput = accountByCode('2100');

  const entryId = postJournalEntry({
    journalCode: 'SAL',
    entryDate: invoice.issue_date,
    description: `Sales invoice ${invoice.number}`,
    reference: invoice.number,
    sourceType: 'sales_invoice',
    sourceId: invoice.id,
    items: [
      {
        accountId: receivable.id,
        partnerId: invoice.partner_id,
        description: `Receivable — ${invoice.number}`,
        debitCents: invoice.total_cents,
      },
      {
        accountId: revenue.id,
        partnerId: invoice.partner_id,
        description: `Revenue — ${invoice.number}`,
        creditCents: invoice.subtotal_cents,
      },
      ...(invoice.tax_cents > 0
        ? [
            {
              accountId: vatOutput.id,
              partnerId: invoice.partner_id,
              description: `VAT output — ${invoice.number}`,
              creditCents: invoice.tax_cents,
            },
          ]
        : []),
    ],
  });

  db.prepare(
    "UPDATE invoices SET journal_entry_id = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(entryId, invoice.id);
  return entryId;
}

export function postPurchaseBill(invoiceId: number): number {
  const db = getDb();
  const invoice = db
    .prepare(
      `SELECT id, number, partner_id, subtotal_cents, tax_cents, total_cents, issue_date, journal_entry_id
       FROM invoices WHERE id = ? AND direction = 'purchase'`,
    )
    .get(invoiceId) as
    | {
        id: number;
        number: string;
        partner_id: number;
        subtotal_cents: number;
        tax_cents: number;
        total_cents: number;
        issue_date: string;
        journal_entry_id: number | null;
      }
    | undefined;
  if (!invoice) throw notFound('Supplier bill not found');
  if (invoice.journal_entry_id) return invoice.journal_entry_id;

  const inventory = accountByCode('1200');
  const expenses = accountByCode('6300');
  const vatInput = accountByCode('1300');
  const payable = accountByCode('2000');

  const lineSplit = db
    .prepare(
      `SELECT COALESCE(p.type, 'service') AS product_type, SUM(l.line_subtotal_cents) AS subtotal
       FROM invoice_lines l
       LEFT JOIN products p ON p.id = l.product_id
       WHERE l.invoice_id = ?
       GROUP BY COALESCE(p.type, 'service')`,
    )
    .all(invoice.id) as { product_type: string; subtotal: number }[];

  const goodsSubtotal = lineSplit.find((row) => row.product_type === 'goods')?.subtotal ?? 0;
  const serviceSubtotal = invoice.subtotal_cents - goodsSubtotal;

  const items: JournalItemInput[] = [];
  if (goodsSubtotal > 0) {
    items.push({
      accountId: inventory.id,
      description: `Inventory — ${invoice.number}`,
      debitCents: goodsSubtotal,
    });
  }
  if (serviceSubtotal > 0) {
    items.push({
      accountId: expenses.id,
      description: `Expenses — ${invoice.number}`,
      debitCents: serviceSubtotal,
    });
  }
  if (invoice.tax_cents > 0) {
    items.push({
      accountId: vatInput.id,
      description: `VAT input — ${invoice.number}`,
      debitCents: invoice.tax_cents,
    });
  }
  items.push({
    accountId: payable.id,
    partnerId: invoice.partner_id,
    description: `Payable — ${invoice.number}`,
    creditCents: invoice.total_cents,
  });

  const entryId = postJournalEntry({
    journalCode: 'PUR',
    entryDate: invoice.issue_date,
    description: `Supplier bill ${invoice.number}`,
    reference: invoice.number,
    sourceType: 'purchase_bill',
    sourceId: invoice.id,
    items,
  });

  db.prepare(
    "UPDATE invoices SET journal_entry_id = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(entryId, invoice.id);
  return entryId;
}

export function postPayment(paymentId: number): number {
  const db = getDb();
  const payment = db
    .prepare(
      `SELECT id, number, direction, partner_id, amount_cents, payment_date, method, journal_entry_id
       FROM payments WHERE id = ?`,
    )
    .get(paymentId) as
    | {
        id: number;
        number: string;
        direction: 'in' | 'out';
        partner_id: number;
        amount_cents: number;
        payment_date: string;
        method: string;
        journal_entry_id: number | null;
      }
    | undefined;
  if (!payment) throw notFound('Payment not found');
  if (payment.journal_entry_id) return payment.journal_entry_id;

  const bank = accountByCode('1000');
  const cash = accountByCode('1010');
  const receivable = accountByCode('1100');
  const payable = accountByCode('2000');
  const settlementAccount = payment.method === 'cash' ? cash : bank;

  const items: JournalItemInput[] =
    payment.direction === 'in'
      ? [
          {
            accountId: settlementAccount.id,
            description: `Receipt ${payment.number}`,
            debitCents: payment.amount_cents,
          },
          {
            accountId: receivable.id,
            partnerId: payment.partner_id,
            description: `Receivable settled ${payment.number}`,
            creditCents: payment.amount_cents,
          },
        ]
      : [
          {
            accountId: payable.id,
            partnerId: payment.partner_id,
            description: `Payable settled ${payment.number}`,
            debitCents: payment.amount_cents,
          },
          {
            accountId: settlementAccount.id,
            description: `Payment ${payment.number}`,
            creditCents: payment.amount_cents,
          },
        ];

  const entryId = postJournalEntry({
    journalCode: payment.method === 'cash' ? 'CSH' : 'BNK',
    entryDate: payment.payment_date,
    description: `Payment ${payment.number}`,
    reference: payment.number,
    sourceType: 'payment',
    sourceId: payment.id,
    items,
  });

  db.prepare('UPDATE payments SET journal_entry_id = ? WHERE id = ?').run(entryId, payment.id);
  return entryId;
}

export function reverseInvoice(invoiceId: number): number {
  const db = getDb();
  const invoice = db
    .prepare('SELECT id, number, issue_date, journal_entry_id, status FROM invoices WHERE id = ?')
    .get(invoiceId) as
    | {
        id: number;
        number: string;
        issue_date: string;
        journal_entry_id: number | null;
        status: string;
      }
    | undefined;
  if (!invoice) throw notFound('Invoice not found');
  if (invoice.status === 'void') throw new ValidationError('Invoice is already void');
  if (!invoice.journal_entry_id)
    throw new ValidationError('Invoice has not been posted to the ledger');

  const items = db
    .prepare(
      'SELECT account_id, partner_id, description, debit_cents, credit_cents FROM journal_items WHERE journal_entry_id = ?',
    )
    .all(invoice.journal_entry_id) as {
    account_id: number;
    partner_id: number | null;
    description: string;
    debit_cents: number;
    credit_cents: number;
  }[];

  const entryId = postJournalEntry({
    journalCode: 'GEN',
    entryDate: invoice.issue_date,
    description: `Void ${invoice.number}`,
    reference: invoice.number,
    sourceType: 'invoice_void',
    sourceId: invoice.id,
    items: items.map((item) => ({
      accountId: item.account_id,
      partnerId: item.partner_id,
      description: `Reversal — ${item.description}`,
      debitCents: item.credit_cents,
      creditCents: item.debit_cents,
    })),
  });

  db.prepare("UPDATE invoices SET status = 'void', updated_at = datetime('now') WHERE id = ?").run(
    invoice.id,
  );
  return entryId;
}

export function trialBalance(asOf?: string) {
  const db = getDb();
  const date = asOf ?? '9999-12-31';
  const rows = db
    .prepare(
      `SELECT a.code, a.name, a.type,
              COALESCE(SUM(CASE WHEN je.status = 'posted' AND je.entry_date <= ? THEN ji.debit_cents END), 0) AS debit_cents,
              COALESCE(SUM(CASE WHEN je.status = 'posted' AND je.entry_date <= ? THEN ji.credit_cents END), 0) AS credit_cents
       FROM accounts a
       LEFT JOIN journal_items ji ON ji.account_id = a.id
       LEFT JOIN journal_entries je ON je.id = ji.journal_entry_id
       GROUP BY a.id
       ORDER BY a.code`,
    )
    .all(date, date) as {
    code: string;
    name: string;
    type: string;
    debit_cents: number;
    credit_cents: number;
  }[];

  return rows.map((row) => ({
    ...row,
    balanceCents:
      row.type === 'asset' || row.type === 'expense'
        ? row.debit_cents - row.credit_cents
        : row.credit_cents - row.debit_cents,
  }));
}

export function profitAndLoss(from: string, to: string) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.code, a.name, a.type,
              COALESCE(SUM(ji.debit_cents), 0) AS debit_cents,
              COALESCE(SUM(ji.credit_cents), 0) AS credit_cents
       FROM accounts a
       JOIN journal_items ji ON ji.account_id = a.id
       JOIN journal_entries je ON je.id = ji.journal_entry_id
       WHERE je.status = 'posted' AND je.entry_date BETWEEN ? AND ? AND a.type IN ('income', 'expense')
       GROUP BY a.id
       ORDER BY a.code`,
    )
    .all(from, to) as {
    code: string;
    name: string;
    type: 'income' | 'expense';
    debit_cents: number;
    credit_cents: number;
  }[];

  const lines = rows.map((row) => ({
    ...row,
    amountCents:
      row.type === 'income'
        ? row.credit_cents - row.debit_cents
        : row.debit_cents - row.credit_cents,
  }));
  const incomeCents = lines
    .filter((l) => l.type === 'income')
    .reduce((t, l) => t + l.amountCents, 0);
  const expenseCents = lines
    .filter((l) => l.type === 'expense')
    .reduce((t, l) => t + l.amountCents, 0);
  return { from, to, lines, incomeCents, expenseCents, netProfitCents: incomeCents - expenseCents };
}

export function balanceSheet(asOf: string) {
  const rows = trialBalance(asOf).filter(
    (row) => row.type === 'asset' || row.type === 'liability' || row.type === 'equity',
  );
  const assets = rows
    .filter((r) => r.type === 'asset')
    .map((r) => ({ code: r.code, name: r.name, amountCents: r.debit_cents - r.credit_cents }))
    .filter((r) => r.amountCents !== 0);
  const liabilities = rows
    .filter((r) => r.type === 'liability')
    .map((r) => ({ code: r.code, name: r.name, amountCents: r.credit_cents - r.debit_cents }))
    .filter((r) => r.amountCents !== 0);
  const equity = rows
    .filter((r) => r.type === 'equity')
    .map((r) => ({ code: r.code, name: r.name, amountCents: r.credit_cents - r.debit_cents }))
    .filter((r) => r.amountCents !== 0);

  const pl = profitAndLoss('0000-01-01', asOf);
  const assetTotal = assets.reduce((t, r) => t + r.amountCents, 0);
  const liabilityTotal = liabilities.reduce((t, r) => t + r.amountCents, 0);
  const equityTotal = equity.reduce((t, r) => t + r.amountCents, 0);

  return {
    asOf,
    assets,
    liabilities,
    equity,
    assetTotalCents: assetTotal,
    liabilityTotalCents: liabilityTotal,
    equityTotalCents: equityTotal,
    retainedEarningsCents: pl.netProfitCents,
  };
}

export function accountLedger(accountId: number, from: string, to: string) {
  const db = getDb();
  const account = db
    .prepare('SELECT id, code, name, type FROM accounts WHERE id = ?')
    .get(accountId) as { id: number; code: string; name: string; type: string } | undefined;
  if (!account) throw notFound('Account not found');

  const lines = db
    .prepare(
      `SELECT je.id AS journal_entry_id, je.number, je.entry_date, je.description, je.reference,
              ji.debit_cents, ji.credit_cents, ji.description AS line_description
       FROM journal_items ji
       JOIN journal_entries je ON je.id = ji.journal_entry_id
       WHERE ji.account_id = ? AND je.status = 'posted' AND je.entry_date BETWEEN ? AND ?
       ORDER BY je.entry_date, je.id`,
    )
    .all(accountId, from, to) as {
    journal_entry_id: number;
    number: string;
    entry_date: string;
    description: string;
    reference: string | null;
    debit_cents: number;
    credit_cents: number;
    line_description: string | null;
  }[];

  const opening = db
    .prepare(
      `SELECT COALESCE(SUM(ji.debit_cents), 0) AS debit, COALESCE(SUM(ji.credit_cents), 0) AS credit
       FROM journal_items ji JOIN journal_entries je ON je.id = ji.journal_entry_id
       WHERE ji.account_id = ? AND je.status = 'posted' AND je.entry_date < ?`,
    )
    .get(accountId, from) as { debit: number; credit: number };

  const debitFirst = account.type === 'asset' || account.type === 'expense';
  const openingBalance = debitFirst
    ? opening.debit - opening.credit
    : opening.credit - opening.debit;
  let balance = openingBalance;
  const result = lines.map((line) => {
    balance += debitFirst
      ? line.debit_cents - line.credit_cents
      : line.credit_cents - line.debit_cents;
    return { ...line, balanceCents: balance };
  });

  return {
    account,
    openingBalanceCents: openingBalance,
    lines: result,
    closingBalanceCents: balance,
  };
}
