import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { ValidationError, notFound } from '../utils/errors.js';
import {
  optionalInt,
  optionalString,
  paramId,
  requireInt,
  requireNumber,
  requireString,
} from '../utils/validate.js';
import { adjustStock } from '../services/stock.js';

export const inventoryRouter = Router();
inventoryRouter.use(authenticate);

inventoryRouter.get(
  '/warehouses',
  requirePermission('products.view'),
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const warehouses = db.prepare('SELECT * FROM warehouses ORDER BY name').all() as {
      id: number;
    }[];
    const locations = db
      .prepare('SELECT * FROM stock_locations ORDER BY warehouse_id, name')
      .all() as {
      warehouse_id: number;
    }[];
    res.json({
      warehouses: warehouses.map((warehouse) => ({
        ...warehouse,
        locations: locations.filter((location) => location.warehouse_id === warehouse.id),
      })),
    });
  }),
);

inventoryRouter.post(
  '/warehouses',
  requirePermission('products.manage'),
  asyncHandler(async (req, res) => {
    const code = requireString(req.body?.code, 'Code', 30).toUpperCase();
    const name = requireString(req.body?.name, 'Name', 150);
    try {
      const result = getDb()
        .prepare('INSERT INTO warehouses (code, name, address) VALUES (?, ?, ?)')
        .run(code, name, optionalString(req.body?.address, 'Address', 500));
      res.status(201).json({
        warehouse: getDb()
          .prepare('SELECT * FROM warehouses WHERE id = ?')
          .get(Number(result.lastInsertRowid)),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        throw new ValidationError('A warehouse with that code already exists');
      }
      throw error;
    }
  }),
);

inventoryRouter.put(
  '/warehouses/:id',
  requirePermission('products.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb()
      .prepare('UPDATE warehouses SET code = ?, name = ?, address = ?, is_active = ? WHERE id = ?')
      .run(
        requireString(req.body?.code, 'Code', 30).toUpperCase(),
        requireString(req.body?.name, 'Name', 150),
        optionalString(req.body?.address, 'Address', 500),
        req.body?.isActive === false ? 0 : 1,
        id,
      );
    if (result.changes === 0) throw notFound('Warehouse not found');
    res.json({ warehouse: getDb().prepare('SELECT * FROM warehouses WHERE id = ?').get(id) });
  }),
);

inventoryRouter.post(
  '/warehouses/:id/locations',
  requirePermission('products.manage'),
  asyncHandler(async (req, res) => {
    const warehouseId = paramId(req.params.id);
    const warehouse = getDb().prepare('SELECT id FROM warehouses WHERE id = ?').get(warehouseId);
    if (!warehouse) throw notFound('Warehouse not found');
    const code = requireString(req.body?.code, 'Code', 30).toUpperCase();
    try {
      const result = getDb()
        .prepare(
          'INSERT INTO stock_locations (warehouse_id, code, name, is_default) VALUES (?, ?, ?, ?)',
        )
        .run(
          warehouseId,
          code,
          requireString(req.body?.name, 'Name', 150),
          req.body?.isDefault ? 1 : 0,
        );
      res.status(201).json({
        location: getDb()
          .prepare('SELECT * FROM stock_locations WHERE id = ?')
          .get(Number(result.lastInsertRowid)),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        throw new ValidationError('That location code already exists in this warehouse');
      }
      throw error;
    }
  }),
);

inventoryRouter.put(
  '/locations/:id',
  requirePermission('products.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb()
      .prepare('UPDATE stock_locations SET code = ?, name = ?, is_default = ? WHERE id = ?')
      .run(
        requireString(req.body?.code, 'Code', 30).toUpperCase(),
        requireString(req.body?.name, 'Name', 150),
        req.body?.isDefault ? 1 : 0,
        id,
      );
    if (result.changes === 0) throw notFound('Location not found');
    res.json({ location: getDb().prepare('SELECT * FROM stock_locations WHERE id = ?').get(id) });
  }),
);

