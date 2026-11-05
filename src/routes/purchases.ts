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
import { lineTotals } from '../utils/money.js';
import { nextNumber } from '../services/sequences.js';
import { recordAudit } from '../services/audit.js';
import { receivePurchaseOrder } from '../services/stock.js';

export const purchasesRouter = Router();
purchasesRouter.use(authenticate);

interface LineInput {
  productId?: number | null;
  description?: string;
  quantity: number;
  unitCostCents?: number;
  taxRateBp?: number;
}

interface ResolvedLine {
  productId: number | null;
  description: string;
  quantity: number;
  unitCostCents: number;
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
    let unitCostCents =
      line.unitCostCents === undefined
        ? null
        : requireInt(line.unitCostCents, `Line ${index + 1} cost`, 0);
    let taxRateBp =
      line.taxRateBp === undefined
        ? null
        : requireInt(line.taxRateBp, `Line ${index + 1} tax rate`, 0, 10000);

    if (productId !== null) {
      const product = db
        .prepare(
          `SELECT p.id, p.name, p.cost_cents, t.rate_bp
           FROM products p LEFT JOIN tax_rates t ON t.id = p.tax_rate_id WHERE p.id = ?`,
        )
        .get(productId) as
        { id: number; name: string; cost_cents: number; rate_bp: number | null } | undefined;
      if (!product) throw new ValidationError(`Line ${index + 1}: product not found`);
      if (!description) description = product.name;
      if (unitCostCents === null) unitCostCents = product.cost_cents;
      if (taxRateBp === null) taxRateBp = product.rate_bp ?? 0;
    }

    if (!description) throw new ValidationError(`Line ${index + 1}: description is required`);
    const quantity = requireNumber(line.quantity, `Line ${index + 1} quantity`, 0.0001);
    if (unitCostCents === null) throw new ValidationError(`Line ${index + 1}: cost is required`);
    const totals = lineTotals(quantity, unitCostCents, taxRateBp ?? 0);

    return {
      productId,
      description,
      quantity,
      unitCostCents,
      taxRateBp: taxRateBp ?? 0,
      ...totals,
    };
  });
}

function defaultWarehouseId(): number | null {
  const row = getDb()
    .prepare('SELECT id FROM warehouses WHERE is_active = 1 ORDER BY id LIMIT 1')
    .get() as { id: number } | undefined;
  return row?.id ?? null;
}

