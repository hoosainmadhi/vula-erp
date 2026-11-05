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
  requireEnum,
  requireInt,
  requireNumber,
  requireString,
} from '../utils/validate.js';
import { createInvoice, recordPayment } from '../services/invoices.js';
import { recordMove } from '../services/stock.js';
import { recordAudit } from '../services/audit.js';
import { nextNumber } from '../services/sequences.js';
import { lineTotals } from '../utils/money.js';
import { today } from '../utils/dates.js';

export const posRouter = Router();
posRouter.use(authenticate);

const PAYMENT_METHODS = ['cash', 'bank', 'card', 'eft', 'other'] as const;

interface RegisterRow {
  id: number;
  name: string;
  code: string;
  warehouse_id: number | null;
  location_id: number | null;
  is_active: number;
}

function registerRow(id: number): RegisterRow {
  const register = getDb()
    .prepare(
      'SELECT id, name, code, warehouse_id, location_id, is_active FROM pos_registers WHERE id = ?',
    )
    .get(id) as RegisterRow | undefined;
  if (!register) throw notFound('POS register not found');
  if (register.is_active !== 1) throw new ValidationError('This POS register is inactive');
  return register;
}

function walkInPartnerId(): number {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM partners WHERE name = 'Walk-in Customer' AND is_customer = 1")
    .get() as { id: number } | undefined;
  if (existing) return existing.id;
  const result = db
    .prepare(
      "INSERT INTO partners (name, is_customer, is_supplier) VALUES ('Walk-in Customer', 1, 0)",
    )
    .run();
  return Number(result.lastInsertRowid);
}

function sessionRow(id: number) {
  const session = getDb()
    .prepare(
      `SELECT s.*, r.name AS register_name, r.code AS register_code,
              u.first_name || ' ' || u.last_name AS cashier_name
       FROM pos_sessions s
       JOIN pos_registers r ON r.id = s.register_id
       LEFT JOIN users u ON u.id = s.opened_by
       WHERE s.id = ?`,
    )
    .get(id) as (Record<string, unknown> & { status: string; register_id: number }) | undefined;
  if (!session) throw notFound('POS session not found');
  return session;
}

function orderDetail(id: number) {
  const db = getDb();
  const order = db
    .prepare(
      `SELECT o.*, r.name AS register_name, r.code AS register_code,
              p.name AS customer_name, i.number AS invoice_number, pay.number AS payment_number,
              u.first_name || ' ' || u.last_name AS cashier_name
       FROM pos_orders o
       JOIN pos_registers r ON r.id = o.register_id
       LEFT JOIN partners p ON p.id = o.customer_id
       LEFT JOIN invoices i ON i.id = o.invoice_id
       LEFT JOIN payments pay ON pay.id = o.payment_id
       LEFT JOIN users u ON u.id = o.created_by
       WHERE o.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!order) throw notFound('POS order not found');
  const lines = db.prepare('SELECT * FROM pos_order_lines WHERE order_id = ? ORDER BY id').all(id);
  return { ...order, lines };
}

function expectedCash(sessionId: number): number {
  const db = getDb();
  const session = db
    .prepare('SELECT opening_float_cents FROM pos_sessions WHERE id = ?')
    .get(sessionId) as { opening_float_cents: number } | undefined;
  if (!session) throw notFound('POS session not found');
  const cashSales = db
    .prepare(
      `SELECT COALESCE(SUM(total_cents), 0) AS total FROM pos_orders
       WHERE session_id = ? AND status = 'paid' AND payment_method = 'cash'`,
    )
    .get(sessionId) as { total: number };
  const movements = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'in' THEN amount_cents ELSE 0 END), 0) AS cash_in,
         COALESCE(SUM(CASE WHEN type = 'out' THEN amount_cents ELSE 0 END), 0) AS cash_out
       FROM pos_cash_movements WHERE session_id = ?`,
    )
    .get(sessionId) as { cash_in: number; cash_out: number };
  return session.opening_float_cents + cashSales.total + movements.cash_in - movements.cash_out;
}

