import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { ValidationError, notFound } from '../utils/errors.js';
import {
  optionalCents,
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
import { recordAudit } from '../services/audit.js';

export const maintenanceRouter = Router();
maintenanceRouter.use(authenticate);

const REQUEST_STATUSES = ['pending', 'scheduled', 'in_progress', 'done', 'cancelled'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const TYPES = ['preventive', 'corrective'] as const;

const EQUIPMENT_SELECT = `
  SELECT e.*, c.name AS category_name, p.name AS vendor_name,
    (SELECT COUNT(*) FROM maintenance_requests r WHERE r.equipment_id = e.id) AS request_count,
    (SELECT COUNT(*) FROM maintenance_requests r
      WHERE r.equipment_id = e.id AND r.status NOT IN ('done', 'cancelled')) AS open_request_count
  FROM maintenance_equipment e
  LEFT JOIN maintenance_equipment_categories c ON c.id = e.category_id
  LEFT JOIN partners p ON p.id = e.partner_id`;

const REQUEST_SELECT = `
  SELECT r.*, e.name AS equipment_name, e.serial_no, u.first_name || ' ' || u.last_name AS assignee_name
  FROM maintenance_requests r
  JOIN maintenance_equipment e ON e.id = r.equipment_id
  LEFT JOIN users u ON u.id = r.assigned_to`;

/** Technician picker so maintenance does not depend on the Users page being reachable. */
maintenanceRouter.get(
  '/technicians',
  requirePermission('maintenance.view'),
  asyncHandler(async (_req, res) => {
    const technicians = getDb()
      .prepare('SELECT id, first_name, last_name, email FROM users ORDER BY first_name, last_name')
      .all();
    res.json({ technicians });
  }),
);

// Equipment categories
maintenanceRouter.get(
  '/categories',
  requirePermission('maintenance.view'),
  asyncHandler(async (_req, res) => {
    const categories = getDb()
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM maintenance_equipment e WHERE e.category_id = c.id) AS equipment_count
         FROM maintenance_equipment_categories c ORDER BY c.name`,
      )
      .all();
    res.json({ categories });
  }),
);

maintenanceRouter.post(
  '/categories',
  requirePermission('maintenance.manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    try {
      const result = db
        .prepare('INSERT INTO maintenance_equipment_categories (name, note) VALUES (?, ?)')
        .run(
          requireString(req.body?.name, 'Name', 100),
          optionalString(req.body?.note, 'Note', 1000),
        );
      const id = Number(result.lastInsertRowid);
      recordAudit(req.user!.id, 'create', 'maintenance_category', id);
      res.status(201).json({
        category: db.prepare('SELECT * FROM maintenance_equipment_categories WHERE id = ?').get(id),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        throw new ValidationError('A category with that name already exists');
      }
      throw error;
    }
  }),
);

maintenanceRouter.put(
  '/categories/:id',
  requirePermission('maintenance.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db
      .prepare('SELECT * FROM maintenance_equipment_categories WHERE id = ?')
      .get(id) as (Record<string, unknown> & { name: string; note: string | null }) | undefined;
    if (!existing) throw notFound('Category not found');

    db.prepare('UPDATE maintenance_equipment_categories SET name = ?, note = ? WHERE id = ?').run(
      req.body?.name === undefined ? existing.name : requireString(req.body.name, 'Name', 100),
      req.body?.note === undefined ? existing.note : optionalString(req.body.note, 'Note', 1000),
      id,
    );
    recordAudit(req.user!.id, 'update', 'maintenance_category', id);
    res.json({
      category: db.prepare('SELECT * FROM maintenance_equipment_categories WHERE id = ?').get(id),
    });
  }),
);

maintenanceRouter.delete(
  '/categories/:id',
  requirePermission('maintenance.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb()
      .prepare('DELETE FROM maintenance_equipment_categories WHERE id = ?')
      .run(id);
    if (result.changes === 0) throw notFound('Category not found');
    recordAudit(req.user!.id, 'delete', 'maintenance_category', id);
    res.json({ ok: true });
  }),
);

// Equipment
maintenanceRouter.get(
  '/equipment',
  requirePermission('maintenance.view'),
  asyncHandler(async (req, res) => {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (req.query.categoryId) {
      where.push('e.category_id = ?');
      params.push(Number(req.query.categoryId));
    }
    if (req.query.active === '1') where.push('e.is_active = 1');
    if (req.query.active === '0') where.push('e.is_active = 0');
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where.push('(e.name LIKE ? OR e.serial_no LIKE ? OR e.model LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const equipment = getDb()
      .prepare(`${EQUIPMENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.name`)
      .all(...params);
    res.json({ equipment });
  }),
);

maintenanceRouter.get(
  '/equipment/:id',
  requirePermission('maintenance.view'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const equipment = db.prepare(`${EQUIPMENT_SELECT} WHERE e.id = ?`).get(id);
    if (!equipment) throw notFound('Equipment not found');
    const requests = db
      .prepare(`${REQUEST_SELECT} WHERE r.equipment_id = ? ORDER BY r.requested_at DESC`)
      .all(id);
    res.json({ equipment, requests });
  }),
);

maintenanceRouter.post(
  '/equipment',
  requirePermission('maintenance.manage'),
  asyncHandler(async (req, res) => {
    const name = requireString(req.body?.name, 'Name', 200);
    const db = getDb();
    const result = db
      .prepare(
        `INSERT INTO maintenance_equipment
           (name, category_id, partner_id, location, model, serial_no, effective_date,
            warranty_date, scrap_date, cost_cents, note, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        optionalInt(req.body?.categoryId, 'Category', 1),
        optionalInt(req.body?.partnerId, 'Vendor', 1),
        optionalString(req.body?.location, 'Location', 200),
        optionalString(req.body?.model, 'Model', 200),
        optionalString(req.body?.serialNo, 'Serial number', 200),
        optionalDate(req.body?.effectiveDate, 'Effective date'),
        optionalDate(req.body?.warrantyDate, 'Warranty date'),
        optionalDate(req.body?.scrapDate, 'Scrap date'),
        optionalCents(req.body?.costCents, 'Cost') ?? 0,
        optionalString(req.body?.note, 'Note', 5000),
        req.body?.isActive === false ? 0 : 1,
      );
    const id = Number(result.lastInsertRowid);
    recordAudit(req.user!.id, 'create', 'maintenance_equipment', id);
    res.status(201).json({ equipment: db.prepare(`${EQUIPMENT_SELECT} WHERE e.id = ?`).get(id) });
  }),
);

maintenanceRouter.put(
  '/equipment/:id',
  requirePermission('maintenance.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM maintenance_equipment WHERE id = ?').get(id) as
      | (Record<string, unknown> & {
          effective_date: string | null;
          warranty_date: string | null;
          scrap_date: string | null;
        })
      | undefined;
    if (!existing) throw notFound('Equipment not found');

    db.prepare(
      `UPDATE maintenance_equipment SET name = ?, category_id = ?, partner_id = ?, location = ?,
         model = ?, serial_no = ?, effective_date = ?, warranty_date = ?, scrap_date = ?,
         cost_cents = ?, note = ?, is_active = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      req.body?.name === undefined ? existing.name : requireString(req.body.name, 'Name', 200),
      req.body?.categoryId === undefined
        ? (existing.category_id as number | null)
        : optionalInt(req.body.categoryId, 'Category', 1),
      req.body?.partnerId === undefined
        ? (existing.partner_id as number | null)
        : optionalInt(req.body.partnerId, 'Vendor', 1),
      req.body?.location === undefined
        ? (existing.location as string | null)
        : optionalString(req.body.location, 'Location', 200),
      req.body?.model === undefined
        ? (existing.model as string | null)
        : optionalString(req.body.model, 'Model', 200),
      req.body?.serialNo === undefined
        ? (existing.serial_no as string | null)
        : optionalString(req.body.serialNo, 'Serial number', 200),
      req.body?.effectiveDate === undefined
        ? existing.effective_date
        : optionalDate(req.body.effectiveDate, 'Effective date'),
      req.body?.warrantyDate === undefined
        ? existing.warranty_date
        : optionalDate(req.body.warrantyDate, 'Warranty date'),
      req.body?.scrapDate === undefined
        ? existing.scrap_date
        : optionalDate(req.body.scrapDate, 'Scrap date'),
      req.body?.costCents === undefined
        ? existing.cost_cents
        : (optionalCents(req.body.costCents, 'Cost') ?? 0),
      req.body?.note === undefined
        ? (existing.note as string | null)
        : optionalString(req.body.note, 'Note', 5000),
      req.body?.isActive === undefined ? existing.is_active : req.body.isActive ? 1 : 0,
      id,
    );
    recordAudit(req.user!.id, 'update', 'maintenance_equipment', id);
    res.json({ equipment: db.prepare(`${EQUIPMENT_SELECT} WHERE e.id = ?`).get(id) });
  }),
);

maintenanceRouter.delete(
  '/equipment/:id',
  requirePermission('maintenance.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb().prepare('DELETE FROM maintenance_equipment WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('Equipment not found');
    recordAudit(req.user!.id, 'delete', 'maintenance_equipment', id);
    res.json({ ok: true });
  }),
);

// Maintenance requests
maintenanceRouter.get(
  '/requests',
  requirePermission('maintenance.view'),
  asyncHandler(async (req, res) => {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (typeof req.query.status === 'string' && req.query.status !== 'all') {
      where.push('r.status = ?');
      params.push(req.query.status);
    }
    if (req.query.equipmentId) {
      where.push('r.equipment_id = ?');
      params.push(Number(req.query.equipmentId));
    }
    if (req.query.assignedTo) {
      where.push('r.assigned_to = ?');
      params.push(Number(req.query.assignedTo));
    }
    const requests = getDb()
      .prepare(
        `${REQUEST_SELECT} WHERE ${where.join(' AND ')} ORDER BY r.requested_at DESC, r.id DESC LIMIT 300`,
      )
      .all(...params);
    res.json({ requests });
  }),
);

maintenanceRouter.get(
  '/requests/summary',
  requirePermission('maintenance.view'),
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const byStatus = db
      .prepare('SELECT status, COUNT(*) AS count FROM maintenance_requests GROUP BY status')
      .all();
    const open = db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(cost_cents), 0) AS cost_cents
         FROM maintenance_requests WHERE status NOT IN ('done', 'cancelled')`,
      )
      .get();
    const equipmentCount = db
      .prepare('SELECT COUNT(*) AS count FROM maintenance_equipment WHERE is_active = 1')
      .get();
    res.json({ byStatus, open, equipmentCount });
  }),
);

