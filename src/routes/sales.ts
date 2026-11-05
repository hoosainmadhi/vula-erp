import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { ValidationError, notFound } from '../utils/errors.js';
import {
  optionalDate,
  optionalInt,
  optionalString,
  paramId,
  requireDate,
  requireInt,
  requireNumber,
} from '../utils/validate.js';
import { addDays, today } from '../utils/dates.js';
import { lineTotals } from '../utils/money.js';
import { nextNumber } from '../services/sequences.js';
import { recordAudit } from '../services/audit.js';
import { fulfilSalesOrder } from '../services/stock.js';
import { createInvoice } from '../services/invoices.js';

export const salesRouter = Router();
salesRouter.use(authenticate);

interface LineInput {
  productId?: number | null;
  description?: string;
  quantity: number;
  unitPriceCents?: number;
  taxRateBp?: number;
}

interface ResolvedLine {
  productId: number | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBp: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

function resolveLines(raw: unknown): ResolvedLine[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ValidationError('At least one order line is required');
  }
  const db = getDb();

  return raw.map((entry, index) => {
    const line = entry as LineInput;
    const productId = optionalInt(line.productId, `Line ${index + 1} product`, 1);
    let description = typeof line.description === 'string' ? line.description.trim() : '';
    let unitPriceCents =
      line.unitPriceCents === undefined
        ? null
        : requireInt(line.unitPriceCents, `Line ${index + 1} price`, 0);
    let taxRateBp =
      line.taxRateBp === undefined
        ? null
        : requireInt(line.taxRateBp, `Line ${index + 1} tax rate`, 0, 10000);

    if (productId !== null) {
      const product = db
        .prepare(
          `SELECT p.id, p.name, p.sale_price_cents, t.rate_bp
           FROM products p LEFT JOIN tax_rates t ON t.id = p.tax_rate_id WHERE p.id = ?`,
        )
        .get(productId) as
        { id: number; name: string; sale_price_cents: number; rate_bp: number | null } | undefined;
      if (!product) throw new ValidationError(`Line ${index + 1}: product not found`);
      if (!description) description = product.name;
      if (unitPriceCents === null) unitPriceCents = product.sale_price_cents;
      if (taxRateBp === null) taxRateBp = product.rate_bp ?? 0;
    }

    if (!description) throw new ValidationError(`Line ${index + 1}: description is required`);
    const quantity = requireNumber(line.quantity, `Line ${index + 1} quantity`, 0.0001);
    if (unitPriceCents === null) throw new ValidationError(`Line ${index + 1}: price is required`);
    const totals = lineTotals(quantity, unitPriceCents, taxRateBp ?? 0);

    return {
      productId,
      description,
      quantity,
      unitPriceCents,
      taxRateBp: taxRateBp ?? 0,
      ...totals,
    };
  });
}

function saveLines(salesOrderId: number, lines: ResolvedLine[]): void {
  const db = getDb();
  db.prepare('DELETE FROM sales_order_lines WHERE sales_order_id = ?').run(salesOrderId);
  const insert = db.prepare(
    `INSERT INTO sales_order_lines
       (sales_order_id, product_id, description, quantity, unit_price_cents, tax_rate_bp,
        line_subtotal_cents, line_tax_cents, line_total_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const line of lines) {
    insert.run(
      salesOrderId,
      line.productId,
      line.description,
      line.quantity,
      line.unitPriceCents,
      line.taxRateBp,
      line.subtotalCents,
      line.taxCents,
      line.totalCents,
    );
  }
}

interface SalesOrderLine {
  product_id: number | null;
  description: string;
  quantity: number;
  unit_price_cents: number;
  tax_rate_bp: number;
}

interface SalesOrderDetail extends Record<string, unknown> {
  status: string;
  customer_id: number;
  payment_terms_days: number;
  lines: SalesOrderLine[];
  invoices: unknown[];
}

function getSalesOrder(id: number): SalesOrderDetail {
  const db = getDb();
  const order = db
    .prepare(
      `SELECT so.*, p.name AS customer_name, p.email AS customer_email, p.vat_number AS customer_vat_number,
              p.payment_terms_days
       FROM sales_orders so JOIN partners p ON p.id = so.customer_id WHERE so.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!order) throw notFound('Sales order not found');
  const lines = db
    .prepare('SELECT * FROM sales_order_lines WHERE sales_order_id = ? ORDER BY id')
    .all(id) as SalesOrderLine[];
  const invoices = db
    .prepare(
      'SELECT id, number, status, total_cents, amount_paid_cents FROM invoices WHERE sales_order_id = ?',
    )
    .all(id);
  return { ...order, lines, invoices } as SalesOrderDetail;
}

