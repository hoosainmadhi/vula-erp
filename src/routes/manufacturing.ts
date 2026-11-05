import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { ValidationError, notFound } from '../utils/errors.js';
import {
  optionalDate,
  optionalInt,
  optionalNumber,
  optionalString,
  paramId,
  requireEnum,
  requireInt,
  requireNumber,
  requireString,
} from '../utils/validate.js';
import { nextNumber } from '../services/sequences.js';
import { recordMove } from '../services/stock.js';
import { recordAudit } from '../services/audit.js';

export const manufacturingRouter = Router();
manufacturingRouter.use(authenticate);

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

interface ProductRow {
  id: number;
  sku: string;
  name: string;
  type: 'goods' | 'service';
  cost_cents: number;
  track_inventory: number;
}

interface BomRow {
  id: number;
  code: string;
  product_id: number;
  quantity: number;
}

const BOM_SELECT = `
  SELECT b.*, p.sku AS product_sku, p.name AS product_name, p.type AS product_type,
    (SELECT COUNT(*) FROM manufacturing_bom_lines l WHERE l.bom_id = b.id) AS line_count,
    (SELECT COUNT(*) FROM manufacturing_bom_operations o WHERE o.bom_id = b.id) AS operation_count
  FROM manufacturing_boms b
  JOIN products p ON p.id = b.product_id`;

const ORDER_SELECT = `
  SELECT mo.*, p.sku AS product_sku, p.name AS product_name,
    b.code AS bom_code,
    u.first_name || ' ' || u.last_name AS assignee_name,
    sl.code AS source_location_code, dl.code AS destination_location_code
  FROM manufacturing_orders mo
  JOIN products p ON p.id = mo.product_id
  LEFT JOIN manufacturing_boms b ON b.id = mo.bom_id
  LEFT JOIN users u ON u.id = mo.assigned_to
  LEFT JOIN stock_locations sl ON sl.id = mo.source_location_id
  LEFT JOIN stock_locations dl ON dl.id = mo.destination_location_id`;

function productRow(id: number, label = 'Product'): ProductRow {
  const product = getDb()
    .prepare('SELECT id, sku, name, type, cost_cents, track_inventory FROM products WHERE id = ?')
    .get(id) as ProductRow | undefined;
  if (!product) throw notFound(`${label} not found`);
  return product;
}

function defaultLocationId(): number {
  const row = getDb()
    .prepare('SELECT id FROM stock_locations ORDER BY is_default DESC, id LIMIT 1')
    .get() as { id: number } | undefined;
  if (!row) throw new ValidationError('No stock location is configured');
  return row.id;
}

function bomRow(id: number): BomRow {
  const bom = getDb()
    .prepare('SELECT id, code, product_id, quantity FROM manufacturing_boms WHERE id = ?')
    .get(id) as BomRow | undefined;
  if (!bom) throw notFound('Bill of materials not found');
  return bom;
}

function replaceBomLines(
  bomId: number,
  lines: { productId: number; quantity: number }[],
  operations: number[],
): void {
  const db = getDb();
  const seen = new Set<number>();
  for (const line of lines) {
    if (seen.has(line.productId)) {
      throw new ValidationError('A component can only appear once on a bill of materials');
    }
    seen.add(line.productId);
    const product = productRow(line.productId, 'Component');
    if (product.type !== 'goods') {
      throw new ValidationError(`Component ${product.sku} must be a goods product`);
    }
  }
  for (const operationId of operations) {
    if (!db.prepare('SELECT id FROM manufacturing_operations WHERE id = ?').get(operationId)) {
      throw new ValidationError('Operation not found');
    }
  }

  db.prepare('DELETE FROM manufacturing_bom_lines WHERE bom_id = ?').run(bomId);
  db.prepare('DELETE FROM manufacturing_bom_operations WHERE bom_id = ?').run(bomId);
  const insertLine = db.prepare(
    'INSERT INTO manufacturing_bom_lines (bom_id, product_id, quantity, sort) VALUES (?, ?, ?, ?)',
  );
  lines.forEach((line, index) => insertLine.run(bomId, line.productId, line.quantity, index + 1));
  const insertOperation = db.prepare(
    'INSERT INTO manufacturing_bom_operations (bom_id, operation_id, sequence) VALUES (?, ?, ?)',
  );
  operations.forEach((operationId, index) => insertOperation.run(bomId, operationId, index + 1));
}

function bomDetail(id: number) {
  const db = getDb();
  const bom = db.prepare(`${BOM_SELECT} WHERE b.id = ?`).get(id);
  if (!bom) throw notFound('Bill of materials not found');
  const lines = db
    .prepare(
      `SELECT l.*, p.sku AS product_sku, p.name AS product_name, p.cost_cents, p.uom
       FROM manufacturing_bom_lines l
       JOIN products p ON p.id = l.product_id
       WHERE l.bom_id = ? ORDER BY l.sort, l.id`,
    )
    .all(id);
  const operations = db
    .prepare(
      `SELECT bo.*, o.name AS operation_name, o.duration_minutes,
              w.name AS work_center_name, w.cost_per_hour_cents
       FROM manufacturing_bom_operations bo
       JOIN manufacturing_operations o ON o.id = bo.operation_id
       LEFT JOIN manufacturing_work_centers w ON w.id = o.work_center_id
       WHERE bo.bom_id = ? ORDER BY bo.sequence, bo.id`,
    )
    .all(id);
  return { ...(bom as Record<string, unknown>), lines, operations };
}