maintenanceRouter.post(
  '/requests',
  requirePermission('maintenance.manage'),
  asyncHandler(async (req, res) => {
    const equipmentId = requireInt(req.body?.equipmentId, 'Equipment', 1);
    const db = getDb();
    if (!db.prepare('SELECT id FROM maintenance_equipment WHERE id = ?').get(equipmentId)) {
      throw notFound('Equipment not found');
    }

    const id = db.transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO maintenance_requests
             (number, subject, equipment_id, maintenance_type, priority, assigned_to,
              requested_at, scheduled_at, duration_hours, cost_cents, description)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          nextNumber('maintenance'),
          requireString(req.body?.subject, 'Subject', 200),
          equipmentId,
          req.body?.maintenanceType === undefined
            ? 'corrective'
            : requireEnum(req.body.maintenanceType, 'Maintenance type', TYPES),
          req.body?.priority === undefined
            ? 'medium'
            : requireEnum(req.body.priority, 'Priority', PRIORITIES),
          optionalInt(req.body?.assignedTo, 'Assignee', 1),
          optionalDate(req.body?.requestedAt, 'Requested date') ??
            new Date().toISOString().slice(0, 10),
          optionalDate(req.body?.scheduledAt, 'Scheduled date'),
          optionalNumber(req.body?.durationHours, 'Duration', 0, 1000) ?? 0,
          optionalCents(req.body?.costCents, 'Cost') ?? 0,
          optionalString(req.body?.description, 'Description', 5000),
        );
      return Number(result.lastInsertRowid);
    })();

    recordAudit(req.user!.id, 'create', 'maintenance_request', id);
    res.status(201).json({ request: db.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).get(id) });
  }),
);