salesRouter.get(
  '/',
  requirePermission('sales.view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (typeof req.query.status === 'string' && req.query.status !== 'all') {
      where.push('so.status = ?');
      params.push(req.query.status);
    }
    if (req.query.customerId) {
      where.push('so.customer_id = ?');
      params.push(Number(req.query.customerId));
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where.push('(so.number LIKE ? OR p.name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (req.query.from) {
      where.push('so.order_date >= ?');
      params.push(String(req.query.from));
    }
    if (req.query.to) {
      where.push('so.order_date <= ?');
      params.push(String(req.query.to));
    }

    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const total = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM sales_orders so JOIN partners p ON p.id = so.customer_id ${whereSql}`,
        )
        .get(...params) as { count: number }
    ).count;
    const salesOrders = db
      .prepare(
        `SELECT so.*, p.name AS customer_name,
                (SELECT COUNT(*) FROM sales_order_lines l WHERE l.sales_order_id = so.id) AS line_count
         FROM sales_orders so JOIN partners p ON p.id = so.customer_id
         ${whereSql} ORDER BY so.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);

    res.json({ salesOrders, total });
  }),
);

salesRouter.get(
  '/:id',
  requirePermission('sales.view'),
  asyncHandler(async (req, res) => {
    res.json({ salesOrder: getSalesOrder(paramId(req.params.id)) });
  }),
);

salesRouter.post(
  '/',
  requirePermission('sales.manage'),
  asyncHandler(async (req, res) => {
    const customerId = requireInt(req.body?.customerId, 'Customer', 1);
    const customer = getDb()
      .prepare('SELECT id, is_customer FROM partners WHERE id = ?')
      .get(customerId) as { id: number; is_customer: number } | undefined;
    if (!customer) throw notFound('Customer not found');
    if (customer.is_customer !== 1) throw new ValidationError('Selected partner is not a customer');

    const lines = resolveLines(req.body?.lines);
    const subtotal = lines.reduce((t, l) => t + l.subtotalCents, 0);
    const tax = lines.reduce((t, l) => t + l.taxCents, 0);

    const id = getDb().transaction(() => {
      const number = nextNumber('sales_order');
      const result = getDb()
        .prepare(
          `INSERT INTO sales_orders
             (number, customer_id, status, order_date, delivery_date, subtotal_cents, tax_cents, total_cents, notes, created_by)
           VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          number,
          customerId,
          requireDate(req.body?.orderDate, 'Order date'),
          optionalDate(req.body?.deliveryDate, 'Delivery date'),
          subtotal,
          tax,
          subtotal + tax,
          optionalString(req.body?.notes, 'Notes', 5000),
          req.user!.id,
        );
      const salesOrderId = Number(result.lastInsertRowid);
      saveLines(salesOrderId, lines);
      recordAudit(req.user!.id, 'create', 'sales_order', salesOrderId, {
        number,
        totalCents: subtotal + tax,
      });
      return salesOrderId;
    })();

    res.status(201).json({ salesOrder: getSalesOrder(id) });
  }),
);

salesRouter.put(
  '/:id',
  requirePermission('sales.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(id) as
      (Record<string, unknown> & { status: string; customer_id: number }) | undefined;
    if (!existing) throw notFound('Sales order not found');
    if (existing.status !== 'draft')
      throw new ValidationError('Only draft sales orders can be edited');

    const customerId =
      req.body?.customerId === undefined
        ? existing.customer_id
        : requireInt(req.body.customerId, 'Customer', 1);
    const lines = resolveLines(req.body?.lines);
    const subtotal = lines.reduce((t, l) => t + l.subtotalCents, 0);
    const tax = lines.reduce((t, l) => t + l.taxCents, 0);

    db.transaction(() => {
      db.prepare(
        `UPDATE sales_orders SET customer_id = ?, order_date = ?, delivery_date = ?, subtotal_cents = ?,
           tax_cents = ?, total_cents = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(
        customerId,
        req.body?.orderDate === undefined
          ? existing.order_date
          : requireDate(req.body.orderDate, 'Order date'),
        req.body?.deliveryDate === undefined
          ? (existing.delivery_date as string | null)
          : optionalDate(req.body.deliveryDate, 'Delivery date'),
        subtotal,
        tax,
        subtotal + tax,
        req.body?.notes === undefined
          ? (existing.notes as string | null)
          : optionalString(req.body.notes, 'Notes', 5000),
        id,
      );
      saveLines(id, lines);
      recordAudit(req.user!.id, 'update', 'sales_order', id, { totalCents: subtotal + tax });
    })();

    res.json({ salesOrder: getSalesOrder(id) });
  }),
);

salesRouter.post(
  '/:id/confirm',
  requirePermission('sales.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const order = db.prepare('SELECT status FROM sales_orders WHERE id = ?').get(id) as
      { status: string } | undefined;
    if (!order) throw notFound('Sales order not found');
    if (order.status !== 'draft') throw new ValidationError('Only draft orders can be confirmed');
    db.prepare(
      "UPDATE sales_orders SET status = 'confirmed', updated_at = datetime('now') WHERE id = ?",
    ).run(id);
    recordAudit(req.user!.id, 'confirm', 'sales_order', id);
    res.json({ salesOrder: getSalesOrder(id) });
  }),
);