// Registers
posRouter.get(
  '/registers',
  requirePermission('pos.view'),
  asyncHandler(async (_req, res) => {
    const registers = getDb()
      .prepare(
        `SELECT r.*, l.code AS location_code, l.name AS location_name, w.name AS warehouse_name,
           (SELECT s.id FROM pos_sessions s WHERE s.register_id = r.id AND s.status = 'open'
             ORDER BY s.id DESC LIMIT 1) AS open_session_id
         FROM pos_registers r
         LEFT JOIN stock_locations l ON l.id = r.location_id
         LEFT JOIN warehouses w ON w.id = r.warehouse_id
         ORDER BY r.name`,
      )
      .all();
    res.json({ registers });
  }),
);

posRouter.post(
  '/registers',
  requirePermission('pos.manage'),
  asyncHandler(async (req, res) => {
    const locationId = requireInt(req.body?.locationId, 'Stock location', 1);
    const db = getDb();
    const location = db
      .prepare('SELECT id, warehouse_id FROM stock_locations WHERE id = ?')
      .get(locationId) as { id: number; warehouse_id: number } | undefined;
    if (!location) throw notFound('Stock location not found');
    try {
      const result = db
        .prepare(
          `INSERT INTO pos_registers (name, code, warehouse_id, location_id, is_active)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          requireString(req.body?.name, 'Name', 200),
          requireString(req.body?.code, 'Code', 50),
          location.warehouse_id,
          location.id,
          req.body?.isActive === false ? 0 : 1,
        );
      const id = Number(result.lastInsertRowid);
      recordAudit(req.user!.id, 'create', 'pos_register', id);
      res.status(201).json({
        register: db.prepare('SELECT * FROM pos_registers WHERE id = ?').get(id),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        throw new ValidationError('A register with that code already exists');
      }
      throw error;
    }
  }),
);

posRouter.put(
  '/registers/:id',
  requirePermission('pos.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM pos_registers WHERE id = ?').get(id) as
      | (Record<string, unknown> & {
          name: string;
          code: string;
          warehouse_id: number | null;
          location_id: number | null;
          is_active: number;
        })
      | undefined;
    if (!existing) throw notFound('POS register not found');

    let warehouseId = existing.warehouse_id;
    let locationId = existing.location_id;
    if (req.body?.locationId !== undefined) {
      locationId = requireInt(req.body.locationId, 'Stock location', 1);
      const location = db
        .prepare('SELECT id, warehouse_id FROM stock_locations WHERE id = ?')
        .get(locationId) as { id: number; warehouse_id: number } | undefined;
      if (!location) throw notFound('Stock location not found');
      warehouseId = location.warehouse_id;
    }

    db.prepare(
      `UPDATE pos_registers SET name = ?, code = ?, warehouse_id = ?, location_id = ?,
         is_active = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(
      req.body?.name === undefined ? existing.name : requireString(req.body.name, 'Name', 200),
      req.body?.code === undefined ? existing.code : requireString(req.body.code, 'Code', 50),
      warehouseId,
      locationId,
      req.body?.isActive === undefined ? existing.is_active : req.body.isActive ? 1 : 0,
      id,
    );
    recordAudit(req.user!.id, 'update', 'pos_register', id);
    res.json({ register: db.prepare('SELECT * FROM pos_registers WHERE id = ?').get(id) });
  }),
);

// Sessions
posRouter.get(
  '/sessions',
  requirePermission('pos.view'),
  asyncHandler(async (req, res) => {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (typeof req.query.status === 'string' && req.query.status !== 'all') {
      where.push('s.status = ?');
      params.push(req.query.status);
    }
    const sessions = getDb()
      .prepare(
        `SELECT s.*, r.name AS register_name, r.code AS register_code,
                u.first_name || ' ' || u.last_name AS cashier_name,
                (SELECT COUNT(*) FROM pos_orders o WHERE o.session_id = s.id) AS order_count,
                (SELECT COALESCE(SUM(o.total_cents), 0) FROM pos_orders o
                  WHERE o.session_id = s.id AND o.status = 'paid') AS sales_cents,
                CASE WHEN s.status = 'open' THEN
                  s.opening_float_cents
                  + (SELECT COALESCE(SUM(o.total_cents), 0) FROM pos_orders o
                      WHERE o.session_id = s.id AND o.status = 'paid' AND o.payment_method = 'cash')
                  + (SELECT COALESCE(SUM(CASE WHEN m.type = 'in' THEN m.amount_cents ELSE -m.amount_cents END), 0)
                      FROM pos_cash_movements m WHERE m.session_id = s.id)
                ELSE s.expected_cash_cents END AS live_expected_cash_cents
         FROM pos_sessions s
         JOIN pos_registers r ON r.id = s.register_id
         LEFT JOIN users u ON u.id = s.opened_by
         WHERE ${where.join(' AND ')}
         ORDER BY s.opened_at DESC, s.id DESC LIMIT 200`,
      )
      .all(...params);
    res.json({ sessions });
  }),
);

posRouter.post(
  '/sessions',
  requirePermission('pos.manage'),
  asyncHandler(async (req, res) => {
    const registerId = requireInt(req.body?.registerId, 'Register', 1);
    const register = registerRow(registerId);
    const db = getDb();
    const open = db
      .prepare("SELECT id FROM pos_sessions WHERE register_id = ? AND status = 'open'")
      .get(registerId) as { id: number } | undefined;
    if (open) throw new ValidationError('This register already has an open session');

    const result = db
      .prepare(
        `INSERT INTO pos_sessions (register_id, opened_by, opening_float_cents, notes)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        register.id,
        req.user!.id,
        optionalCents(req.body?.openingFloatCents, 'Opening float') ?? 0,
        optionalString(req.body?.notes, 'Notes', 2000),
      );
    const id = Number(result.lastInsertRowid);
    recordAudit(req.user!.id, 'open', 'pos_session', id);
    res.status(201).json({ session: sessionRow(id) });
  }),
);

posRouter.post(
  '/sessions/:id/close',
  requirePermission('pos.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const session = sessionRow(id);
    if (session.status !== 'open') throw new ValidationError('This session is already closed');
    const closing = requireInt(req.body?.closingCashCents, 'Closing cash', 0);
    const expected = expectedCash(id);
    db.prepare(
      `UPDATE pos_sessions SET status = 'closed', closed_at = datetime('now'),
         closing_cash_cents = ?, expected_cash_cents = ?, difference_cents = ?,
         notes = COALESCE(?, notes), updated_at = datetime('now') WHERE id = ?`,
    ).run(
      closing,
      expected,
      closing - expected,
      optionalString(req.body?.notes, 'Notes', 2000),
      id,
    );
    recordAudit(req.user!.id, 'close', 'pos_session', id, {
      expectedCents: expected,
      closingCents: closing,
    });
    res.json({ session: sessionRow(id) });
  }),
);

posRouter.post(
  '/sessions/:id/cash-movements',
  requirePermission('pos.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const session = sessionRow(id);
    if (session.status !== 'open') throw new ValidationError('This session is closed');
    const type = requireEnum(req.body?.type, 'Type', ['in', 'out'] as const);
    const amount = requireInt(req.body?.amountCents, 'Amount', 1);
    const result = getDb()
      .prepare(
        'INSERT INTO pos_cash_movements (session_id, type, amount_cents, reason, created_by) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, type, amount, optionalString(req.body?.reason, 'Reason', 1000), req.user!.id);
    recordAudit(req.user!.id, `cash:${type}`, 'pos_session', id, { amountCents: amount });
    res.status(201).json({
      cashMovement: getDb()
        .prepare('SELECT * FROM pos_cash_movements WHERE id = ?')
        .get(Number(result.lastInsertRowid)),
    });
  }),
);

// Catalogue for the register
posRouter.get(
  '/products',
  requirePermission('pos.view'),
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const registerId = req.query.registerId ? Number(req.query.registerId) : null;
    const locationId = registerId
      ? ((
          getDb().prepare('SELECT location_id FROM pos_registers WHERE id = ?').get(registerId) as
            { location_id: number | null } | undefined
        )?.location_id ?? null)
      : null;
    const where: string[] = ['p.is_active = 1'];
    const params: unknown[] = [];
    if (q) {
      where.push('(p.sku LIKE ? OR p.name LIKE ? OR p.barcode LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const products = getDb()
      .prepare(
        `SELECT p.id, p.sku, p.barcode, p.name, p.type, p.uom, p.sale_price_cents, p.cost_cents,
                p.track_inventory, COALESCE(t.rate_bp, 0) AS tax_rate_bp,
                COALESCE((SELECT s.quantity FROM stock_levels s
                  WHERE s.product_id = p.id AND s.location_id = ?), 0) AS stock_quantity
         FROM products p
         LEFT JOIN tax_rates t ON t.id = p.tax_rate_id
         WHERE ${where.join(' AND ')}
         ORDER BY p.name LIMIT 200`,
      )
      .all(locationId, ...params);
    res.json({ products });
  }),
);

posRouter.get(
  '/customers',
  requirePermission('pos.view'),
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const where: string[] = ['is_customer = 1', 'is_active = 1'];
    const params: unknown[] = [];
    if (q) {
      where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const customers = getDb()
      .prepare(
        `SELECT id, name, email, phone, credit_limit_cents
         FROM partners WHERE ${where.join(' AND ')} ORDER BY name LIMIT 100`,
      )
      .all(...params);
    res.json({ customers });
  }),
);

// Sales
posRouter.get(
  '/orders',
  requirePermission('pos.view'),
  asyncHandler(async (req, res) => {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (req.query.sessionId) {
      where.push('o.session_id = ?');
      params.push(Number(req.query.sessionId));
    }
    const orders = getDb()
      .prepare(
        `SELECT o.*, r.name AS register_name, p.name AS customer_name,
                i.number AS invoice_number, u.first_name || ' ' || u.last_name AS cashier_name
         FROM pos_orders o
         JOIN pos_registers r ON r.id = o.register_id
         LEFT JOIN partners p ON p.id = o.customer_id
         LEFT JOIN invoices i ON i.id = o.invoice_id
         LEFT JOIN users u ON u.id = o.created_by
         WHERE ${where.join(' AND ')}
         ORDER BY o.created_at DESC, o.id DESC LIMIT 200`,
      )
      .all(...params);
    res.json({ orders });
  }),
);

posRouter.get(
  '/orders/:id',
  requirePermission('pos.view'),
  asyncHandler(async (req, res) => {
    res.json({ order: orderDetail(paramId(req.params.id)) });
  }),
);

posRouter.post(
  '/orders',
  requirePermission('pos.manage'),
  asyncHandler(async (req, res) => {
    const lines = Array.isArray(req.body?.lines)
      ? (req.body.lines as { productId?: unknown; quantity?: unknown; unitPriceCents?: unknown }[])
      : [];
    if (lines.length === 0) throw new ValidationError('A POS sale needs at least one line');

    const paymentMethod = requireEnum(req.body?.paymentMethod, 'Payment method', PAYMENT_METHODS);
    const db = getDb();
    const register = req.body?.registerId
      ? registerRow(requireInt(req.body.registerId, 'Register', 1))
      : (db
          .prepare(
            'SELECT id, name, code, warehouse_id, location_id, is_active FROM pos_registers WHERE is_active = 1 ORDER BY id LIMIT 1',
          )
          .get() as RegisterRow | undefined);
    if (!register) throw new ValidationError('No active POS register is configured');
    if (!register.location_id) throw new ValidationError('The register has no stock location');
    const registerLocationId = register.location_id;

    const session = req.body?.sessionId
      ? sessionRow(requireInt(req.body.sessionId, 'Session', 1))
      : (db
          .prepare(
            "SELECT * FROM pos_sessions WHERE register_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1",
          )
          .get(register.id) as
          (Record<string, unknown> & { status: string; register_id: number }) | undefined);
    if (!session) throw new ValidationError('Open a POS session before selling');
    if (session.status !== 'open') throw new ValidationError('This POS session is closed');
    if (session.register_id !== register.id) {
      throw new ValidationError('The session belongs to a different register');
    }

    const parsed = lines.map((line) => {
      const productId = requireInt(line.productId, 'Product', 1);
      const quantity = requireNumber(line.quantity, 'Quantity', 0.0001);
      const product = db
        .prepare(
          `SELECT p.id, p.sku, p.name, p.sale_price_cents, p.cost_cents, p.track_inventory,
                  COALESCE(t.rate_bp, 0) AS tax_rate_bp
           FROM products p LEFT JOIN tax_rates t ON t.id = p.tax_rate_id
           WHERE p.id = ? AND p.is_active = 1`,
        )
        .get(productId) as
        | {
            id: number;
            sku: string;
            name: string;
            sale_price_cents: number;
            cost_cents: number;
            track_inventory: number;
            tax_rate_bp: number;
          }
        | undefined;
      if (!product) throw notFound(`Product ${productId} not found`);
      const unitPrice =
        optionalCents(line.unitPriceCents, 'Unit price') ?? product.sale_price_cents;
      const totals = lineTotals(quantity, unitPrice, product.tax_rate_bp);
      return { product, quantity, unitPrice, totals };
    });

    const subtotal = parsed.reduce((total, line) => total + line.totals.subtotalCents, 0);
    const tax = parsed.reduce((total, line) => total + line.totals.taxCents, 0);
    const total = subtotal + tax;
    const tendered =
      paymentMethod === 'cash'
        ? (optionalCents(req.body?.amountTenderedCents, 'Amount tendered') ?? total)
        : total;
    if (tendered < total) {
      throw new ValidationError('Amount tendered is less than the sale total');
    }
    const change = paymentMethod === 'cash' ? tendered - total : 0;
    const customerId = req.body?.customerId
      ? requireInt(req.body.customerId, 'Customer', 1)
      : walkInPartnerId();
    const customer = db
      .prepare('SELECT id, is_customer FROM partners WHERE id = ?')
      .get(customerId) as { id: number; is_customer: number } | undefined;
    if (!customer) throw notFound('Customer not found');
    if (customer.is_customer !== 1) throw new ValidationError('This partner is not a customer');

    const orderId = db.transaction(() => {
      const number = nextNumber('pos_order');
      const result = db
        .prepare(
          `INSERT INTO pos_orders
             (number, session_id, register_id, customer_id, payment_method, subtotal_cents,
              tax_cents, total_cents, amount_tendered_cents, change_cents, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?)`,
        )
        .run(
          number,
          session.id,
          register.id,
          customerId,
          paymentMethod,
          subtotal,
          tax,
          total,
          tendered,
          change,
          req.user!.id,
        );
      const id = Number(result.lastInsertRowid);

      const invoice = createInvoice({
        direction: 'sale',
        partnerId: customerId,
        issueDate: today(),
        dueDate: today(),
        notes: `POS sale ${number}`,
        lines: parsed.map((line) => ({
          productId: line.product.id,
          description: line.product.name,
          quantity: line.quantity,
          unitPriceCents: line.unitPrice,
          taxRateBp: line.product.tax_rate_bp,
        })),
        post: true,
        userId: req.user!.id,
      }) as unknown as { id: number };
      const payment = recordPayment({
        partnerId: customerId,
        invoiceId: invoice.id,
        direction: 'in',
        paymentDate: today(),
        amountCents: total,
        method: paymentMethod,
        reference: number,
        notes: `POS sale ${number}`,
        userId: req.user!.id,
      });

      const insertLine = db.prepare(
        `INSERT INTO pos_order_lines
           (order_id, product_id, description, quantity, unit_price_cents, tax_rate_bp,
            line_subtotal_cents, line_tax_cents, line_total_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const line of parsed) {
        insertLine.run(
          id,
          line.product.id,
          line.product.name,
          line.quantity,
          line.unitPrice,
          line.product.tax_rate_bp,
          line.totals.subtotalCents,
          line.totals.taxCents,
          line.totals.totalCents,
        );
        if (line.product.track_inventory !== 1) continue;
        recordMove({
          productId: line.product.id,
          locationId: registerLocationId,
          quantity: -line.quantity,
          moveType: 'sale',
          referenceType: 'pos_order',
          referenceId: id,
          unitCostCents: line.product.cost_cents,
          note: `POS sale ${number}`,
          userId: req.user!.id,
        });
      }

      db.prepare('UPDATE pos_orders SET invoice_id = ?, payment_id = ? WHERE id = ?').run(
        invoice.id,
        (payment as { id: number }).id,
        id,
      );
      return id;
    })();

    recordAudit(req.user!.id, 'sale', 'pos_order', orderId, { totalCents: total });
    res.status(201).json({ order: orderDetail(orderId) });
  }),
);

posRouter.get(
  '/summary',
  requirePermission('pos.view'),
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const todayRow = db
      .prepare(
        `SELECT COUNT(*) AS order_count, COALESCE(SUM(total_cents), 0) AS sales_cents
         FROM pos_orders WHERE status = 'paid' AND date(created_at) = date('now')`,
      )
      .get();
    const openSessions = db
      .prepare(
        `SELECT s.*, r.name AS register_name,
           (SELECT COALESCE(SUM(o.total_cents), 0) FROM pos_orders o
             WHERE o.session_id = s.id AND o.status = 'paid') AS sales_cents
         FROM pos_sessions s JOIN pos_registers r ON r.id = s.register_id
         WHERE s.status = 'open' ORDER BY s.opened_at`,
      )
      .all();
    res.json({ today: todayRow, openSessions });
  }),
);
