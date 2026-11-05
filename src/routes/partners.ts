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
  requireString,
} from '../utils/validate.js';
import { recordAudit } from '../services/audit.js';

export const partnersRouter = Router();
partnersRouter.use(authenticate);

const BASE_SELECT = `
  SELECT p.*,
    COALESCE((SELECT SUM(i.total_cents - i.amount_paid_cents) FROM invoices i
              WHERE i.partner_id = p.id AND i.direction = 'sale' AND i.status = 'open'), 0) AS receivable_cents,
    COALESCE((SELECT SUM(i.total_cents - i.amount_paid_cents) FROM invoices i
              WHERE i.partner_id = p.id AND i.direction = 'purchase' AND i.status = 'open'), 0) AS payable_cents
  FROM partners p`;

partnersRouter.get(
  '/',
  requirePermission('partners.view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where.push('(p.name LIKE ? OR p.email LIKE ? OR p.phone LIKE ? OR p.vat_number LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (req.query.type === 'customer') where.push('p.is_customer = 1');
    if (req.query.type === 'supplier') where.push('p.is_supplier = 1');
    if (req.query.active === 'true') where.push('p.is_active = 1');
    if (req.query.active === 'false') where.push('p.is_active = 0');

    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const total = (
      db.prepare(`SELECT COUNT(*) AS count FROM partners p ${whereSql}`).get(...params) as {
        count: number;
      }
    ).count;
    const partners = db
      .prepare(`${BASE_SELECT} ${whereSql} ORDER BY p.name LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);

    res.json({ partners, total });
  }),
);

partnersRouter.get(
  '/:id',
  requirePermission('partners.view'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const partner = getDb().prepare(`${BASE_SELECT} WHERE p.id = ?`).get(id);
    if (!partner) throw notFound('Partner not found');
    res.json({ partner });
  }),
);

partnersRouter.get(
  '/:id/statement',
  requirePermission('partners.view'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const partner = db.prepare('SELECT * FROM partners WHERE id = ?').get(id) as
      (Record<string, unknown> & { is_customer: number; is_supplier: number }) | undefined;
    if (!partner) throw notFound('Partner not found');

    const from = optionalDate(req.query.from, 'From date') ?? '0000-01-01';
    const to = optionalDate(req.query.to, 'To date') ?? '9999-12-31';
    const direction = req.query.direction === 'purchase' ? 'purchase' : 'sale';

    const invoices = db
      .prepare(
        `SELECT id, number, issue_date, due_date, total_cents, amount_paid_cents,
                COALESCE((SELECT SUM(c.total_cents) FROM credit_notes c
                          WHERE c.invoice_id = invoices.id AND c.status = 'posted'), 0) AS credited_cents,
                MAX(0, total_cents - amount_paid_cents -
                  COALESCE((SELECT SUM(c.total_cents) FROM credit_notes c
                            WHERE c.invoice_id = invoices.id AND c.status = 'posted'), 0)) AS outstanding_cents,
                status
         FROM invoices WHERE partner_id = ? AND direction = ? AND status <> 'void' AND issue_date BETWEEN ? AND ?
         ORDER BY issue_date, id`,
      )
      .all(id, direction, from, to);
    const payments = db
      .prepare(
        `SELECT id, number, payment_date, amount_cents, method, reference
         FROM payments WHERE partner_id = ? AND direction = ? AND payment_date BETWEEN ? AND ?
         ORDER BY payment_date, id`,
      )
      .all(id, direction === 'sale' ? 'in' : 'out', from, to);
    const creditNotes = db
      .prepare(
        `SELECT c.id, c.number, c.issue_date, c.subtotal_cents, c.tax_cents, c.total_cents,
                c.reason, i.number AS invoice_number
         FROM credit_notes c JOIN invoices i ON i.id = c.invoice_id
         WHERE c.partner_id = ? AND i.direction = ? AND c.status = 'posted'
           AND c.issue_date BETWEEN ? AND ?
         ORDER BY c.issue_date, c.id`,
      )
      .all(id, direction, from, to);

    res.json({ partner, direction, from, to, invoices, payments, creditNotes });
  }),
);

partnersRouter.post(
  '/',
  requirePermission('partners.manage'),
  asyncHandler(async (req, res) => {
    const name = requireString(req.body?.name, 'Name', 200);
    const isCustomer = req.body?.isCustomer === true;
    const isSupplier = req.body?.isSupplier === true;
    if (!isCustomer && !isSupplier) throw new ValidationError('Choose customer, supplier, or both');

    const db = getDb();
    const result = db
      .prepare(
        `INSERT INTO partners
           (name, is_customer, is_supplier, contact_name, email, phone, vat_number, registration_number,
            address_line1, address_line2, city, province, postal_code, country, credit_limit_cents,
            payment_terms_days, is_active, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        isCustomer ? 1 : 0,
        isSupplier ? 1 : 0,
        optionalString(req.body?.contactName, 'Contact name', 200),
        optionalString(req.body?.email, 'Email', 320),
        optionalString(req.body?.phone, 'Phone', 50),
        optionalString(req.body?.vatNumber, 'VAT number', 50),
        optionalString(req.body?.registrationNumber, 'Registration number', 50),
        optionalString(req.body?.addressLine1, 'Address line 1', 200),
        optionalString(req.body?.addressLine2, 'Address line 2', 200),
        optionalString(req.body?.city, 'City', 100),
        optionalString(req.body?.province, 'Province', 100),
        optionalString(req.body?.postalCode, 'Postal code', 20),
        optionalString(req.body?.country, 'Country', 100) ?? 'South Africa',
        optionalInt(req.body?.creditLimitCents, 'Credit limit', 0) ?? 0,
        optionalInt(req.body?.paymentTermsDays, 'Payment terms', 0, 365) ?? 30,
        req.body?.isActive === false ? 0 : 1,
        optionalString(req.body?.notes, 'Notes', 5000),
      );

    const id = Number(result.lastInsertRowid);
    recordAudit(req.user!.id, 'create', 'partner', id, { name });
    res.status(201).json({ partner: db.prepare(`${BASE_SELECT} WHERE p.id = ?`).get(id) });
  }),
);

partnersRouter.put(
  '/:id',
  requirePermission('partners.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM partners WHERE id = ?').get(id) as
      | (Record<string, unknown> & { name: string; is_customer: number; is_supplier: number })
      | undefined;
    if (!existing) throw notFound('Partner not found');

    const name =
      req.body?.name === undefined ? existing.name : requireString(req.body.name, 'Name', 200);
    const isCustomer =
      req.body?.isCustomer === undefined
        ? existing.is_customer
        : req.body.isCustomer === true
          ? 1
          : 0;
    const isSupplier =
      req.body?.isSupplier === undefined
        ? existing.is_supplier
        : req.body.isSupplier === true
          ? 1
          : 0;
    if (!isCustomer && !isSupplier) throw new ValidationError('Choose customer, supplier, or both');

    const text = (key: string, label: string, max: number, column: string) =>
      req.body?.[key] === undefined
        ? (existing[column] as string | null)
        : optionalString(req.body[key], label, max);

    db.prepare(
      `UPDATE partners SET
         name = ?, is_customer = ?, is_supplier = ?,
         contact_name = ?, email = ?, phone = ?, vat_number = ?, registration_number = ?,
         address_line1 = ?, address_line2 = ?, city = ?, province = ?, postal_code = ?, country = ?,
         credit_limit_cents = ?, payment_terms_days = ?, is_active = ?, notes = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      name,
      isCustomer,
      isSupplier,
      text('contactName', 'Contact name', 200, 'contact_name'),
      text('email', 'Email', 320, 'email'),
      text('phone', 'Phone', 50, 'phone'),
      text('vatNumber', 'VAT number', 50, 'vat_number'),
      text('registrationNumber', 'Registration number', 50, 'registration_number'),
      text('addressLine1', 'Address line 1', 200, 'address_line1'),
      text('addressLine2', 'Address line 2', 200, 'address_line2'),
      text('city', 'City', 100, 'city'),
      text('province', 'Province', 100, 'province'),
      text('postalCode', 'Postal code', 20, 'postal_code'),
      text('country', 'Country', 100, 'country') ?? 'South Africa',
      req.body?.creditLimitCents === undefined
        ? existing.credit_limit_cents
        : (optionalInt(req.body.creditLimitCents, 'Credit limit', 0) ?? 0),
      req.body?.paymentTermsDays === undefined
        ? existing.payment_terms_days
        : (optionalInt(req.body.paymentTermsDays, 'Payment terms', 0, 365) ?? 30),
      req.body?.isActive === undefined ? existing.is_active : req.body.isActive ? 1 : 0,
      text('notes', 'Notes', 5000, 'notes'),
      id,
    );

    recordAudit(req.user!.id, 'update', 'partner', id, { name });
    res.json({ partner: db.prepare(`${BASE_SELECT} WHERE p.id = ?`).get(id) });
  }),
);

partnersRouter.delete(
  '/:id',
  requirePermission('partners.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const used = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM invoices WHERE partner_id = ?) +
                (SELECT COUNT(*) FROM payments WHERE partner_id = ?) +
                (SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = ?) +
                (SELECT COUNT(*) FROM sales_orders WHERE customer_id = ?) AS count`,
      )
      .get(id, id, id, id) as { count: number };
    if (used.count > 0) {
      throw new ValidationError(
        'This partner has transactions and cannot be deleted. Mark it inactive instead.',
      );
    }
    const result = db.prepare('DELETE FROM partners WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('Partner not found');
    recordAudit(req.user!.id, 'delete', 'partner', id);
    res.json({ ok: true });
  }),
);
