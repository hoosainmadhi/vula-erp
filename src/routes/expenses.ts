import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { ValidationError, notFound } from '../utils/errors.js';
import {
  optionalCents,
  optionalInt,
  optionalString,
  paramId,
  requireCents,
  requireDate,
  requireEnum,
  requireString,
} from '../utils/validate.js';
import { accountByCode, postJournalEntry } from '../services/accounting.js';
import { nextNumber } from '../services/sequences.js';
import { recordAudit } from '../services/audit.js';

export const expensesRouter = Router();
expensesRouter.use(authenticate);

const PAYMENT_METHODS = ['bank', 'cash', 'card', 'credit'] as const;
const DEFAULT_CATEGORIES = [
  'Rent',
  'Utilities',
  'Salaries',
  'Transport',
  'Consumables',
  'Repairs',
  'Marketing',
  'Bank charges',
  'General',
];

const EXPENSE_SELECT = `
  SELECT x.*, p.name AS supplier_name, a.code AS account_code, a.name AS account_name
  FROM expenses x
  LEFT JOIN partners p ON p.id = x.supplier_id
  LEFT JOIN accounts a ON a.id = x.account_id`;

function detail(id: number) {
  const expense = getDb().prepare(`${EXPENSE_SELECT} WHERE x.id = ?`).get(id);
  if (!expense) throw notFound('Expense not found');
  return expense;
}

function creditAccountFor(paymentMethod: string): number {
  if (paymentMethod === 'cash') return accountByCode('1010').id;
  if (paymentMethod === 'credit') return accountByCode('2000').id;
  return accountByCode('1000').id;
}

function postExpense(id: number, userId: number): void {
  const db = getDb();
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as
    | {
        id: number;
        number: string;
        expense_date: string;
        description: string;
        account_id: number | null;
        amount_cents: number;
        tax_cents: number;
        total_cents: number;
        payment_method: string;
        status: string;
        journal_entry_id: number | null;
      }
    | undefined;
  if (!expense) throw notFound('Expense not found');
  if (expense.status === 'posted') throw new ValidationError('Expense is already posted');
  if (expense.status === 'void') throw new ValidationError('Void expenses cannot be posted');
  if (expense.total_cents <= 0) throw new ValidationError('Expense amount must be positive');

  const items = [
    {
      accountId: expense.account_id ?? accountByCode('6300').id,
      debitCents: expense.amount_cents,
      description: `${expense.number} ${expense.description}`,
    },
    {
      accountId: creditAccountFor(expense.payment_method),
      creditCents: expense.total_cents,
      description: `Payment for ${expense.number}`,
    },
  ];
  if (expense.tax_cents > 0) {
    items.push({
      accountId: accountByCode('1300').id,
      debitCents: expense.tax_cents,
      description: `VAT input on ${expense.number}`,
    });
  }

  const journalId = postJournalEntry({
    journalCode: expense.payment_method === 'cash' ? 'CSH' : 'BNK',
    entryDate: expense.expense_date,
    description: `Expense ${expense.number}`,
    sourceType: 'expense',
    sourceId: expense.id,
    userId,
    items,
  });
  db.prepare(
    "UPDATE expenses SET status = 'posted', journal_entry_id = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(journalId, id);
}

expensesRouter.get(
  '/categories',
  requirePermission('expenses.view'),
  asyncHandler(async (_req, res) => {
    const rows = getDb()
      .prepare('SELECT DISTINCT category FROM expenses ORDER BY category')
      .all() as { category: string }[];
    const categories = [...new Set([...DEFAULT_CATEGORIES, ...rows.map((row) => row.category)])];
    res.json({ categories });
  }),
);

expensesRouter.get(
  '/',
  requirePermission('expenses.view'),
  asyncHandler(async (req, res) => {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (typeof req.query.status === 'string' && req.query.status !== 'all') {
      where.push('x.status = ?');
      params.push(req.query.status);
    }
    if (typeof req.query.category === 'string' && req.query.category !== '') {
      where.push('x.category = ?');
      params.push(req.query.category);
    }
    if (typeof req.query.from === 'string' && req.query.from !== '') {
      where.push('x.expense_date >= ?');
      params.push(req.query.from);
    }
    if (typeof req.query.to === 'string' && req.query.to !== '') {
      where.push('x.expense_date <= ?');
      params.push(req.query.to);
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where.push('(x.number LIKE ? OR x.description LIKE ? OR p.name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const expenses = getDb()
      .prepare(
        `${EXPENSE_SELECT} WHERE ${where.join(' AND ')} ORDER BY x.expense_date DESC, x.id DESC LIMIT 500`,
      )
      .all(...params);
    const totals = getDb()
      .prepare(
        `SELECT COALESCE(SUM(x.total_cents), 0) AS total_cents,
                COALESCE(SUM(CASE WHEN x.status = 'posted' THEN x.total_cents END), 0) AS posted_cents
         FROM expenses x LEFT JOIN partners p ON p.id = x.supplier_id
         WHERE ${where.join(' AND ')}`,
      )
      .get(...params) as { total_cents: number; posted_cents: number };
    res.json({ expenses, totals });
  }),
);

expensesRouter.get(
  '/:id',
  requirePermission('expenses.view'),
  asyncHandler(async (req, res) => {
    res.json({ expense: detail(paramId(req.params.id)) });
  }),
);

expensesRouter.post(
  '/',
  requirePermission('expenses.manage'),
  asyncHandler(async (req, res) => {
    const amount = requireCents(req.body?.amountCents, 'Net amount');
    const tax = optionalCents(req.body?.taxCents, 'VAT amount') ?? 0;
    if (amount + tax <= 0) throw new ValidationError('Expense amount must be positive');
    const paymentMethod =
      req.body?.paymentMethod === undefined
        ? 'bank'
        : requireEnum(req.body.paymentMethod, 'Payment method', PAYMENT_METHODS);
    const shouldPost = req.body?.post === true;
    const db = getDb();

    const id = db.transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO expenses
             (number, expense_date, category, description, supplier_id, account_id,
              amount_cents, tax_cents, total_cents, payment_method, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
        )
        .run(
          nextNumber('expense'),
          requireDate(req.body?.expenseDate, 'Expense date'),
          requireString(req.body?.category, 'Category', 80),
          requireString(req.body?.description, 'Description', 500),
          optionalInt(req.body?.supplierId, 'Supplier', 1),
          optionalInt(req.body?.accountId, 'Expense account', 1),
          amount,
          tax,
          amount + tax,
          paymentMethod,
          req.user!.id,
        );
      const expenseId = Number(result.lastInsertRowid);
      if (shouldPost) postExpense(expenseId, req.user!.id);
      return expenseId;
    })();

    recordAudit(req.user!.id, 'create', 'expense', id, { amount, tax, shouldPost });
    res.status(201).json({ expense: detail(id) });
  }),
);

expensesRouter.put(
  '/:id',
  requirePermission('expenses.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as
      | (Record<string, unknown> & {
          status: string;
          amount_cents: number;
          tax_cents: number;
          payment_method: string;
        })
      | undefined;
    if (!existing) throw notFound('Expense not found');
    if (existing.status !== 'draft') {
      throw new ValidationError('Only draft expenses can be edited');
    }
    const amount =
      req.body?.amountCents === undefined
        ? existing.amount_cents
        : requireCents(req.body.amountCents, 'Net amount');
    const tax =
      req.body?.taxCents === undefined
        ? existing.tax_cents
        : (optionalCents(req.body.taxCents, 'VAT amount') ?? 0);
    if (amount + tax <= 0) throw new ValidationError('Expense amount must be positive');

    db.prepare(
      `UPDATE expenses SET expense_date = ?, category = ?, description = ?, supplier_id = ?,
         account_id = ?, amount_cents = ?, tax_cents = ?, total_cents = ?, payment_method = ?,
         updated_at = datetime('now') WHERE id = ?`,
    ).run(
      req.body?.expenseDate === undefined
        ? existing.expense_date
        : requireDate(req.body.expenseDate, 'Expense date'),
      req.body?.category === undefined
        ? existing.category
        : requireString(req.body.category, 'Category', 80),
      req.body?.description === undefined
        ? existing.description
        : requireString(req.body.description, 'Description', 500),
      req.body?.supplierId === undefined
        ? (existing.supplier_id as number | null)
        : optionalInt(req.body.supplierId, 'Supplier', 1),
      req.body?.accountId === undefined
        ? (existing.account_id as number | null)
        : optionalInt(req.body.accountId, 'Expense account', 1),
      amount,
      tax,
      amount + tax,
      req.body?.paymentMethod === undefined
        ? existing.payment_method
        : requireEnum(req.body.paymentMethod, 'Payment method', PAYMENT_METHODS),
      id,
    );
    recordAudit(req.user!.id, 'update', 'expense', id);
    res.json({ expense: detail(id) });
  }),
);