salesRouter.post(
  '/:id/cancel',
  requirePermission('sales.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const order = db.prepare('SELECT status FROM sales_orders WHERE id = ?').get(id) as
      { status: string } | undefined;
    if (!order) throw notFound('Sales order not found');
    if (['fulfilled', 'invoiced'].includes(order.status)) {
      throw new ValidationError('A fulfilled or invoiced order cannot be cancelled');
    }
    db.prepare(
      "UPDATE sales_orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?",
    ).run(id);
    recordAudit(req.user!.id, 'cancel', 'sales_order', id);
    res.json({ salesOrder: getSalesOrder(id) });
  }),
);

salesRouter.post(
  '/:id/fulfil',
  requirePermission('sales.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const locationId = requireInt(req.body?.locationId, 'Location', 1);
    const result = fulfilSalesOrder(id, { locationId, userId: req.user!.id });
    recordAudit(req.user!.id, 'fulfil', 'sales_order', id, result);
    res.json({ salesOrder: getSalesOrder(id) });
  }),
);

salesRouter.post(
  '/:id/invoice',
  requirePermission('invoices.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const order = getSalesOrder(id);
    if (order.status === 'invoiced')
      throw new ValidationError('This order has already been invoiced');
    if (order.status !== 'fulfilled' && order.status !== 'confirmed') {
      throw new ValidationError('Confirm and fulfil the order before invoicing it');
    }

    const issueDate =
      req.body?.issueDate === undefined ? today() : requireDate(req.body.issueDate, 'Issue date');
    const dueDays = req.body?.dueDate === undefined ? Number(order.payment_terms_days ?? 30) : null;
    const dueDate =
      req.body?.dueDate === undefined
        ? addDays(issueDate, dueDays ?? 30)
        : requireDate(req.body.dueDate, 'Due date');

    const invoice = createInvoice({
      direction: 'sale',
      partnerId: order.customer_id,
      issueDate,
      dueDate,
      notes: typeof req.body?.notes === 'string' ? req.body.notes : null,
      salesOrderId: id,
      lines: order.lines.map((line) => ({
        productId: line.product_id,
        description: line.description,
        quantity: line.quantity,
        unitPriceCents: line.unit_price_cents,
        taxRateBp: line.tax_rate_bp,
      })),
      userId: req.user!.id,
    });

    res.status(201).json({ invoice, salesOrder: getSalesOrder(id) });
  }),
);