maintenanceRouter.put(
  '/requests/:id',
  requirePermission('maintenance.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM maintenance_requests WHERE id = ?').get(id) as
      | (Record<string, unknown> & {
          status: string;
          requested_at: string;
          scheduled_at: string | null;
          closed_at: string | null;
        })
      | undefined;
    if (!existing) throw notFound('Maintenance request not found');
    if (existing.status === 'done' || existing.status === 'cancelled') {
      throw new ValidationError('Completed or cancelled requests cannot be edited');
    }

    db.prepare(
      `UPDATE maintenance_requests SET subject = ?, equipment_id = ?, maintenance_type = ?,
         priority = ?, assigned_to = ?, requested_at = ?, scheduled_at = ?, duration_hours = ?,
         cost_cents = ?, description = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      req.body?.subject === undefined
        ? existing.subject
        : requireString(req.body.subject, 'Subject', 200),
      req.body?.equipmentId === undefined
        ? existing.equipment_id
        : requireInt(req.body.equipmentId, 'Equipment', 1),
      req.body?.maintenanceType === undefined
        ? existing.maintenance_type
        : requireEnum(req.body.maintenanceType, 'Maintenance type', TYPES),
      req.body?.priority === undefined
        ? existing.priority
        : requireEnum(req.body.priority, 'Priority', PRIORITIES),
      req.body?.assignedTo === undefined
        ? (existing.assigned_to as number | null)
        : optionalInt(req.body.assignedTo, 'Assignee', 1),
      existing.requested_at,
      req.body?.scheduledAt === undefined
        ? existing.scheduled_at
        : optionalDate(req.body.scheduledAt, 'Scheduled date'),
      req.body?.durationHours === undefined
        ? existing.duration_hours
        : (optionalNumber(req.body.durationHours, 'Duration', 0, 1000) ?? 0),
      req.body?.costCents === undefined
        ? existing.cost_cents
        : (optionalCents(req.body.costCents, 'Cost') ?? 0),
      req.body?.description === undefined
        ? (existing.description as string | null)
        : optionalString(req.body.description, 'Description', 5000),
      id,
    );
    recordAudit(req.user!.id, 'update', 'maintenance_request', id);
    res.json({ request: db.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).get(id) });
  }),
);

maintenanceRouter.post(
  '/requests/:id/status',
  requirePermission('maintenance.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const status = requireEnum(req.body?.status, 'Status', REQUEST_STATUSES);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM maintenance_requests WHERE id = ?').get(id) as
      | (Record<string, unknown> & {
          status: string;
          resolution: string | null;
          scheduled_at: string | null;
        })
      | undefined;
    if (!existing) throw notFound('Maintenance request not found');
    if (existing.status === 'done' || existing.status === 'cancelled') {
      throw new ValidationError('Completed or cancelled requests cannot change status');
    }

    const closedAt =
      status === 'done'
        ? (optionalDate(req.body?.closedAt, 'Closed date') ?? new Date().toISOString().slice(0, 10))
        : null;
    db.prepare(
      `UPDATE maintenance_requests SET status = ?, resolution = ?, duration_hours = ?,
         cost_cents = ?, scheduled_at = ?, closed_at = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      status,
      optionalString(req.body?.resolution, 'Resolution', 5000) ??
        (existing.resolution as string | null),
      optionalNumber(req.body?.durationHours, 'Duration', 0, 1000) ?? existing.duration_hours,
      optionalCents(req.body?.costCents, 'Cost') ?? existing.cost_cents,
      optionalDate(req.body?.scheduledAt, 'Scheduled date') ??
        (existing.scheduled_at as string | null),
      closedAt,
      id,
    );
    recordAudit(req.user!.id, `status:${status}`, 'maintenance_request', id);
    res.json({ request: db.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).get(id) });
  }),
);

maintenanceRouter.delete(
  '/requests/:id',
  requirePermission('maintenance.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const existing = getDb()
      .prepare('SELECT status FROM maintenance_requests WHERE id = ?')
      .get(id) as { status: string } | undefined;
    if (!existing) throw notFound('Maintenance request not found');
    if (existing.status === 'in_progress' || existing.status === 'done') {
      throw new ValidationError('In-progress or completed requests cannot be deleted');
    }
    getDb().prepare('DELETE FROM maintenance_requests WHERE id = ?').run(id);
    recordAudit(req.user!.id, 'delete', 'maintenance_request', id);
    res.json({ ok: true });
  }),
);
