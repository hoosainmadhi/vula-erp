import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { ValidationError, notFound } from '../utils/errors.js';

/**
 * Barcode module: scan-to-find and printable label data.
 * Scan codes are matched against products.barcode first, then SKU.
 */
export const barcodeRouter = Router();
barcodeRouter.use(authenticate);

const BARCODE_PRODUCT_SELECT = `
  SELECT p.id, p.sku, p.barcode, p.name, p.uom, p.sale_price_cents, p.cost_cents,
         p.track_inventory, p.is_active, p.reorder_level,
         c.name AS category_name,
    COALESCE((SELECT SUM(sl.quantity) FROM stock_levels sl WHERE sl.product_id = p.id), 0) AS stock_quantity
  FROM products p
  LEFT JOIN product_categories c ON c.id = p.category_id`;

barcodeRouter.get(
  '/lookup',
  requirePermission('products.view'),
  asyncHandler(async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
    if (!code) throw new ValidationError('A barcode or SKU is required');

    const db = getDb();
    const product =
      (db.prepare(`${BARCODE_PRODUCT_SELECT} WHERE p.barcode = ? COLLATE NOCASE`).get(code) as
        { id: number } | undefined) ??
      (db.prepare(`${BARCODE_PRODUCT_SELECT} WHERE p.sku = ? COLLATE NOCASE`).get(code) as
        { id: number } | undefined);
    if (!product) throw notFound('No product matches that barcode or SKU');

    const locations = db
      .prepare(
        `SELECT w.id AS warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
                sl.id AS location_id, sl.code AS location_code, sl.name AS location_name,
                st.quantity
         FROM stock_levels st
         JOIN stock_locations sl ON sl.id = st.location_id
         JOIN warehouses w ON w.id = sl.warehouse_id
         WHERE st.product_id = ? AND st.quantity <> 0
         ORDER BY w.name, sl.code`,
      )
      .all(product.id);

    res.json({ product, locations });
  }),
);

barcodeRouter.get(
  '/labels',
  requirePermission('products.view'),
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const where: string[] = ['p.barcode IS NOT NULL', "p.barcode <> ''"];
    const params: unknown[] = [];
    if (q) {
      where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const limit = Math.min(Number(req.query.limit ?? 100), 500);

    const products = getDb()
      .prepare(
        `${BARCODE_PRODUCT_SELECT} WHERE ${where.join(' AND ')}
         ORDER BY p.name LIMIT ?`,
      )
      .all(...params, limit);

    res.json({ products });
  }),
);