function snapshotOrder(orderId: number, bomId: number | null, quantity: number): void {
  const db = getDb();
  db.prepare('DELETE FROM manufacturing_order_components WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM manufacturing_order_operations WHERE order_id = ?').run(orderId);
  if (!bomId) return;

  const bom = bomRow(bomId);
  const factor = quantity / bom.quantity;
  const lines = db
    .prepare(
      `SELECT l.product_id, l.quantity, p.cost_cents
       FROM manufacturing_bom_lines l JOIN products p ON p.id = l.product_id
       WHERE l.bom_id = ? ORDER BY l.sort, l.id`,
    )
    .all(bomId) as { product_id: number; quantity: number; cost_cents: number }[];
  const insertComponent = db.prepare(
    `INSERT INTO manufacturing_order_components
       (order_id, product_id, required_quantity, unit_cost_cents)
     VALUES (?, ?, ?, ?)`,
  );
  for (const line of lines) {
    insertComponent.run(orderId, line.product_id, line.quantity * factor, line.cost_cents);
  }

  const operations = db
    .prepare(
      `SELECT bo.operation_id, bo.sequence, o.name, o.duration_minutes, o.work_center_id
       FROM manufacturing_bom_operations bo
       JOIN manufacturing_operations o ON o.id = bo.operation_id
       WHERE bo.bom_id = ? ORDER BY bo.sequence, bo.id`,
    )
    .all(bomId) as {
    operation_id: number;
    sequence: number;
    name: string;
    duration_minutes: number;
    work_center_id: number | null;
  }[];
  const insertOperation = db.prepare(
    `INSERT INTO manufacturing_order_operations
       (order_id, operation_id, work_center_id, name, sequence, duration_minutes)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const operation of operations) {
    insertOperation.run(
      orderId,
      operation.operation_id,
      operation.work_center_id,
      operation.name,
      operation.sequence,
      operation.duration_minutes,
    );
  }
}

function orderDetail(id: number) {
  const db = getDb();
  const order = db.prepare(`${ORDER_SELECT} WHERE mo.id = ?`).get(id);
  if (!order) throw notFound('Manufacturing order not found');
  const components = db
    .prepare(
      `SELECT c.*, p.sku AS product_sku, p.name AS product_name,
         (SELECT COALESCE(SUM(quantity), 0) FROM stock_levels s
          WHERE s.product_id = c.product_id AND s.location_id = ?) AS available_quantity
       FROM manufacturing_order_components c
       JOIN products p ON p.id = c.product_id
       WHERE c.order_id = ? ORDER BY c.id`,
    )
    .all((order as { source_location_id: number | null }).source_location_id, id);
  const operations = db
    .prepare(
      `SELECT o.*, w.name AS work_center_name, w.cost_per_hour_cents
       FROM manufacturing_order_operations o
       LEFT JOIN manufacturing_work_centers w ON w.id = o.work_center_id
       WHERE o.order_id = ? ORDER BY o.sequence, o.id`,
    )
    .all(id);
  return { ...(order as Record<string, unknown>), components, operations };
}

// Options for pickers
manufacturingRouter.get(
  '/options',
  requirePermission('manufacturing.view'),
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const products = db
      .prepare(
        `SELECT id, sku, name, type, uom, cost_cents, track_inventory
         FROM products WHERE is_active = 1 ORDER BY name`,
      )
      .all();
    const locations = db
      .prepare(
        `SELECT l.id, l.code, l.name, l.is_default, w.name AS warehouse_name
         FROM stock_locations l JOIN warehouses w ON w.id = l.warehouse_id
         ORDER BY w.name, l.name`,
      )
      .all();
    const users = db
      .prepare('SELECT id, first_name, last_name, email FROM users ORDER BY first_name, last_name')
      .all();
    res.json({ products, locations, users });
  }),
);

// Work centers
manufacturingRouter.get(
  '/work-centers',
  requirePermission('manufacturing.view'),
  asyncHandler(async (_req, res) => {
    const workCenters = getDb()
      .prepare(
        `SELECT w.*,
           (SELECT COUNT(*) FROM manufacturing_operations o WHERE o.work_center_id = w.id) AS operation_count
         FROM manufacturing_work_centers w ORDER BY w.name`,
      )
      .all();
    res.json({ workCenters });
  }),
);

manufacturingRouter.post(
  '/work-centers',
  requirePermission('manufacturing.manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    try {
      const result = db
        .prepare(
          `INSERT INTO manufacturing_work_centers
             (name, code, cost_per_hour_cents, capacity_per_day, is_active, notes)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          requireString(req.body?.name, 'Name', 200),
          requireString(req.body?.code, 'Code', 50),
          optionalInt(req.body?.costPerHourCents, 'Cost per hour', 0) ?? 0,
          optionalNumber(req.body?.capacityPerDay, 'Capacity per day', 0) ?? 8,
          req.body?.isActive === false ? 0 : 1,
          optionalString(req.body?.notes, 'Notes', 2000),
        );
      const id = Number(result.lastInsertRowid);
      recordAudit(req.user!.id, 'create', 'manufacturing_work_center', id);
      res.status(201).json({
        workCenter: db.prepare('SELECT * FROM manufacturing_work_centers WHERE id = ?').get(id),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        throw new ValidationError('A work center with that code already exists');
      }
      throw error;
    }
  }),
);

