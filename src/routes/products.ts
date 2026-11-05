import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { ValidationError, notFound } from '../utils/errors.js';
import {
  optionalInt,
  optionalString,
  paramId,
  requireEnum,
  requireInt,
  requireString,
} from '../utils/validate.js';
import { recordAudit } from '../services/audit.js';

export const productsRouter = Router();
productsRouter.use(authenticate);

const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name, t.rate_bp AS tax_rate_bp, t.name AS tax_rate_name,
    COALESCE((SELECT SUM(sl.quantity) FROM stock_levels sl WHERE sl.product_id = p.id), 0) AS stock_quantity
  FROM products p
  LEFT JOIN product_categories c ON c.id = p.category_id
  LEFT JOIN tax_rates t ON t.id = p.tax_rate_id`;

productsRouter.get(
  '/',
  requirePermission('products.view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where.push(
        '(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.brand LIKE ? OR p.colour LIKE ? OR p.size LIKE ?)',
      );
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (typeof req.query.brand === 'string' && req.query.brand.trim()) {
      where.push('p.brand = ?');
      params.push(req.query.brand.trim());
    }
    if (typeof req.query.colour === 'string' && req.query.colour.trim()) {
      where.push('p.colour = ?');
      params.push(req.query.colour.trim());
    }
    if (req.query.categoryId) {
      where.push('p.category_id = ?');
      params.push(Number(req.query.categoryId));
    }
    if (req.query.active === 'true') where.push('p.is_active = 1');
    if (req.query.active === 'false') where.push('p.is_active = 0');
    if (req.query.lowStock === 'true') {
      where.push(
        'p.track_inventory = 1 AND COALESCE((SELECT SUM(sl.quantity) FROM stock_levels sl WHERE sl.product_id = p.id), 0) <= p.reorder_level',
      );
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;
    const limit = Math.min(Number(req.query.limit ?? 200), 1000);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);

    const total = (
      db.prepare(`SELECT COUNT(*) AS count FROM products p ${whereSql}`).get(...params) as {
        count: number;
      }
    ).count;
    const products = db
      .prepare(`${PRODUCT_SELECT} ${whereSql} ORDER BY p.name LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);

    res.json({ products, total });
  }),
);

productsRouter.get(
  '/:id',
  requirePermission('products.view'),
  asyncHandler(async (req, res) => {
    const product = getDb().prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(paramId(req.params.id));
    if (!product) throw notFound('Product not found');
    res.json({ product });
  }),
);

function assertCategoryAndTax(categoryId: number | null, taxRateId: number | null): void {
  const db = getDb();
  if (categoryId !== null) {
    const category = db.prepare('SELECT id FROM product_categories WHERE id = ?').get(categoryId);
    if (!category) throw new ValidationError('Product category not found');
  }
  if (taxRateId !== null) {
    const tax = db.prepare('SELECT id FROM tax_rates WHERE id = ?').get(taxRateId);
    if (!tax) throw new ValidationError('Tax rate not found');
  }
}