function saveLines(purchaseOrderId: number, lines: ResolvedLine[]): void {
  const db = getDb();
  db.prepare('DELETE FROM purchase_order_lines WHERE purchase_order_id = ?').run(purchaseOrderId);
  const insert = db.prepare(
    `INSERT INTO purchase_order_lines
       (purchase_order_id, product_id, description, quantity, unit_cost_cents, tax_rate_bp,
        line_subtotal_cents, line_tax_cents, line_total_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const line of lines) {
    insert.run(
      purchaseOrderId,
      line.productId,
      line.description,
      line.quantity,
      line.unitCostCents,
      line.taxRateBp,
      line.subtotalCents,
      line.taxCents,
      line.totalCents,
    );
  }
}

purchasesRouter.get(
  '/',
  requirePermission('purchases.view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    const status = req.query.status;
    if (typeof status === 'string' && status !== 'all') {
      where.push('po.status = ?');
      params.push(status);
    }
    if (req.query.supplierId) {
      where.push('po.supplier_id = ?');
      params.push(Number(req.query.supplierId));
    }
    if (req.query.warehouseId) {
      where.push('po.warehouse_id = ?');
      params.push(Number(req.query.warehouseId));
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where.push('(po.number LIKE ? OR p.name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (req.query.from) {
      where.push('po.order_date >= ?');
      params.push(String(req.query.from));
    }
    if (req.query.to) {
      where.push('po.order_date <= ?');
      params.push(String(req.query.to));
    }

    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const total = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM purchase_orders po JOIN partners p ON p.id = po.supplier_id ${whereSql}`,
        )
        .get(...params) as { count: number }
    ).count;
    const purchaseOrders = db
      .prepare(
        `SELECT po.*, p.name AS supplier_name, w.name AS warehouse_name,
                (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.purchase_order_id = po.id) AS line_count
         FROM purchase_orders po
         JOIN partners p ON p.id = po.supplier_id
         LEFT JOIN warehouses w ON w.id = po.warehouse_id
         ${whereSql} ORDER BY po.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);

    res.json({ purchaseOrders, total });
  }),
);

purchasesRouter.get(
  '/goods-receipts',
  requirePermission('purchases.view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const where = req.query.purchaseOrderId ? 'WHERE gr.purchase_order_id = ?' : '';
    const params = req.query.purchaseOrderId ? [Number(req.query.purchaseOrderId)] : [];
    const receipts = db
      .prepare(
        `SELECT gr.*, po.number AS purchase_order_number, p.name AS supplier_name
         FROM goods_receipts gr
         JOIN purchase_orders po ON po.id = gr.purchase_order_id
         JOIN partners p ON p.id = po.supplier_id
         ${where} ORDER BY gr.id DESC LIMIT 200`,
      )
      .all(...params);
    res.json({ receipts });
  }),
);

purchasesRouter.get(
  '/:id',
  requirePermission('purchases.view'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const order = db
      .prepare(
        `SELECT po.*, p.name AS supplier_name, p.email AS supplier_email,
                p.vat_number AS supplier_vat_number, w.name AS warehouse_name
         FROM purchase_orders po
         JOIN partners p ON p.id = po.supplier_id
         LEFT JOIN warehouses w ON w.id = po.warehouse_id
         WHERE po.id = ?`,
      )
      .get(id);
    if (!order) throw notFound('Purchase order not found');
    const lines = db
      .prepare('SELECT * FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY id')
      .all(id);
    const receipts = db
      .prepare('SELECT * FROM goods_receipts WHERE purchase_order_id = ? ORDER BY id')
      .all(id);
    res.json({ purchaseOrder: order, lines, receipts });
  }),
);

purchasesRouter.post(
  '/',
  requirePermission('purchases.manage'),
  asyncHandler(async (req, res) => {
    const supplierId = requireInt(req.body?.supplierId, 'Supplier', 1);
    const supplier = getDb()
      .prepare('SELECT id, is_supplier FROM partners WHERE id = ?')
      .get(supplierId) as { id: number; is_supplier: number } | undefined;
    if (!supplier) throw notFound('Supplier not found');
    if (supplier.is_supplier !== 1) throw new ValidationError('Selected partner is not a supplier');

    const lines = resolveLines(req.body?.lines);
    const subtotal = lines.reduce((t, l) => t + l.subtotalCents, 0);
    const tax = lines.reduce((t, l) => t + l.taxCents, 0);

    const id = getDb().transaction(() => {
      const number = nextNumber('purchase_order');
      const result = getDb()
        .prepare(
          `INSERT INTO purchase_orders
             (number, supplier_id, warehouse_id, status, order_date, expected_date, subtotal_cents,
              tax_cents, total_cents, notes, created_by)
           VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          number,
          supplierId,
          optionalInt(req.body?.warehouseId, 'Branch', 1) ?? defaultWarehouseId(),
          requireDate(req.body?.orderDate, 'Order date'),
          optionalDate(req.body?.expectedDate, 'Expected date'),
          subtotal,
          tax,
          subtotal + tax,
          optionalString(req.body?.notes, 'Notes', 5000),
          req.user!.id,
        );
      const purchaseOrderId = Number(result.lastInsertRowid);
      saveLines(purchaseOrderId, lines);
      recordAudit(req.user!.id, 'create', 'purchase_order', purchaseOrderId, {
        number,
        totalCents: subtotal + tax,
      });
      return purchaseOrderId;
    })();

    res.status(201).json({ purchaseOrder: getPurchaseOrder(id) });
  }),
);

function getPurchaseOrder(id: number) {
  const db = getDb();
  const order = db
    .prepare(
      `SELECT po.*, p.name AS supplier_name FROM purchase_orders po JOIN partners p ON p.id = po.supplier_id WHERE po.id = ?`,
    )
    .get(id);
  if (!order) throw notFound('Purchase order not found');
  const lines = db
    .prepare('SELECT * FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY id')
    .all(id);
  return { ...order, lines };
}