manufacturingRouter.put(
  '/work-centers/:id',
  requirePermission('manufacturing.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM manufacturing_work_centers WHERE id = ?').get(id) as
      | (Record<string, unknown> & {
          name: string;
          code: string;
          cost_per_hour_cents: number;
          capacity_per_day: number;
          is_active: number;
          notes: string | null;
        })
      | undefined;
    if (!existing) throw notFound('Work center not found');
    db.prepare(
      `UPDATE manufacturing_work_centers SET name = ?, code = ?, cost_per_hour_cents = ?,
         capacity_per_day = ?, is_active = ?, notes = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      req.body?.name === undefined ? existing.name : requireString(req.body.name, 'Name', 200),
      req.body?.code === undefined ? existing.code : requireString(req.body.code, 'Code', 50),
      req.body?.costPerHourCents === undefined
        ? existing.cost_per_hour_cents
        : (optionalInt(req.body.costPerHourCents, 'Cost per hour', 0) ?? 0),
      req.body?.capacityPerDay === undefined
        ? existing.capacity_per_day
        : (optionalNumber(req.body.capacityPerDay, 'Capacity per day', 0) ?? 8),
      req.body?.isActive === undefined ? existing.is_active : req.body.isActive ? 1 : 0,
      req.body?.notes === undefined
        ? existing.notes
        : optionalString(req.body.notes, 'Notes', 2000),
      id,
    );
    recordAudit(req.user!.id, 'update', 'manufacturing_work_center', id);
    res.json({
      workCenter: db.prepare('SELECT * FROM manufacturing_work_centers WHERE id = ?').get(id),
    });
  }),
);

manufacturingRouter.delete(
  '/work-centers/:id',
  requirePermission('manufacturing.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    try {
      const result = getDb().prepare('DELETE FROM manufacturing_work_centers WHERE id = ?').run(id);
      if (result.changes === 0) throw notFound('Work center not found');
      recordAudit(req.user!.id, 'delete', 'manufacturing_work_center', id);
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof Error && error.message.includes('FOREIGN KEY')) {
        throw new ValidationError('Remove this work center from its operations first');
      }
      throw error;
    }
  }),
);

// Operations
manufacturingRouter.get(
  '/operations',
  requirePermission('manufacturing.view'),
  asyncHandler(async (_req, res) => {
    const operations = getDb()
      .prepare(
        `SELECT o.*, w.name AS work_center_name, w.cost_per_hour_cents
         FROM manufacturing_operations o
         LEFT JOIN manufacturing_work_centers w ON w.id = o.work_center_id
         ORDER BY o.name`,
      )
      .all();
    res.json({ operations });
  }),
);

manufacturingRouter.post(
  '/operations',
  requirePermission('manufacturing.manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const workCenterId = optionalInt(req.body?.workCenterId, 'Work center', 1);
    if (
      workCenterId &&
      !db.prepare('SELECT id FROM manufacturing_work_centers WHERE id = ?').get(workCenterId)
    ) {
      throw notFound('Work center not found');
    }
    const result = db
      .prepare(
        `INSERT INTO manufacturing_operations (name, work_center_id, duration_minutes, notes)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        requireString(req.body?.name, 'Name', 200),
        workCenterId,
        optionalNumber(req.body?.durationMinutes, 'Duration', 0) ?? 0,
        optionalString(req.body?.notes, 'Notes', 2000),
      );
    const id = Number(result.lastInsertRowid);
    recordAudit(req.user!.id, 'create', 'manufacturing_operation', id);
    res.status(201).json({
      operation: db
        .prepare(
          `SELECT o.*, w.name AS work_center_name FROM manufacturing_operations o
           LEFT JOIN manufacturing_work_centers w ON w.id = o.work_center_id WHERE o.id = ?`,
        )
        .get(id),
    });
  }),
);