expensesRouter.post(
  '/:id/post',
  requirePermission('expenses.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    getDb().transaction(() => postExpense(id, req.user!.id))();
    recordAudit(req.user!.id, 'post', 'expense', id);
    res.json({ expense: detail(id) });
  }),
);

expensesRouter.post(
  '/:id/void',
  requirePermission('expenses.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as
      { status: string; journal_entry_id: number | null; number: string } | undefined;
    if (!expense) throw notFound('Expense not found');
    if (expense.status === 'void') throw new ValidationError('Expense is already void');

    db.transaction(() => {
      if (expense.journal_entry_id) {
        const items = db
          .prepare(
            `SELECT account_id, description, debit_cents, credit_cents
             FROM journal_items WHERE journal_entry_id = ?`,
          )
          .all(expense.journal_entry_id) as {
          account_id: number;
          description: string | null;
          debit_cents: number;
          credit_cents: number;
        }[];
        const reversalId = postJournalEntry({
          journalCode: 'GEN',
          entryDate: new Date().toISOString().slice(0, 10),
          description: `Void expense ${expense.number}`,
          sourceType: 'expense_void',
          sourceId: id,
          userId: req.user!.id,
          items: items.map((item) => ({
            accountId: item.account_id,
            debitCents: item.credit_cents,
            creditCents: item.debit_cents,
            description: `Reversal: ${item.description ?? expense.number}`,
          })),
        });
        db.prepare(
          "UPDATE expenses SET status = 'void', journal_entry_id = ?, updated_at = datetime('now') WHERE id = ?",
        ).run(reversalId, id);
      } else {
        db.prepare(
          "UPDATE expenses SET status = 'void', updated_at = datetime('now') WHERE id = ?",
        ).run(id);
      }
    })();
    recordAudit(req.user!.id, 'void', 'expense', id);
    res.json({ expense: detail(id) });
  }),
);

expensesRouter.delete(
  '/:id',
  requirePermission('expenses.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const existing = getDb().prepare('SELECT status FROM expenses WHERE id = ?').get(id) as
      { status: string } | undefined;
    if (!existing) throw notFound('Expense not found');
    if (existing.status !== 'draft') {
      throw new ValidationError('Only draft expenses can be deleted; void posted expenses');
    }
    getDb().prepare('DELETE FROM expenses WHERE id = ?').run(id);
    recordAudit(req.user!.id, 'delete', 'expense', id);
    res.json({ ok: true });
  }),
);
