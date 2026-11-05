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
import { lineTotals } from '../utils/money.js';
import { nextNumber } from '../services/sequences.js';
import { recordAudit } from '../services/audit.js';

export const quotationsRouter = Router();
quotationsRouter.use(authenticate);

const STATUSES = ['draft', 'sent', 'accepted', 'expired', 'converted', 'cancelled'] as const;

interface QuoteLineInput {
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
    throw new ValidationError('At least one quotation line is required');
  }
  const db = getDb();
  return raw.map((entry, index) => {
    const line = entry as QuoteLineInput;
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

function saveLines(quotationId: number, lines: ResolvedLine[]): void {
  const db = getDb();
  db.prepare('DELETE FROM quotation_lines WHERE quotation_id = ?').run(quotationId);
  const insert = db.prepare(
    `INSERT INTO quotation_lines
       (quotation_id, product_id, description, quantity, unit_price_cents, tax_rate_bp,
        line_subtotal_cents, line_tax_cents, line_total_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const line of lines) {
    insert.run(
      quotationId,
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

function quoteDetail(id: number) {
  const db = getDb();
  const quotation = db
    .prepare(
      `SELECT q.*, p.name AS customer_name, p.email AS customer_email,
              p.vat_number AS customer_vat_number, p.address_line1 AS customer_address,
              w.name AS warehouse_name
       FROM quotations q
       JOIN partners p ON p.id = q.customer_id
       LEFT JOIN warehouses w ON w.id = q.warehouse_id
       WHERE q.id = ?`,
    )
    .get(id);
  if (!quotation) throw notFound('Quotation not found');
  const lines = db
    .prepare('SELECT * FROM quotation_lines WHERE quotation_id = ? ORDER BY id')
    .all(id);
  return { ...(quotation as Record<string, unknown>), lines };
}

quotationsRouter.get(
  '/',
  requirePermission('sales.view'),
  asyncHandler(async (req, res) => {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (typeof req.query.status === 'string' && req.query.status !== 'all') {
      where.push('q.status = ?');
      params.push(req.query.status);
    }
    if (req.query.customerId) {
      where.push('q.customer_id = ?');
      params.push(Number(req.query.customerId));
    }
    if (req.query.warehouseId) {
      where.push('q.warehouse_id = ?');
      params.push(Number(req.query.warehouseId));
    }
    const branchScope = branchWarehouseId(req.user!);
    if (branchScope !== null) {
      where.push('q.warehouse_id = ?');
      params.push(branchScope);
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where.push('(q.number LIKE ? OR p.name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    const quotations = getDb()
      .prepare(
        `SELECT q.*, p.name AS customer_name, w.name AS warehouse_name,
                (SELECT COUNT(*) FROM quotation_lines l WHERE l.quotation_id = q.id) AS line_count
         FROM quotations q
         JOIN partners p ON p.id = q.customer_id
         LEFT JOIN warehouses w ON w.id = q.warehouse_id
         WHERE ${where.join(' AND ')}
         ORDER BY q.id DESC LIMIT 300`,
      )
      .all(...params);
    res.json({ quotations });
  }),
);

quotationsRouter.get(
  '/:id',
  requirePermission('sales.view'),
  asyncHandler(async (req, res) => {
    res.json({ quotation: quoteDetail(paramId(req.params.id)) });
  }),
);

quotationsRouter.post(
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
    const subtotal = lines.reduce((total, line) => total + line.subtotalCents, 0);
    const tax = lines.reduce((total, line) => total + line.taxCents, 0);

    const id = getDb().transaction(() => {
      const number = nextNumber('quotation');
      const result = getDb()
        .prepare(
          `INSERT INTO quotations
             (number, customer_id, warehouse_id, status, quote_date, valid_until,
              subtotal_cents, tax_cents, total_cents, notes, created_by)
           VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          number,
          customerId,
          effectiveWarehouseId(req.user!, optionalInt(req.body?.warehouseId, 'Branch', 1)),
          requireDate(req.body?.quoteDate, 'Quote date'),
          optionalDate(req.body?.validUntil, 'Valid until'),
          subtotal,
          tax,
          subtotal + tax,
          optionalString(req.body?.notes, 'Notes', 5000),
          req.user!.id,
        );
      const quotationId = Number(result.lastInsertRowid);
      saveLines(quotationId, lines);
      return quotationId;
    })();

    recordAudit(req.user!.id, 'create', 'quotation', id);
    res.status(201).json({ quotation: quoteDetail(id) });
  }),
);