manufacturingRouter.put(
  '/operations/:id',
  requirePermission('manufacturing.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM manufacturing_operations WHERE id = ?').get(id) as
      | (Record<string, unknown> & {
          name: string;
          work_center_id: number | null;
          duration_minutes: number;
          notes: string | null;
        })
      | undefined;
    if (!existing) throw notFound('Operation not found');
    const workCenterId =
      req.body?.workCenterId === undefined
        ? existing.work_center_id
        : optionalInt(req.body.workCenterId, 'Work center', 1);
    if (
      workCenterId &&
      !db.prepare('SELECT id FROM manufacturing_work_centers WHERE id = ?').get(workCenterId)
    ) {
      throw notFound('Work center not found');
    }
    db.prepare(
      `UPDATE manufacturing_operations SET name = ?, work_center_id = ?, duration_minutes = ?,
         notes = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(
      req.body?.name === undefined ? existing.name : requireString(req.body.name, 'Name', 200),
      workCenterId,
      req.body?.durationMinutes === undefined
        ? existing.duration_minutes
        : (optionalNumber(req.body.durationMinutes, 'Duration', 0) ?? 0),
      req.body?.notes === undefined
        ? existing.notes
        : optionalString(req.body.notes, 'Notes', 2000),
      id,
    );
    recordAudit(req.user!.id, 'update', 'manufacturing_operation', id);
    res.json({
      operation: db
        .prepare(
          `SELECT o.*, w.name AS work_center_name FROM manufacturing_operations o
           LEFT JOIN manufacturing_work_centers w ON w.id = o.work_center_id WHERE o.id = ?`,
        )
        .get(id),
    });
  }),
);

manufacturingRouter.delete(
  '/operations/:id',
  requirePermission('manufacturing.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    try {
      const result = getDb().prepare('DELETE FROM manufacturing_operations WHERE id = ?').run(id);
      if (result.changes === 0) throw notFound('Operation not found');
      recordAudit(req.user!.id, 'delete', 'manufacturing_operation', id);
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof Error && error.message.includes('FOREIGN KEY')) {
        throw new ValidationError('Remove this operation from its bills of materials first');
      }
      throw error;
    }
  }),
);

// Bills of materials
manufacturingRouter.get(
  '/boms',
  requirePermission('manufacturing.view'),
  asyncHandler(async (req, res) => {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (req.query.active === '1') where.push('b.is_active = 1');
    if (req.query.active === '0') where.push('b.is_active = 0');
    if (req.query.productId) {
      where.push('b.product_id = ?');
      params.push(Number(req.query.productId));
    }
    const boms = getDb()
      .prepare(`${BOM_SELECT} WHERE ${where.join(' AND ')} ORDER BY b.code`)
      .all(...params);
    res.json({ boms });
  }),
);

manufacturingRouter.get(
  '/boms/:id',
  requirePermission('manufacturing.view'),
  asyncHandler(async (req, res) => {
    res.json({ bom: bomDetail(paramId(req.params.id)) });
  }),
);

manufacturingRouter.post(
  '/boms',
  requirePermission('manufacturing.manage'),
  asyncHandler(async (req, res) => {
    const productId = requireInt(req.body?.productId, 'Finished product', 1);
    const product = productRow(productId, 'Finished product');
    if (product.type !== 'goods') {
      throw new ValidationError('The finished product must be a goods product');
    }
    const lines = Array.isArray(req.body?.lines)
      ? (req.body.lines as { productId?: unknown; quantity?: unknown }[])
      : [];
    const operations = Array.isArray(req.body?.operationIds)
      ? (req.body.operationIds as unknown[]).map((value) => requireInt(value, 'Operation', 1))
      : [];
    const parsedLines = lines.map((line) => ({
      productId: requireInt(line.productId, 'Component', 1),
      quantity: requireNumber(line.quantity, 'Component quantity', 0.0001),
    }));
    if (parsedLines.some((line) => line.productId === productId)) {
      throw new ValidationError('A bill of materials cannot contain its own finished product');
    }

    const db = getDb();
    try {
      const id = db.transaction(() => {
        const result = db
          .prepare(
            `INSERT INTO manufacturing_boms (code, product_id, quantity, notes, is_active)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            requireString(req.body?.code, 'Code', 50),
            productId,
            optionalNumber(req.body?.quantity, 'Quantity', 0.0001) ?? 1,
            optionalString(req.body?.notes, 'Notes', 5000),
            req.body?.isActive === false ? 0 : 1,
          );
        const bomId = Number(result.lastInsertRowid);
        replaceBomLines(bomId, parsedLines, operations);
        return bomId;
      })();
      recordAudit(req.user!.id, 'create', 'manufacturing_bom', id);
      res.status(201).json({ bom: bomDetail(id) });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        throw new ValidationError('A bill of materials with that code already exists');
      }
      throw error;
    }
  }),
);