productsRouter.post(
  '/',
  requirePermission('products.manage'),
  asyncHandler(async (req, res) => {
    const sku = requireString(req.body?.sku, 'SKU', 60);
    const name = requireString(req.body?.name, 'Name', 200);
    const type =
      req.body?.type === undefined
        ? 'goods'
        : requireEnum(req.body.type, 'Type', ['goods', 'service'] as const);
    const categoryId = optionalInt(req.body?.categoryId, 'Category', 1);
    const taxRateId = optionalInt(req.body?.taxRateId, 'Tax rate', 1);
    assertCategoryAndTax(categoryId, taxRateId);

    const db = getDb();
    try {
      const result = db
        .prepare(
          `INSERT INTO products
             (sku, barcode, name, description, brand, colour, size, thickness, category_id, type,
              uom, sale_price_cents, cost_cents, tax_rate_id, track_inventory, reorder_level,
              is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sku,
          optionalString(req.body?.barcode, 'Barcode', 60),
          name,
          optionalString(req.body?.description, 'Description', 5000),
          optionalString(req.body?.brand, 'Brand', 100),
          optionalString(req.body?.colour, 'Colour', 100),
          optionalString(req.body?.size, 'Size', 100),
          optionalString(req.body?.thickness, 'Thickness', 100),
          categoryId,
          type,
          optionalString(req.body?.uom, 'Unit of measure', 30) ?? 'unit',
          optionalInt(req.body?.salePriceCents, 'Sale price', 0) ?? 0,
          optionalInt(req.body?.costCents, 'Cost', 0) ?? 0,
          taxRateId,
          req.body?.trackInventory === false ? 0 : 1,
          optionalInt(req.body?.reorderLevel, 'Reorder level', 0) ?? 0,
          req.body?.isActive === false ? 0 : 1,
        );
      const id = Number(result.lastInsertRowid);
      recordAudit(req.user!.id, 'create', 'product', id, { sku, name });
      res.status(201).json({ product: db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id) });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        throw new ValidationError('A product with that SKU or barcode already exists');
      }
      throw error;
    }
  }),
);

productsRouter.put(
  '/:id',
  requirePermission('products.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as
      (Record<string, unknown> & { sku: string; name: string }) | undefined;
    if (!existing) throw notFound('Product not found');

    const categoryId =
      req.body?.categoryId === undefined
        ? (existing.category_id as number | null)
        : optionalInt(req.body.categoryId, 'Category', 1);
    const taxRateId =
      req.body?.taxRateId === undefined
        ? (existing.tax_rate_id as number | null)
        : optionalInt(req.body.taxRateId, 'Tax rate', 1);
    assertCategoryAndTax(categoryId, taxRateId);

    try {
      db.prepare(
        `UPDATE products SET
           sku = ?, barcode = ?, name = ?, description = ?, brand = ?, colour = ?, size = ?,
           thickness = ?, category_id = ?, type = ?, uom = ?, sale_price_cents = ?, cost_cents = ?,
           tax_rate_id = ?, track_inventory = ?, reorder_level = ?, is_active = ?,
           updated_at = datetime('now')
         WHERE id = ?`,
      ).run(
        req.body?.sku === undefined ? existing.sku : requireString(req.body.sku, 'SKU', 60),
        req.body?.barcode === undefined
          ? (existing.barcode as string | null)
          : optionalString(req.body.barcode, 'Barcode', 60),
        req.body?.name === undefined ? existing.name : requireString(req.body.name, 'Name', 200),
        req.body?.description === undefined
          ? (existing.description as string | null)
          : optionalString(req.body.description, 'Description', 5000),
        req.body?.brand === undefined
          ? (existing.brand as string | null)
          : optionalString(req.body.brand, 'Brand', 100),
        req.body?.colour === undefined
          ? (existing.colour as string | null)
          : optionalString(req.body.colour, 'Colour', 100),
        req.body?.size === undefined
          ? (existing.size as string | null)
          : optionalString(req.body.size, 'Size', 100),
        req.body?.thickness === undefined
          ? (existing.thickness as string | null)
          : optionalString(req.body.thickness, 'Thickness', 100),
        categoryId,
        req.body?.type === undefined
          ? existing.type
          : requireEnum(req.body.type, 'Type', ['goods', 'service'] as const),
        req.body?.uom === undefined
          ? existing.uom
          : (optionalString(req.body.uom, 'Unit of measure', 30) ?? 'unit'),
        req.body?.salePriceCents === undefined
          ? existing.sale_price_cents
          : requireInt(req.body.salePriceCents, 'Sale price', 0),
        req.body?.costCents === undefined
          ? existing.cost_cents
          : requireInt(req.body.costCents, 'Cost', 0),
        taxRateId,
        req.body?.trackInventory === undefined
          ? existing.track_inventory
          : req.body.trackInventory
            ? 1
            : 0,
        req.body?.reorderLevel === undefined
          ? existing.reorder_level
          : requireInt(req.body.reorderLevel, 'Reorder level', 0),
        req.body?.isActive === undefined ? existing.is_active : req.body.isActive ? 1 : 0,
        id,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        throw new ValidationError('A product with that SKU or barcode already exists');
      }
      throw error;
    }

    recordAudit(req.user!.id, 'update', 'product', id, { sku: existing.sku });
    res.json({ product: db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id) });
  }),
);

productsRouter.delete(
  '/:id',
  requirePermission('products.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const used = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM stock_moves WHERE product_id = ?) +
                (SELECT COUNT(*) FROM invoice_lines WHERE product_id = ?) +
                (SELECT COUNT(*) FROM purchase_order_lines WHERE product_id = ?) +
                (SELECT COUNT(*) FROM sales_order_lines WHERE product_id = ?) AS count`,
      )
      .get(id, id, id, id) as { count: number };
    if (used.count > 0) {
      throw new ValidationError(
        'This product has transactions and cannot be deleted. Mark it inactive instead.',
      );
    }
    const result = db.prepare('DELETE FROM products WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('Product not found');
    recordAudit(req.user!.id, 'delete', 'product', id);
    res.json({ ok: true });
  }),
);

// Categories
export const categoriesRouter = Router();
categoriesRouter.use(authenticate);

categoriesRouter.get(
  '/',
  requirePermission('products.view'),
  asyncHandler(async (_req, res) => {
    const categories = getDb()
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
         FROM product_categories c ORDER BY c.name`,
      )
      .all();
    res.json({ categories });
  }),
);

categoriesRouter.post(
  '/',
  requirePermission('products.manage'),
  asyncHandler(async (req, res) => {
    const name = requireString(req.body?.name, 'Name', 100);
    try {
      const result = getDb()
        .prepare('INSERT INTO product_categories (name, description) VALUES (?, ?)')
        .run(name, optionalString(req.body?.description, 'Description', 500));
      res.status(201).json({
        category: getDb()
          .prepare('SELECT * FROM product_categories WHERE id = ?')
          .get(Number(result.lastInsertRowid)),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        throw new ValidationError('A category with that name already exists');
      }
      throw error;
    }
  }),
);

categoriesRouter.put(
  '/:id',
  requirePermission('products.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const name = requireString(req.body?.name, 'Name', 100);
    const result = getDb()
      .prepare('UPDATE product_categories SET name = ?, description = ? WHERE id = ?')
      .run(name, optionalString(req.body?.description, 'Description', 500), id);
    if (result.changes === 0) throw notFound('Category not found');
    res.json({
      category: getDb().prepare('SELECT * FROM product_categories WHERE id = ?').get(id),
    });
  }),
);

categoriesRouter.delete(
  '/:id',
  requirePermission('products.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const used = getDb()
      .prepare('SELECT COUNT(*) AS count FROM products WHERE category_id = ?')
      .get(id) as {
      count: number;
    };
    if (used.count > 0) throw new ValidationError('Category is in use by products');
    const result = getDb().prepare('DELETE FROM product_categories WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('Category not found');
    res.json({ ok: true });
  }),
);

// Tax rates
export const taxRatesRouter = Router();
taxRatesRouter.use(authenticate);

taxRatesRouter.get(
  '/',
  requirePermission('products.view'),
  asyncHandler(async (_req, res) => {
    res.json({
      taxRates: getDb().prepare('SELECT * FROM tax_rates ORDER BY rate_bp DESC, name').all(),
    });
  }),
);

taxRatesRouter.post(
  '/',
  requirePermission('products.manage'),
  asyncHandler(async (req, res) => {
    const name = requireString(req.body?.name, 'Name', 100);
    const rateBp = requireInt(req.body?.rateBp, 'Rate', 0, 10000);
    try {
      const result = getDb()
        .prepare('INSERT INTO tax_rates (name, rate_bp, is_active) VALUES (?, ?, ?)')
        .run(name, rateBp, req.body?.isActive === false ? 0 : 1);
      res.status(201).json({
        taxRate: getDb()
          .prepare('SELECT * FROM tax_rates WHERE id = ?')
          .get(Number(result.lastInsertRowid)),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        throw new ValidationError('A tax rate with that name already exists');
      }
      throw error;
    }
  }),
);

taxRatesRouter.put(
  '/:id',
  requirePermission('products.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb()
      .prepare('UPDATE tax_rates SET name = ?, rate_bp = ?, is_active = ? WHERE id = ?')
      .run(
        requireString(req.body?.name, 'Name', 100),
        requireInt(req.body?.rateBp, 'Rate', 0, 10000),
        req.body?.isActive === false ? 0 : 1,
        id,
      );
    if (result.changes === 0) throw notFound('Tax rate not found');
    res.json({ taxRate: getDb().prepare('SELECT * FROM tax_rates WHERE id = ?').get(id) });
  }),
);

taxRatesRouter.delete(
  '/:id',
  requirePermission('products.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const used = getDb()
      .prepare('SELECT COUNT(*) AS count FROM products WHERE tax_rate_id = ?')
      .get(id) as {
      count: number;
    };
    if (used.count > 0) throw new ValidationError('Tax rate is in use by products');
    const result = getDb().prepare('DELETE FROM tax_rates WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('Tax rate not found');
    res.json({ ok: true });
  }),
);