quotationsRouter.put(
  '/:id',
  requirePermission('sales.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM quotations WHERE id = ?').get(id) as
      | (Record<string, unknown> & { status: string; customer_id: number; quote_date: string })
      | undefined;
    if (!existing) throw notFound('Quotation not found');
    if (existing.status !== 'draft') {
      throw new ValidationError('Only draft quotations can be edited');
    }
    const customerId =
      req.body?.customerId === undefined
        ? existing.customer_id
        : requireInt(req.body.customerId, 'Customer', 1);
    const lines = resolveLines(req.body?.lines);
    const subtotal = lines.reduce((total, line) => total + line.subtotalCents, 0);
    const tax = lines.reduce((total, line) => total + line.taxCents, 0);

    db.transaction(() => {
      db.prepare(
        `UPDATE quotations SET customer_id = ?, warehouse_id = ?, quote_date = ?, valid_until = ?,
           subtotal_cents = ?, tax_cents = ?, total_cents = ?, notes = ?,
           updated_at = datetime('now') WHERE id = ?`,
      ).run(
        customerId,
        effectiveWarehouseId(
          req.user!,
          req.body?.warehouseId === undefined
            ? (existing.warehouse_id as number | null)
            : optionalInt(req.body.warehouseId, 'Branch', 1),
        ),
        req.body?.quoteDate === undefined
          ? existing.quote_date
          : requireDate(req.body.quoteDate, 'Quote date'),
        req.body?.validUntil === undefined
          ? (existing.valid_until as string | null)
          : optionalDate(req.body.validUntil, 'Valid until'),
        subtotal,
        tax,
        subtotal + tax,
        req.body?.notes === undefined
          ? (existing.notes as string | null)
          : optionalString(req.body.notes, 'Notes', 5000),
        id,
      );
      saveLines(id, lines);
    })();
    recordAudit(req.user!.id, 'update', 'quotation', id);
    res.json({ quotation: quoteDetail(id) });
  }),
);

quotationsRouter.post(
  '/:id/status',
  requirePermission('sales.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const status = requireEnum(req.body?.status, 'Status', STATUSES);
    const db = getDb();
    const existing = db.prepare('SELECT status FROM quotations WHERE id = ?').get(id) as
      { status: string } | undefined;
    if (!existing) throw notFound('Quotation not found');
    if (existing.status === 'converted')
      throw new ValidationError('Quotation is already converted');
    db.prepare("UPDATE quotations SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
      status,
      id,
    );
    recordAudit(req.user!.id, `status:${status}`, 'quotation', id);
    res.json({ quotation: quoteDetail(id) });
  }),
);

quotationsRouter.post(
  '/:id/convert',
  requirePermission('sales.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const quotation = db.prepare('SELECT * FROM quotations WHERE id = ?').get(id) as
      | (Record<string, unknown> & {
          status: string;
          customer_id: number;
          warehouse_id: number | null;
          subtotal_cents: number;
          tax_cents: number;
          total_cents: number;
          notes: string | null;
        })
      | undefined;
    if (!quotation) throw notFound('Quotation not found');
    if (quotation.status === 'converted') {
      throw new ValidationError('Quotation has already been converted');
    }
    if (quotation.status === 'cancelled') {
      throw new ValidationError('Cancelled quotations cannot be converted');
    }
    const scope = branchWarehouseId(req.user!);
    if (scope !== null && quotation.warehouse_id !== null && quotation.warehouse_id !== scope) {
      throw new ValidationError('This quotation belongs to another branch');
    }
    const orderWarehouseId = effectiveWarehouseId(req.user!, quotation.warehouse_id);
    const lines = db
      .prepare('SELECT * FROM quotation_lines WHERE quotation_id = ? ORDER BY id')
      .all(id) as {
      product_id: number | null;
      description: string;
      quantity: number;
      unit_price_cents: number;
      tax_rate_bp: number;
      line_subtotal_cents: number;
      line_tax_cents: number;
      line_total_cents: number;
    }[];

    const salesOrderId = db.transaction(() => {
      const number = nextNumber('sales_order');
      const result = db
        .prepare(
          `INSERT INTO sales_orders
             (number, customer_id, warehouse_id, status, order_date, delivery_date,
              subtotal_cents, tax_cents, total_cents, notes, created_by)
           VALUES (?, ?, ?, 'draft', ?, NULL, ?, ?, ?, ?, ?)`,
        )
        .run(
          number,
          quotation.customer_id,
          orderWarehouseId,
          new Date().toISOString().slice(0, 10),
          quotation.subtotal_cents,
          quotation.tax_cents,
          quotation.total_cents,
          quotation.notes,
          req.user!.id,
        );
      const orderId = Number(result.lastInsertRowid);
      const insertLine = db.prepare(
        `INSERT INTO sales_order_lines
           (sales_order_id, product_id, description, quantity, unit_price_cents, tax_rate_bp,
            line_subtotal_cents, line_tax_cents, line_total_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const line of lines) {
        insertLine.run(
          orderId,
          line.product_id,
          line.description,
          line.quantity,
          line.unit_price_cents,
          line.tax_rate_bp,
          line.line_subtotal_cents,
          line.line_tax_cents,
          line.line_total_cents,
        );
      }
      db.prepare(
        "UPDATE quotations SET status = 'converted', updated_at = datetime('now') WHERE id = ?",
      ).run(id);
      return orderId;
    })();

    recordAudit(req.user!.id, 'convert', 'quotation', id, { salesOrderId });
    res.json({ quotation: quoteDetail(id), salesOrderId });
  }),
);

quotationsRouter.delete(
  '/:id',
  requirePermission('sales.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const existing = getDb().prepare('SELECT status FROM quotations WHERE id = ?').get(id) as
      { status: string } | undefined;
    if (!existing) throw notFound('Quotation not found');
    if (existing.status !== 'draft' && existing.status !== 'cancelled') {
      throw new ValidationError('Only draft or cancelled quotations can be deleted');
    }
    getDb().prepare('DELETE FROM quotations WHERE id = ?').run(id);
    recordAudit(req.user!.id, 'delete', 'quotation', id);
    res.json({ ok: true });
  }),
);