purchasesRouter.put(
  '/:id',
  requirePermission('purchases.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id) as
      (Record<string, unknown> & { status: string; supplier_id: number }) | undefined;
    if (!existing) throw notFound('Purchase order not found');
    if (existing.status !== 'draft')
      throw new ValidationError('Only draft purchase orders can be edited');

    const supplierId =
      req.body?.supplierId === undefined
        ? existing.supplier_id
        : requireInt(req.body.supplierId, 'Supplier', 1);
    const lines = resolveLines(req.body?.lines);
    const subtotal = lines.reduce((t, l) => t + l.subtotalCents, 0);
    const tax = lines.reduce((t, l) => t + l.taxCents, 0);

    db.transaction(() => {
      db.prepare(
        `UPDATE purchase_orders SET supplier_id = ?, warehouse_id = ?, order_date = ?,
           expected_date = ?, subtotal_cents = ?, tax_cents = ?, total_cents = ?, notes = ?,
           updated_at = datetime('now') WHERE id = ?`,
      ).run(
        supplierId,
        req.body?.warehouseId === undefined
          ? (existing.warehouse_id as number | null)
          : optionalInt(req.body.warehouseId, 'Branch', 1),
        req.body?.orderDate === undefined
          ? existing.order_date
          : requireDate(req.body.orderDate, 'Order date'),
        req.body?.expectedDate === undefined
          ? (existing.expected_date as string | null)
          : optionalDate(req.body.expectedDate, 'Expected date'),
        subtotal,
        tax,
        subtotal + tax,
        req.body?.notes === undefined
          ? (existing.notes as string | null)
          : optionalString(req.body.notes, 'Notes', 5000),
        id,
      );
      saveLines(id, lines);
      recordAudit(req.user!.id, 'update', 'purchase_order', id, { totalCents: subtotal + tax });
    })();

    res.json({ purchaseOrder: getPurchaseOrder(id) });
  }),
);

purchasesRouter.post(
  '/:id/confirm',
  requirePermission('purchases.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const order = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(id) as
      { status: string } | undefined;
    if (!order) throw notFound('Purchase order not found');
    if (order.status !== 'draft') throw new ValidationError('Only draft orders can be confirmed');
    db.prepare(
      "UPDATE purchase_orders SET status = 'confirmed', updated_at = datetime('now') WHERE id = ?",
    ).run(id);
    recordAudit(req.user!.id, 'confirm', 'purchase_order', id);
    res.json({ purchaseOrder: getPurchaseOrder(id) });
  }),
);

purchasesRouter.post(
  '/:id/cancel',
  requirePermission('purchases.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const order = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(id) as
      { status: string } | undefined;
    if (!order) throw notFound('Purchase order not found');
    if (order.status === 'received')
      throw new ValidationError('A received order cannot be cancelled');
    if (order.status === 'cancelled') throw new ValidationError('Order is already cancelled');
    db.prepare(
      "UPDATE purchase_orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?",
    ).run(id);
    recordAudit(req.user!.id, 'cancel', 'purchase_order', id);
    res.json({ purchaseOrder: getPurchaseOrder(id) });
  }),
);

purchasesRouter.post(
  '/:id/receive',
  requirePermission('purchases.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const locationId = requireInt(req.body?.locationId, 'Location', 1);
    const receivedDate = requireDate(req.body?.receivedDate, 'Received date');
    const rawLines = req.body?.lines;
    const lines = Array.isArray(rawLines)
      ? rawLines.map((entry) => {
          const line = entry as { purchaseOrderLineId?: unknown; quantity?: unknown };
          return {
            purchaseOrderLineId: requireInt(line.purchaseOrderLineId, 'Order line', 1),
            quantity: requireNumber(line.quantity, 'Quantity', 0.0001),
          };
        })
      : undefined;

    const receipt = receivePurchaseOrder(id, {
      locationId,
      receivedDate,
      notes: optionalString(req.body?.notes, 'Notes', 5000),
      lines,
      userId: req.user!.id,
    });
    recordAudit(req.user!.id, 'receive', 'purchase_order', id, receipt);
    res.status(201).json({ receipt, purchaseOrder: getPurchaseOrder(id) });
  }),
);