manufacturingRouter.put(
  '/boms/:id',
  requirePermission('manufacturing.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = bomRow(id);
    const productId =
      req.body?.productId === undefined
        ? existing.product_id
        : requireInt(req.body.productId, 'Finished product', 1);
    const product = productRow(productId, 'Finished product');
    if (product.type !== 'goods') {
      throw new ValidationError('The finished product must be a goods product');
    }
    const lines = Array.isArray(req.body?.lines)
      ? (req.body.lines as { productId?: unknown; quantity?: unknown }[]).map((line) => ({
          productId: requireInt(line.productId, 'Component', 1),
          quantity: requireNumber(line.quantity, 'Component quantity', 0.0001),
        }))
      : null;
    if (lines?.some((line) => line.productId === productId)) {
      throw new ValidationError('A bill of materials cannot contain its own finished product');
    }
    const operations = Array.isArray(req.body?.operationIds)
      ? (req.body.operationIds as unknown[]).map((value) => requireInt(value, 'Operation', 1))
      : null;

    try {
      db.transaction(() => {
        db.prepare(
          `UPDATE manufacturing_boms SET code = ?, product_id = ?, quantity = ?, notes = ?,
             is_active = ?, updated_at = datetime('now') WHERE id = ?`,
        ).run(
          req.body?.code === undefined ? existing.code : requireString(req.body.code, 'Code', 50),
          productId,
          req.body?.quantity === undefined
            ? existing.quantity
            : (optionalNumber(req.body.quantity, 'Quantity', 0.0001) ?? 1),
          req.body?.notes === undefined
            ? (
                db.prepare('SELECT notes FROM manufacturing_boms WHERE id = ?').get(id) as {
                  notes: string | null;
                }
              ).notes
            : optionalString(req.body.notes, 'Notes', 5000),
          req.body?.isActive === undefined
            ? (
                db.prepare('SELECT is_active FROM manufacturing_boms WHERE id = ?').get(id) as {
                  is_active: number;
                }
              ).is_active
            : req.body.isActive
              ? 1
              : 0,
          id,
        );
        if (lines) {
          replaceBomLines(id, lines, operations ?? []);
        } else if (operations) {
          replaceBomLines(
            id,
            db
              .prepare(
                'SELECT product_id AS productId, quantity FROM manufacturing_bom_lines WHERE bom_id = ?',
              )
              .all(id) as { productId: number; quantity: number }[],
            operations,
          );
        }
      })();
      recordAudit(req.user!.id, 'update', 'manufacturing_bom', id);
      res.json({ bom: bomDetail(id) });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        throw new ValidationError('A bill of materials with that code already exists');
      }
      throw error;
    }
  }),
);

manufacturingRouter.delete(
  '/boms/:id',
  requirePermission('manufacturing.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb().prepare('DELETE FROM manufacturing_boms WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('Bill of materials not found');
    recordAudit(req.user!.id, 'delete', 'manufacturing_bom', id);
    res.json({ ok: true });
  }),
);

// Production orders
manufacturingRouter.get(
  '/orders',
  requirePermission('manufacturing.view'),
  asyncHandler(async (req, res) => {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (typeof req.query.status === 'string' && req.query.status !== 'all') {
      where.push('mo.status = ?');
      params.push(req.query.status);
    }
    if (req.query.productId) {
      where.push('mo.product_id = ?');
      params.push(Number(req.query.productId));
    }
    const orders = getDb()
      .prepare(
        `${ORDER_SELECT} WHERE ${where.join(' AND ')} ORDER BY mo.created_at DESC, mo.id DESC LIMIT 300`,
      )
      .all(...params);
    res.json({ orders });
  }),
);

manufacturingRouter.get(
  '/orders/:id',
  requirePermission('manufacturing.view'),
  asyncHandler(async (req, res) => {
    res.json({ order: orderDetail(paramId(req.params.id)) });
  }),
);

manufacturingRouter.post(
  '/orders',
  requirePermission('manufacturing.manage'),
  asyncHandler(async (req, res) => {
    const productId = requireInt(req.body?.productId, 'Product', 1);
    const product = productRow(productId);
    if (product.type !== 'goods') {
      throw new ValidationError('Only goods products can be manufactured');
    }
    const quantity = requireNumber(req.body?.quantity, 'Quantity', 0.0001);
    let bomId = optionalInt(req.body?.bomId, 'Bill of materials', 1);
    if (bomId) {
      const bom = bomRow(bomId);
      if (bom.product_id !== productId) {
        throw new ValidationError('The bill of materials is for a different product');
      }
    } else {
      const active = getDb()
        .prepare(
          'SELECT id FROM manufacturing_boms WHERE product_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
        )
        .get(productId) as { id: number } | undefined;
      bomId = active?.id ?? null;
    }

    const db = getDb();
    const id = db.transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO manufacturing_orders
             (number, product_id, bom_id, quantity, priority, scheduled_date,
              source_location_id, destination_location_id, assigned_to, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          nextNumber('manufacturing_order'),
          productId,
          bomId,
          quantity,
          req.body?.priority === undefined
            ? 'medium'
            : requireEnum(req.body.priority, 'Priority', PRIORITIES),
          optionalDate(req.body?.scheduledDate, 'Scheduled date'),
          optionalInt(req.body?.sourceLocationId, 'Source location', 1) ?? defaultLocationId(),
          optionalInt(req.body?.destinationLocationId, 'Destination location', 1) ??
            defaultLocationId(),
          optionalInt(req.body?.assignedTo, 'Assignee', 1),
          optionalString(req.body?.notes, 'Notes', 5000),
          req.user!.id,
        );
      const orderId = Number(result.lastInsertRowid);
      snapshotOrder(orderId, bomId, quantity);
      return orderId;
    })();

    recordAudit(req.user!.id, 'create', 'manufacturing_order', id);
    res.status(201).json({ order: orderDetail(id) });
  }),
);