inventoryRouter.get(
  '/stock',
  requirePermission('products.view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const where: string[] = ['p.track_inventory = 1'];
    const params: unknown[] = [];
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (req.query.lowOnly === 'true') {
      where.push(
        'COALESCE((SELECT SUM(sl.quantity) FROM stock_levels sl WHERE sl.product_id = p.id), 0) <= p.reorder_level',
      );
    }

    const rows = db
      .prepare(
        `SELECT p.id, p.sku, p.name, p.uom, p.reorder_level, p.cost_cents, p.sale_price_cents,
                c.name AS category_name,
                COALESCE((SELECT SUM(sl.quantity) FROM stock_levels sl WHERE sl.product_id = p.id), 0) AS quantity,
                COALESCE((SELECT SUM(sl.quantity * p.cost_cents) FROM stock_levels sl WHERE sl.product_id = p.id), 0) AS value_cents
         FROM products p
         LEFT JOIN product_categories c ON c.id = p.category_id
         WHERE ${where.join(' AND ')}
         ORDER BY p.name`,
      )
      .all(...params) as { quantity: number; value_cents: number }[];

    res.json({
      stock: rows,
      totalValueCents: rows.reduce((total, row) => total + Math.round(row.value_cents), 0),
    });
  }),
);

inventoryRouter.get(
  '/stock/moves',
  requirePermission('products.view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (req.query.productId) {
      where.push('m.product_id = ?');
      params.push(Number(req.query.productId));
    }
    if (req.query.locationId) {
      where.push('m.location_id = ?');
      params.push(Number(req.query.locationId));
    }
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const moves = db
      .prepare(
        `SELECT m.*, p.sku, p.name AS product_name, l.name AS location_name, l.code AS location_code,
                w.name AS warehouse_name, u.email AS user_email
         FROM stock_moves m
         JOIN products p ON p.id = m.product_id
         JOIN stock_locations l ON l.id = m.location_id
         JOIN warehouses w ON w.id = l.warehouse_id
         LEFT JOIN users u ON u.id = m.created_by
         WHERE ${where.join(' AND ')}
         ORDER BY m.id DESC LIMIT ?`,
      )
      .all(...params, limit);
    res.json({ moves });
  }),
);

inventoryRouter.get(
  '/stock/:productId',
  requirePermission('products.view'),
  asyncHandler(async (req, res) => {
    const productId = paramId(req.params.productId, 'product id');
    const db = getDb();
    const product = db
      .prepare(
        'SELECT id, sku, name, uom, reorder_level, cost_cents, sale_price_cents FROM products WHERE id = ?',
      )
      .get(productId);
    if (!product) throw notFound('Product not found');

    const levels = db
      .prepare(
        `SELECT sl.location_id, sl.quantity, l.code AS location_code, l.name AS location_name,
                w.id AS warehouse_id, w.name AS warehouse_name
         FROM stock_levels sl
         JOIN stock_locations l ON l.id = sl.location_id
         JOIN warehouses w ON w.id = l.warehouse_id
         WHERE sl.product_id = ?
         ORDER BY w.name, l.name`,
      )
      .all(productId);
    const moves = db
      .prepare(
        `SELECT m.id, m.quantity, m.move_type, m.reference_type, m.reference_id, m.note, m.created_at,
                l.name AS location_name
         FROM stock_moves m JOIN stock_locations l ON l.id = m.location_id
         WHERE m.product_id = ? ORDER BY m.id DESC LIMIT 50`,
      )
      .all(productId);

    res.json({ product, levels, moves });
  }),
);

inventoryRouter.post(
  '/stock/adjust',
  requirePermission('inventory.adjust'),
  asyncHandler(async (req, res) => {
    const productId = requireInt(req.body?.productId, 'Product', 1);
    const locationId = requireInt(req.body?.locationId, 'Location', 1);
    const quantity = requireNumber(req.body?.quantity, 'Quantity');
    if (quantity === 0) throw new ValidationError('Adjustment quantity must be non-zero');

    const note = optionalString(req.body?.note, 'Note', 500);
    const moveId = adjustStock({
      productId,
      locationId,
      quantity,
      note,
      userId: req.user!.id,
    });

    res
      .status(201)
      .json({ move: getDb().prepare('SELECT * FROM stock_moves WHERE id = ?').get(moveId) });
  }),
);

inventoryRouter.get(
  '/stock-levels',
  requirePermission('products.view'),
  asyncHandler(async (req, res) => {
    const productId = optionalInt(req.query.productId, 'Product', 1);
    const db = getDb();
    const levels = productId
      ? db
          .prepare('SELECT * FROM stock_levels WHERE product_id = ? ORDER BY location_id')
          .all(productId)
      : db.prepare('SELECT * FROM stock_levels ORDER BY product_id, location_id').all();
    res.json({ levels });
  }),
);
