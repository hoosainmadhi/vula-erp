import { Router } from 'express';
import { getDb } from '../db.js';
import {
  authenticate,
  branchWarehouseId,
  effectiveWarehouseId,
  requirePermission,
} from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { ValidationError, notFound } from '../utils/errors.js';
import {
  optionalDate,
  optionalInt,
  optionalString,
  paramId,
  requireDate,
  requireEnum,
  requireInt,
  requireNumber,
  requireString,
} from '../utils/validate.js';
import { addDays, today } from '../utils/dates.js';
import {
  createInvoice,
  deleteDraftInvoice,
  getInvoice,
  postDraftInvoice,
  recordPayment,
} from '../services/invoices.js';
import { reverseInvoice } from '../services/accounting.js';
import { recordAudit } from '../services/audit.js';

export const invoicesRouter = Router();
invoicesRouter.use(authenticate);

invoicesRouter.get(
  '/',
  requirePermission('invoices.view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];

    if (req.query.direction === 'sale' || req.query.direction === 'purchase') {
      where.push('i.direction = ?');
      params.push(req.query.direction);
    }
    if (typeof req.query.status === 'string' && req.query.status !== 'all') {
      where.push('i.status = ?');
      params.push(req.query.status);
    }
    if (req.query.partnerId) {
      where.push('i.partner_id = ?');
      params.push(Number(req.query.partnerId));
    }
    if (req.query.warehouseId) {
      where.push('i.warehouse_id = ?');
      params.push(Number(req.query.warehouseId));
    }
    const branchScope = branchWarehouseId(req.user!);
    if (branchScope !== null) {
      where.push('i.warehouse_id = ?');
      params.push(branchScope);
    }
    if (req.query.from) {
      where.push('i.issue_date >= ?');
      params.push(String(req.query.from));
    }
    if (req.query.to) {
      where.push('i.issue_date <= ?');
      params.push(String(req.query.to));
    }
    if (req.query.overdue === 'true') {
      where.push("i.status = 'open' AND i.due_date < date('now')");
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where.push('(i.number LIKE ? OR p.name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }

    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const total = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM invoices i JOIN partners p ON p.id = i.partner_id ${whereSql}`,
        )
        .get(...params) as { count: number }
    ).count;
    const invoices = db
      .prepare(
        `SELECT i.*, p.name AS partner_name, w.name AS warehouse_name,
                COALESCE((SELECT SUM(c.total_cents) FROM credit_notes c
                          WHERE c.invoice_id = i.id AND c.status = 'posted'), 0) AS credited_cents,
                MAX(0, i.total_cents - i.amount_paid_cents -
                  COALESCE((SELECT SUM(c.total_cents) FROM credit_notes c
                            WHERE c.invoice_id = i.id AND c.status = 'posted'), 0)) AS outstanding_cents,
                CASE WHEN i.status = 'open' AND i.due_date < date('now') THEN 1 ELSE 0 END AS overdue
         FROM invoices i
         JOIN partners p ON p.id = i.partner_id
         LEFT JOIN warehouses w ON w.id = i.warehouse_id
         ${whereSql} ORDER BY i.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);

    const summary = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN i.direction = 'sale' AND i.status = 'open'
             THEN MAX(0, i.total_cents - i.amount_paid_cents -
               COALESCE((SELECT SUM(c.total_cents) FROM credit_notes c
                         WHERE c.invoice_id = i.id AND c.status = 'posted'), 0))
             END), 0) AS receivable_cents,
           COALESCE(SUM(CASE WHEN i.direction = 'purchase' AND i.status = 'open'
             THEN MAX(0, i.total_cents - i.amount_paid_cents -
               COALESCE((SELECT SUM(c.total_cents) FROM credit_notes c
                         WHERE c.invoice_id = i.id AND c.status = 'posted'), 0))
             END), 0) AS payable_cents
         FROM invoices i`,
      )
      .get();

    res.json({ invoices, total, summary });
  }),
);

invoicesRouter.get(
  '/payments',
  requirePermission('invoices.view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (req.query.direction === 'in' || req.query.direction === 'out') {
      where.push('pm.direction = ?');
      params.push(req.query.direction);
    }
    if (req.query.partnerId) {
      where.push('pm.partner_id = ?');
      params.push(Number(req.query.partnerId));
    }
    if (req.query.from) {
      where.push('pm.payment_date >= ?');
      params.push(String(req.query.from));
    }
    if (req.query.to) {
      where.push('pm.payment_date <= ?');
      params.push(String(req.query.to));
    }
    const payments = db
      .prepare(
        `SELECT pm.*, p.name AS partner_name, i.number AS invoice_number
         FROM payments pm
         JOIN partners p ON p.id = pm.partner_id
         LEFT JOIN invoices i ON i.id = pm.invoice_id
         WHERE ${where.join(' AND ')}
         ORDER BY pm.id DESC LIMIT 300`,
      )
      .all(...params);
    res.json({ payments });
  }),
);

invoicesRouter.get(
  '/:id',
  requirePermission('invoices.view'),
  asyncHandler(async (req, res) => {
    const invoice = getInvoice(paramId(req.params.id));
    const payments = getDb()
      .prepare(
        `SELECT id, number, payment_date, amount_cents, method, reference FROM payments WHERE invoice_id = ? ORDER BY id`,
      )
      .all(Number(req.params.id));
    res.json({ invoice, payments });
  }),
);

invoicesRouter.post(
  '/',
  requirePermission('invoices.manage'),
  asyncHandler(async (req, res) => {
    const direction = requireEnum(req.body?.direction, 'Direction', ['sale', 'purchase'] as const);
    const partnerId = requireInt(req.body?.partnerId, 'Partner', 1);
    const issueDate = requireDate(req.body?.issueDate, 'Issue date');
    const partner = getDb()
      .prepare('SELECT payment_terms_days FROM partners WHERE id = ?')
      .get(partnerId) as { payment_terms_days: number } | undefined;
    if (!partner) throw notFound('Partner not found');
    const dueDate =
      req.body?.dueDate === undefined
        ? addDays(issueDate, partner.payment_terms_days)
        : requireDate(req.body.dueDate, 'Due date');

    const rawLines = req.body?.lines;
    if (!Array.isArray(rawLines) || rawLines.length === 0) {
      throw new ValidationError('At least one invoice line is required');
    }
    const lines = rawLines.map((entry, index) => {
      const line = entry as Record<string, unknown>;
      const productId =
        line.productId === null || line.productId === undefined
          ? null
          : requireInt(line.productId, `Line ${index + 1} product`, 1);
      return {
        productId,
        description: requireString(line.description, `Line ${index + 1} description`, 500),
        quantity: requireNumber(line.quantity, `Line ${index + 1} quantity`, 0.0001),
        unitPriceCents: requireInt(line.unitPriceCents, `Line ${index + 1} price`, 0),
        taxRateBp: requireInt(line.taxRateBp ?? 0, `Line ${index + 1} tax rate`, 0, 10000),
      };
    });

    const invoice = createInvoice({
      direction,
      partnerId,
      issueDate,
      dueDate,
      notes: optionalString(req.body?.notes, 'Notes', 5000),
      warehouseId: effectiveWarehouseId(req.user!, optionalInt(req.body?.warehouseId, 'Branch', 1)),
      lines,
      post: req.body?.post !== false,
      userId: req.user!.id,
    });
    res.status(201).json({ invoice });
  }),
);

invoicesRouter.post(
  '/from-purchase-order/:id',
  requirePermission('invoices.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const order = db
      .prepare(
        `SELECT po.*, p.payment_terms_days FROM purchase_orders po
         JOIN partners p ON p.id = po.supplier_id WHERE po.id = ?`,
      )
      .get(id) as
      | (Record<string, unknown> & {
          status: string;
          supplier_id: number;
          payment_terms_days: number;
        })
      | undefined;
    if (!order) throw notFound('Purchase order not found');
    if (order.status === 'draft' || order.status === 'cancelled') {
      throw new ValidationError('Only confirmed or received purchase orders can be billed');
    }
    const existing = db
      .prepare('SELECT id, number FROM invoices WHERE purchase_order_id = ?')
      .get(id) as { id: number; number: string } | undefined;
    if (existing) throw new ValidationError(`This order is already billed as ${existing.number}`);

    const lines = db
      .prepare(
        `SELECT product_id, description, quantity, received_quantity, unit_cost_cents, tax_rate_bp
         FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY id`,
      )
      .all(id) as {
      product_id: number | null;
      description: string;
      quantity: number;
      received_quantity: number;
      unit_cost_cents: number;
      tax_rate_bp: number;
    }[];

    const issueDate =
      req.body?.issueDate === undefined ? today() : requireDate(req.body.issueDate, 'Issue date');
    const dueDate =
      req.body?.dueDate === undefined
        ? addDays(issueDate, order.payment_terms_days ?? 30)
        : requireDate(req.body.dueDate, 'Due date');

    const invoice = createInvoice({
      direction: 'purchase',
      partnerId: order.supplier_id,
      issueDate,
      dueDate,
      notes: typeof req.body?.notes === 'string' ? req.body.notes : null,
      purchaseOrderId: id,
      lines: lines.map((line) => ({
        productId: line.product_id,
        description: line.description,
        quantity: line.received_quantity > 0 ? line.received_quantity : line.quantity,
        unitPriceCents: line.unit_cost_cents,
        taxRateBp: line.tax_rate_bp,
      })),
      post: req.body?.post !== false,
      userId: req.user!.id,
    });

    res.status(201).json({ invoice });
  }),
);

invoicesRouter.post(
  '/:id/post',
  requirePermission('invoices.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    postDraftInvoice(id, req.user!.id);
    res.json({ invoice: getInvoice(id) });
  }),
);

invoicesRouter.post(
  '/:id/void',
  requirePermission('invoices.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const invoice = getDb()
      .prepare('SELECT status, amount_paid_cents FROM invoices WHERE id = ?')
      .get(id) as { status: string; amount_paid_cents: number } | undefined;
    if (!invoice) throw notFound('Invoice not found');
    if (invoice.amount_paid_cents > 0) {
      throw new ValidationError('Reverse the payments before voiding this invoice');
    }
    reverseInvoice(id);
    recordAudit(req.user!.id, 'void', 'invoice', id);
    res.json({ invoice: getInvoice(id) });
  }),
);

invoicesRouter.delete(
  '/:id',
  requirePermission('invoices.manage'),
  asyncHandler(async (req, res) => {
    deleteDraftInvoice(paramId(req.params.id), req.user!.id);
    res.json({ ok: true });
  }),
);

invoicesRouter.post(
  '/payments',
  requirePermission('invoices.manage'),
  asyncHandler(async (req, res) => {
    const direction = requireEnum(req.body?.direction, 'Direction', ['in', 'out'] as const);
    const partnerId = requireInt(req.body?.partnerId, 'Partner', 1);
    const invoiceId =
      req.body?.invoiceId === null || req.body?.invoiceId === undefined
        ? null
        : requireInt(req.body.invoiceId, 'Invoice', 1);
    const payment = recordPayment({
      partnerId,
      invoiceId,
      direction,
      paymentDate: requireDate(req.body?.paymentDate, 'Payment date'),
      amountCents: requireInt(req.body?.amountCents, 'Amount', 1),
      method:
        req.body?.method === undefined
          ? 'eft'
          : requireEnum(req.body.method, 'Method', [
              'cash',
              'bank',
              'card',
              'eft',
              'other',
            ] as const),
      reference: optionalString(req.body?.reference, 'Reference', 200),
      notes: optionalString(req.body?.notes, 'Notes', 1000),
      userId: req.user!.id,
    });
    res.status(201).json({ payment });
  }),
);