manufacturingRouter.put(
  '/orders/:id',
  requirePermission('manufacturing.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM manufacturing_orders WHERE id = ?').get(id) as
      | (Record<string, unknown> & {
          status: string;
          product_id: number;
          bom_id: number | null;
          quantity: number;
          priority: string;
          scheduled_date: string | null;
          source_location_id: number | null;
          destination_location_id: number | null;
          assigned_to: number | null;
          notes: string | null;
        })
      | undefined;
    if (!existing) throw notFound('Manufacturing order not found');
    if (existing.status !== 'draft') {
      throw new ValidationError('Only draft manufacturing orders can be edited');
    }

    const productId =
      req.body?.productId === undefined
        ? existing.product_id
        : requireInt(req.body.productId, 'Product', 1);
    if (req.body?.productId !== undefined) {
      const product = productRow(productId);
      if (product.type !== 'goods')
        throw new ValidationError('Only goods products can be manufactured');
    }
    const quantity =
      req.body?.quantity === undefined
        ? existing.quantity
        : requireNumber(req.body.quantity, 'Quantity', 0.0001);
    const bomId =
      req.body?.bomId === undefined
        ? existing.bom_id
        : optionalInt(req.body.bomId, 'Bill of materials', 1);
    if (bomId) {
      const bom = bomRow(bomId);
      if (bom.product_id !== productId) {
        throw new ValidationError('The bill of materials is for a different product');
      }
    }

    db.transaction(() => {
      db.prepare(
        `UPDATE manufacturing_orders SET product_id = ?, bom_id = ?, quantity = ?, priority = ?,
           scheduled_date = ?, source_location_id = ?, destination_location_id = ?, assigned_to = ?,
           notes = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(
        productId,
        bomId,
        quantity,
        req.body?.priority === undefined
          ? existing.priority
          : requireEnum(req.body.priority, 'Priority', PRIORITIES),
        req.body?.scheduledDate === undefined
          ? existing.scheduled_date
          : optionalDate(req.body.scheduledDate, 'Scheduled date'),
        req.body?.sourceLocationId === undefined
          ? existing.source_location_id
          : optionalInt(req.body.sourceLocationId, 'Source location', 1),
        req.body?.destinationLocationId === undefined
          ? existing.destination_location_id
          : optionalInt(req.body.destinationLocationId, 'Destination location', 1),
        req.body?.assignedTo === undefined
          ? existing.assigned_to
          : optionalInt(req.body.assignedTo, 'Assignee', 1),
        req.body?.notes === undefined
          ? existing.notes
          : optionalString(req.body.notes, 'Notes', 5000),
        id,
      );
      if (
        req.body?.productId !== undefined ||
        req.body?.bomId !== undefined ||
        req.body?.quantity !== undefined
      ) {
        snapshotOrder(id, bomId, quantity);
      }
    })();

    recordAudit(req.user!.id, 'update', 'manufacturing_order', id);
    res.json({ order: orderDetail(id) });
  }),
);

manufacturingRouter.post(
  '/orders/:id/confirm',
  requirePermission('manufacturing.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT status FROM manufacturing_orders WHERE id = ?').get(id) as
      { status: string } | undefined;
    if (!existing) throw notFound('Manufacturing order not found');
    if (existing.status !== 'draft') {
      throw new ValidationError('Only draft manufacturing orders can be confirmed');
    }
    db.prepare(
      "UPDATE manufacturing_orders SET status = 'confirmed', updated_at = datetime('now') WHERE id = ?",
    ).run(id);
    recordAudit(req.user!.id, 'confirm', 'manufacturing_order', id);
    res.json({ order: orderDetail(id) });
  }),
);

manufacturingRouter.post(
  '/orders/:id/start',
  requirePermission('manufacturing.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const order = db
      .prepare(
        `SELECT id, number, status, source_location_id FROM manufacturing_orders WHERE id = ?`,
      )
      .get(id) as
      { id: number; number: string; status: string; source_location_id: number | null } | undefined;
    if (!order) throw notFound('Manufacturing order not found');
    if (order.status !== 'confirmed') {
      throw new ValidationError('Only confirmed manufacturing orders can be started');
    }

    const components = db
      .prepare(
        `SELECT c.product_id, c.required_quantity, p.sku, p.name, p.track_inventory
         FROM manufacturing_order_components c JOIN products p ON p.id = c.product_id
         WHERE c.order_id = ?`,
      )
      .all(id) as {
      product_id: number;
      required_quantity: number;
      sku: string;
      name: string;
      track_inventory: number;
    }[];
    const locationId = order.source_location_id ?? defaultLocationId();
    for (const component of components) {
      if (component.track_inventory !== 1) continue;
      const available = db
        .prepare('SELECT quantity FROM stock_levels WHERE product_id = ? AND location_id = ?')
        .get(component.product_id, locationId) as { quantity: number } | undefined;
      const onHand = available?.quantity ?? 0;
      if (onHand + 1e-9 < component.required_quantity) {
        throw new ValidationError(
          `Insufficient stock for ${component.sku} — ${component.name} (need ${component.required_quantity}, have ${onHand})`,
        );
      }
    }

    db.prepare(
      "UPDATE manufacturing_orders SET status = 'in_progress', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    ).run(id);
    recordAudit(req.user!.id, 'start', 'manufacturing_order', id);
    res.json({ order: orderDetail(id) });
  }),
);

manufacturingRouter.post(
  '/orders/:id/operations/:operationId/start',
  requirePermission('manufacturing.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const operationId = paramId(req.params.operationId, 'operation id');
    const db = getDb();
    const order = db.prepare('SELECT status FROM manufacturing_orders WHERE id = ?').get(id) as
      { status: string } | undefined;
    if (!order) throw notFound('Manufacturing order not found');
    if (order.status !== 'in_progress') {
      throw new ValidationError('Start the manufacturing order before starting an operation');
    }
    const operation = db
      .prepare('SELECT status FROM manufacturing_order_operations WHERE id = ? AND order_id = ?')
      .get(operationId, id) as { status: string } | undefined;
    if (!operation) throw notFound('Operation not found');
    if (operation.status !== 'pending') {
      throw new ValidationError('Only pending operations can be started');
    }
    db.prepare(
      "UPDATE manufacturing_order_operations SET status = 'in_progress', started_at = datetime('now') WHERE id = ?",
    ).run(operationId);
    recordAudit(req.user!.id, 'start', 'manufacturing_operation', operationId);
    res.json({ order: orderDetail(id) });
  }),
);

manufacturingRouter.post(
  '/orders/:id/operations/:operationId/complete',
  requirePermission('manufacturing.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const operationId = paramId(req.params.operationId, 'operation id');
    const db = getDb();
    const order = db.prepare('SELECT status FROM manufacturing_orders WHERE id = ?').get(id) as
      { status: string } | undefined;
    if (!order) throw notFound('Manufacturing order not found');
    if (order.status !== 'in_progress') {
      throw new ValidationError('Only in-progress orders can complete operations');
    }
    const operation = db
      .prepare(
        'SELECT status, duration_minutes FROM manufacturing_order_operations WHERE id = ? AND order_id = ?',
      )
      .get(operationId, id) as { status: string; duration_minutes: number } | undefined;
    if (!operation) throw notFound('Operation not found');
    if (operation.status === 'done') throw new ValidationError('Operation is already complete');
    const actual = optionalNumber(req.body?.durationMinutes, 'Duration', 0);
    db.prepare(
      `UPDATE manufacturing_order_operations SET status = 'done', finished_at = datetime('now'),
         duration_minutes = ? WHERE id = ?`,
    ).run(actual ?? operation.duration_minutes, operationId);
    recordAudit(req.user!.id, 'complete', 'manufacturing_operation', operationId);
    res.json({ order: orderDetail(id) });
  }),
);

manufacturingRouter.post(
  '/orders/:id/complete',
  requirePermission('manufacturing.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const order = db
      .prepare(
        `SELECT id, number, status, quantity, product_id, source_location_id, destination_location_id
         FROM manufacturing_orders WHERE id = ?`,
      )
      .get(id) as
      | {
          id: number;
          number: string;
          status: string;
          quantity: number;
          product_id: number;
          source_location_id: number | null;
          destination_location_id: number | null;
        }
      | undefined;
    if (!order) throw notFound('Manufacturing order not found');
    if (order.status !== 'in_progress') {
      throw new ValidationError('Only in-progress manufacturing orders can be completed');
    }

    const operations = db
      .prepare('SELECT name, status FROM manufacturing_order_operations WHERE order_id = ?')
      .all(id) as { name: string; status: string }[];
    const pending = operations.filter((operation) => operation.status !== 'done');
    if (pending.length > 0) {
      throw new ValidationError(
        `Complete all operations first (${pending.map((operation) => operation.name).join(', ')})`,
      );
    }

    const components = db
      .prepare(
        `SELECT c.id, c.product_id, c.required_quantity, c.consumed_quantity, c.unit_cost_cents,
                p.sku, p.name, p.track_inventory, p.cost_cents
         FROM manufacturing_order_components c JOIN products p ON p.id = c.product_id
         WHERE c.order_id = ?`,
      )
      .all(id) as {
      id: number;
      product_id: number;
      required_quantity: number;
      consumed_quantity: number;
      unit_cost_cents: number;
      sku: string;
      name: string;
      track_inventory: number;
      cost_cents: number;
    }[];

    const sourceLocationId = order.source_location_id ?? defaultLocationId();
    const destinationLocationId = order.destination_location_id ?? sourceLocationId;

    db.transaction(() => {
      let materialCost = 0;
      for (const component of components) {
        const outstanding = component.required_quantity - component.consumed_quantity;
        if (outstanding <= 1e-9) continue;
        if (component.track_inventory === 1) {
          const available = db
            .prepare('SELECT quantity FROM stock_levels WHERE product_id = ? AND location_id = ?')
            .get(component.product_id, sourceLocationId) as { quantity: number } | undefined;
          const onHand = available?.quantity ?? 0;
          if (onHand + 1e-9 < outstanding) {
            throw new ValidationError(
              `Insufficient stock for ${component.sku} — ${component.name} (need ${outstanding}, have ${onHand})`,
            );
          }
          recordMove({
            productId: component.product_id,
            locationId: sourceLocationId,
            quantity: -outstanding,
            moveType: 'adjustment',
            referenceType: 'manufacturing_order',
            referenceId: id,
            unitCostCents: component.unit_cost_cents || component.cost_cents,
            note: `Consumed by ${order.number}`,
            userId: req.user!.id,
          });
        }
        db.prepare(
          'UPDATE manufacturing_order_components SET consumed_quantity = required_quantity WHERE id = ?',
        ).run(component.id);
        materialCost += outstanding * (component.unit_cost_cents || component.cost_cents);
      }

      const operationRows = db
        .prepare(
          `SELECT o.duration_minutes, w.cost_per_hour_cents
           FROM manufacturing_order_operations o
           LEFT JOIN manufacturing_work_centers w ON w.id = o.work_center_id
           WHERE o.order_id = ?`,
        )
        .all(id) as { duration_minutes: number; cost_per_hour_cents: number | null }[];
      const operationCost = operationRows.reduce(
        (total, operation) =>
          total +
          Math.round((operation.duration_minutes / 60) * (operation.cost_per_hour_cents ?? 0)),
        0,
      );
      const totalCost = materialCost + operationCost;

      const finished = db
        .prepare('SELECT track_inventory FROM products WHERE id = ?')
        .get(order.product_id) as { track_inventory: number } | undefined;
      if (finished?.track_inventory === 1) {
        recordMove({
          productId: order.product_id,
          locationId: destinationLocationId,
          quantity: order.quantity,
          moveType: 'receipt',
          referenceType: 'manufacturing_order',
          referenceId: id,
          unitCostCents: Math.round(totalCost / order.quantity),
          note: `Produced by ${order.number}`,
          userId: req.user!.id,
        });
      }

      db.prepare(
        `UPDATE manufacturing_orders SET status = 'done', finished_at = datetime('now'),
           material_cost_cents = ?, operation_cost_cents = ?, total_cost_cents = ?,
           updated_at = datetime('now') WHERE id = ?`,
      ).run(materialCost, operationCost, totalCost, id);
    })();

    recordAudit(req.user!.id, 'complete', 'manufacturing_order', id);
    res.json({ order: orderDetail(id) });
  }),
);

manufacturingRouter.post(
  '/orders/:id/cancel',
  requirePermission('manufacturing.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT status FROM manufacturing_orders WHERE id = ?').get(id) as
      { status: string } | undefined;
    if (!existing) throw notFound('Manufacturing order not found');
    if (existing.status === 'in_progress') {
      throw new ValidationError('An in-progress order cannot be cancelled');
    }
    if (existing.status === 'done' || existing.status === 'cancelled') {
      throw new ValidationError('This order can no longer be cancelled');
    }
    db.prepare(
      "UPDATE manufacturing_orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?",
    ).run(id);
    recordAudit(req.user!.id, 'cancel', 'manufacturing_order', id);
    res.json({ order: orderDetail(id) });
  }),
);

manufacturingRouter.delete(
  '/orders/:id',
  requirePermission('manufacturing.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const existing = getDb()
      .prepare('SELECT status FROM manufacturing_orders WHERE id = ?')
      .get(id) as { status: string } | undefined;
    if (!existing) throw notFound('Manufacturing order not found');
    if (existing.status !== 'draft' && existing.status !== 'cancelled') {
      throw new ValidationError('Only draft or cancelled manufacturing orders can be deleted');
    }
    getDb().prepare('DELETE FROM manufacturing_orders WHERE id = ?').run(id);
    recordAudit(req.user!.id, 'delete', 'manufacturing_order', id);
    res.json({ ok: true });
  }),
);

manufacturingRouter.get(
  '/summary',
  requirePermission('manufacturing.view'),
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const byStatus = db
      .prepare('SELECT status, COUNT(*) AS count FROM manufacturing_orders GROUP BY status')
      .all();
    const open = db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(total_cost_cents), 0) AS cost_cents
         FROM manufacturing_orders WHERE status IN ('draft', 'confirmed', 'in_progress')`,
      )
      .get();
    const completed = db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(total_cost_cents), 0) AS cost_cents
         FROM manufacturing_orders WHERE status = 'done'`,
      )
      .get();
    const bomCount = db
      .prepare('SELECT COUNT(*) AS count FROM manufacturing_boms WHERE is_active = 1')
      .get();
    res.json({ byStatus, open, completed, bomCount });
  }),
);
