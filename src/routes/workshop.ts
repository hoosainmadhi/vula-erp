import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { ValidationError, HttpError, notFound } from '../utils/errors.js';
import {
  optionalCents,
  optionalDate,
  optionalInt,
  optionalString,
  paramId,
  requireEnum,
  requireString,
} from '../utils/validate.js';
import { nextNumber } from '../services/sequences.js';
import { recordAudit } from '../services/audit.js';

export const workshopRouter = Router();
workshopRouter.use(authenticate);

const STATUSES = [
  'awaiting_payment',
  'queued',
  'in_progress',
  'ready',
  'collected',
  'cancelled',
] as const;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const DEFAULT_OPERATIONS = ['Cutting', 'Edging', 'Quality check', 'Collection'];

const JOB_SELECT = `
  SELECT j.*, p.name AS customer_name, i.number AS invoice_number, i.status AS invoice_status,
         u.first_name || ' ' || u.last_name AS assignee_name,
         (SELECT COUNT(*) FROM workshop_job_operations o WHERE o.job_id = j.id) AS operation_count,
         (SELECT COUNT(*) FROM workshop_job_operations o WHERE o.job_id = j.id AND o.status = 'done') AS done_operation_count
  FROM workshop_jobs j
  LEFT JOIN partners p ON p.id = j.customer_id
  LEFT JOIN invoices i ON i.id = j.invoice_id
  LEFT JOIN users u ON u.id = j.assigned_to`;

interface JobRow {
  id: number;
  number: string;
  status: string;
  invoice_id: number | null;
  payment_required: number;
  assigned_to: number | null;
  created_by: number | null;
}

function jobRow(id: number): JobRow {
  const job = getDb()
    .prepare(
      `SELECT id, number, status, invoice_id, payment_required, assigned_to, created_by
       FROM workshop_jobs WHERE id = ?`,
    )
    .get(id) as JobRow | undefined;
  if (!job) throw notFound('Workshop job not found');
  return job;
}

/** Workshop staff only see unassigned jobs or jobs assigned to them. */
function workshopScoped(user: { id: number; roles: string[] }): boolean {
  return user.roles.includes('workshop') && !user.roles.includes('admin');
}

function assertJobAccess(job: JobRow, user: { id: number; roles: string[] }): void {
  if (!workshopScoped(user)) return;
  if (job.assigned_to !== null && job.assigned_to !== user.id) {
    throw new HttpError(403, 'This job is assigned to another workshop user', 'forbidden');
  }
}

function assertPaid(job: JobRow): void {
  if (job.payment_required !== 1) return;
  if (!job.invoice_id) {
    throw new ValidationError('Link a paid invoice or turn off the payment requirement');
  }
  const invoice = getDb()
    .prepare('SELECT status FROM invoices WHERE id = ?')
    .get(job.invoice_id) as { status: string } | undefined;
  if (!invoice || invoice.status !== 'paid') {
    throw new ValidationError('The linked invoice must be paid before production can start');
  }
}

function jobDetail(id: number) {
  const db = getDb();
  const job = db.prepare(`${JOB_SELECT} WHERE j.id = ?`).get(id);
  if (!job) throw notFound('Workshop job not found');
  const operations = db
    .prepare(
      `SELECT o.*, u.first_name || ' ' || u.last_name AS assignee_name
       FROM workshop_job_operations o
       LEFT JOIN users u ON u.id = o.assigned_to
       WHERE o.job_id = ? ORDER BY o.sequence, o.id`,
    )
    .all(id);
  const files = db
    .prepare(
      `SELECT id, filename, mime_type, size_bytes, created_at
       FROM workshop_job_files WHERE job_id = ? ORDER BY id`,
    )
    .all(id);
  return { ...(job as Record<string, unknown>), operations, files };
}

// Options for the job form
workshopRouter.get(
  '/options',
  requirePermission('workshop.view'),
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const customers = db
      .prepare('SELECT id, name FROM partners WHERE is_customer = 1 ORDER BY name')
      .all();
    const users = db
      .prepare(
        'SELECT id, first_name, last_name FROM users WHERE is_active = 1 ORDER BY first_name, last_name',
      )
      .all();
    const invoices = db
      .prepare(
        `SELECT i.id, i.number, i.status, i.total_cents, p.name AS partner_name
         FROM invoices i JOIN partners p ON p.id = i.partner_id
         WHERE i.direction = 'sale' ORDER BY i.id DESC LIMIT 200`,
      )
      .all();
    const salesOrders = db
      .prepare(
        `SELECT so.id, so.number, so.status, p.name AS customer_name
         FROM sales_orders so JOIN partners p ON p.id = so.customer_id
         ORDER BY so.id DESC LIMIT 200`,
      )
      .all();
    res.json({ customers, users, invoices, salesOrders });
  }),
);

// Jobs
workshopRouter.get(
  '/jobs',
  requirePermission('workshop.view'),
  asyncHandler(async (req, res) => {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (typeof req.query.status === 'string' && req.query.status !== 'all') {
      where.push('j.status = ?');
      params.push(req.query.status);
    }
    if (req.query.assignedTo) {
      where.push('j.assigned_to = ?');
      params.push(Number(req.query.assignedTo));
    }
    if (workshopScoped(req.user!)) {
      where.push('(j.assigned_to IS NULL OR j.assigned_to = ?)');
      params.push(req.user!.id);
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where.push('(j.number LIKE ? OR j.title LIKE ? OR p.name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const jobs = getDb()
      .prepare(`${JOB_SELECT} WHERE ${where.join(' AND ')} ORDER BY j.id DESC LIMIT 300`)
      .all(...params);
    res.json({ jobs });
  }),
);

workshopRouter.get(
  '/jobs/:id',
  requirePermission('workshop.view'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    assertJobAccess(jobRow(id), req.user!);
    res.json({ job: jobDetail(id) });
  }),
);

workshopRouter.post(
  '/jobs',
  requirePermission('workshop.manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const customerId = optionalInt(req.body?.customerId, 'Customer', 1);
    if (customerId && !db.prepare('SELECT id FROM partners WHERE id = ?').get(customerId)) {
      throw notFound('Customer not found');
    }
    const invoiceId = optionalInt(req.body?.invoiceId, 'Invoice', 1);
    if (invoiceId && !db.prepare('SELECT id FROM invoices WHERE id = ?').get(invoiceId)) {
      throw notFound('Invoice not found');
    }
    const salesOrderId = optionalInt(req.body?.salesOrderId, 'Sales order', 1);
    if (salesOrderId && !db.prepare('SELECT id FROM sales_orders WHERE id = ?').get(salesOrderId)) {
      throw notFound('Sales order not found');
    }
    const operations = Array.isArray(req.body?.operations)
      ? (req.body.operations as unknown[]).map((name) => requireString(name, 'Operation', 100))
      : DEFAULT_OPERATIONS;

    const id = db.transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO workshop_jobs
             (number, customer_id, sales_order_id, invoice_id, title, status, priority, due_date,
              assigned_to, payment_required, quoted_cents, material_cost_cents, labour_cost_cents,
              expense_cost_cents, cutting_list_notes, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          nextNumber('workshop_job'),
          customerId,
          salesOrderId,
          invoiceId,
          requireString(req.body?.title, 'Title', 300),
          req.body?.status === undefined
            ? 'awaiting_payment'
            : requireEnum(req.body.status, 'Status', STATUSES),
          req.body?.priority === undefined
            ? 'medium'
            : requireEnum(req.body.priority, 'Priority', PRIORITIES),
          optionalDate(req.body?.dueDate, 'Due date'),
          optionalInt(req.body?.assignedTo, 'Assignee', 1),
          req.body?.paymentRequired === false ? 0 : 1,
          optionalCents(req.body?.quotedCents, 'Quoted amount') ?? 0,
          optionalCents(req.body?.materialCostCents, 'Material cost') ?? 0,
          optionalCents(req.body?.labourCostCents, 'Labour cost') ?? 0,
          optionalCents(req.body?.expenseCostCents, 'Expense cost') ?? 0,
          optionalString(req.body?.cuttingListNotes, 'Cutting list notes', 20_000),
          optionalString(req.body?.notes, 'Notes', 5000),
          req.user!.id,
        );
      const jobId = Number(result.lastInsertRowid);
      const insertOperation = db.prepare(
        'INSERT INTO workshop_job_operations (job_id, name, sequence) VALUES (?, ?, ?)',
      );
      operations.forEach((name, index) => insertOperation.run(jobId, name, index + 1));
      return jobId;
    })();

    recordAudit(req.user!.id, 'create', 'workshop_job', id);
    res.status(201).json({ job: jobDetail(id) });
  }),
);

workshopRouter.put(
  '/jobs/:id',
  requirePermission('workshop.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM workshop_jobs WHERE id = ?').get(id) as
      (Record<string, unknown> & { status: string; title: string }) | undefined;
    if (!existing) throw notFound('Workshop job not found');
    if (existing.status === 'collected' || existing.status === 'cancelled') {
      throw new ValidationError('Collected or cancelled jobs cannot be edited');
    }

    db.prepare(
      `UPDATE workshop_jobs SET title = ?, customer_id = ?, sales_order_id = ?, invoice_id = ?,
         priority = ?, due_date = ?, assigned_to = ?, payment_required = ?, quoted_cents = ?,
         material_cost_cents = ?, labour_cost_cents = ?, expense_cost_cents = ?,
         cutting_list_notes = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(
      req.body?.title === undefined ? existing.title : requireString(req.body.title, 'Title', 300),
      req.body?.customerId === undefined
        ? (existing.customer_id as number | null)
        : optionalInt(req.body.customerId, 'Customer', 1),
      req.body?.salesOrderId === undefined
        ? (existing.sales_order_id as number | null)
        : optionalInt(req.body.salesOrderId, 'Sales order', 1),
      req.body?.invoiceId === undefined
        ? (existing.invoice_id as number | null)
        : optionalInt(req.body.invoiceId, 'Invoice', 1),
      req.body?.priority === undefined
        ? existing.priority
        : requireEnum(req.body.priority, 'Priority', PRIORITIES),
      req.body?.dueDate === undefined
        ? (existing.due_date as string | null)
        : optionalDate(req.body.dueDate, 'Due date'),
      req.body?.assignedTo === undefined
        ? (existing.assigned_to as number | null)
        : optionalInt(req.body.assignedTo, 'Assignee', 1),
      req.body?.paymentRequired === undefined
        ? existing.payment_required
        : req.body.paymentRequired
          ? 1
          : 0,
      req.body?.quotedCents === undefined
        ? existing.quoted_cents
        : (optionalCents(req.body.quotedCents, 'Quoted amount') ?? 0),
      req.body?.materialCostCents === undefined
        ? existing.material_cost_cents
        : (optionalCents(req.body.materialCostCents, 'Material cost') ?? 0),
      req.body?.labourCostCents === undefined
        ? existing.labour_cost_cents
        : (optionalCents(req.body.labourCostCents, 'Labour cost') ?? 0),
      req.body?.expenseCostCents === undefined
        ? existing.expense_cost_cents
        : (optionalCents(req.body.expenseCostCents, 'Expense cost') ?? 0),
      req.body?.cuttingListNotes === undefined
        ? (existing.cutting_list_notes as string | null)
        : optionalString(req.body.cuttingListNotes, 'Cutting list notes', 20_000),
      req.body?.notes === undefined
        ? (existing.notes as string | null)
        : optionalString(req.body.notes, 'Notes', 5000),
      id,
    );
    recordAudit(req.user!.id, 'update', 'workshop_job', id);
    res.json({ job: jobDetail(id) });
  }),
);

workshopRouter.post(
  '/jobs/:id/release',
  requirePermission('workshop.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const job = jobRow(id);
    assertJobAccess(job, req.user!);
    if (job.status !== 'awaiting_payment') {
      throw new ValidationError('Only jobs awaiting payment can be released');
    }
    assertPaid(job);
    getDb()
      .prepare(
        "UPDATE workshop_jobs SET status = 'queued', updated_at = datetime('now') WHERE id = ?",
      )
      .run(id);
    recordAudit(req.user!.id, 'release', 'workshop_job', id);
    res.json({ job: jobDetail(id) });
  }),
);

workshopRouter.post(
  '/jobs/:id/operations/:operationId/start',
  requirePermission('workshop.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const operationId = paramId(req.params.operationId, 'operation id');
    const job = jobRow(id);
    assertJobAccess(job, req.user!);
    if (job.status !== 'queued' && job.status !== 'in_progress') {
      throw new ValidationError('Release the job before starting operations');
    }
    const db = getDb();
    const operation = db
      .prepare('SELECT status FROM workshop_job_operations WHERE id = ? AND job_id = ?')
      .get(operationId, id) as { status: string } | undefined;
    if (!operation) throw notFound('Operation not found');
    if (operation.status !== 'pending')
      throw new ValidationError('Only pending operations can be started');
    db.prepare(
      "UPDATE workshop_job_operations SET status = 'in_progress', started_at = datetime('now') WHERE id = ?",
    ).run(operationId);
    db.prepare(
      "UPDATE workshop_jobs SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?",
    ).run(id);
    recordAudit(req.user!.id, 'start', 'workshop_operation', operationId);
    res.json({ job: jobDetail(id) });
  }),
);

workshopRouter.post(
  '/jobs/:id/operations/:operationId/complete',
  requirePermission('workshop.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const operationId = paramId(req.params.operationId, 'operation id');
    jobRow(id);
    const db = getDb();
    const operation = db
      .prepare('SELECT status FROM workshop_job_operations WHERE id = ? AND job_id = ?')
      .get(operationId, id) as { status: string } | undefined;
    if (!operation) throw notFound('Operation not found');
    if (operation.status === 'done') throw new ValidationError('Operation is already complete');
    db.prepare(
      "UPDATE workshop_job_operations SET status = 'done', finished_at = datetime('now') WHERE id = ?",
    ).run(operationId);
    const pending = db
      .prepare(
        "SELECT COUNT(*) AS count FROM workshop_job_operations WHERE job_id = ? AND status <> 'done'",
      )
      .get(id) as { count: number };
    if (pending.count === 0) {
      db.prepare(
        "UPDATE workshop_jobs SET status = 'ready', updated_at = datetime('now') WHERE id = ?",
      ).run(id);
    }
    recordAudit(req.user!.id, 'complete', 'workshop_operation', operationId);
    res.json({ job: jobDetail(id) });
  }),
);

workshopRouter.post(
  '/jobs/:id/collect',
  requirePermission('workshop.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const job = jobRow(id);
    assertJobAccess(job, req.user!);
    if (job.status !== 'ready') {
      throw new ValidationError('Only ready jobs can be collected');
    }
    getDb()
      .prepare(
        "UPDATE workshop_jobs SET status = 'collected', updated_at = datetime('now') WHERE id = ?",
      )
      .run(id);
    recordAudit(req.user!.id, 'collect', 'workshop_job', id);
    res.json({ job: jobDetail(id) });
  }),
);

workshopRouter.post(
  '/jobs/:id/cancel',
  requirePermission('workshop.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const job = jobRow(id);
    assertJobAccess(job, req.user!);
    if (job.status === 'collected') throw new ValidationError('Collected jobs cannot be cancelled');
    getDb()
      .prepare(
        "UPDATE workshop_jobs SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?",
      )
      .run(id);
    recordAudit(req.user!.id, 'cancel', 'workshop_job', id);
    res.json({ job: jobDetail(id) });
  }),
);

workshopRouter.delete(
  '/jobs/:id',
  requirePermission('workshop.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const job = jobRow(id);
    assertJobAccess(job, req.user!);
    if (job.status === 'collected') throw new ValidationError('Collected jobs cannot be deleted');
    getDb().prepare('DELETE FROM workshop_jobs WHERE id = ?').run(id);
    recordAudit(req.user!.id, 'delete', 'workshop_job', id);
    res.json({ ok: true });
  }),
);

// Cutting lists / attachments
workshopRouter.post(
  '/jobs/:id/files',
  requirePermission('workshop.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    jobRow(id);
    const filename = requireString(req.body?.filename, 'Filename', 255);
    const mimeType = requireString(req.body?.mimeType, 'MIME type', 100);
    const data = requireString(req.body?.dataBase64, 'File data', 12_000_000);
    const buffer = Buffer.from(data, 'base64');
    if (buffer.length === 0) throw new ValidationError('File is empty');
    if (buffer.length > 8 * 1024 * 1024) throw new ValidationError('File must be 8MB or smaller');
    const result = getDb()
      .prepare(
        `INSERT INTO workshop_job_files (job_id, filename, mime_type, size_bytes, content, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, filename, mimeType, buffer.length, buffer, req.user!.id);
    recordAudit(req.user!.id, 'upload', 'workshop_job', id, { filename });
    res.status(201).json({
      file: getDb()
        .prepare(
          'SELECT id, filename, mime_type, size_bytes, created_at FROM workshop_job_files WHERE id = ?',
        )
        .get(Number(result.lastInsertRowid)),
    });
  }),
);

workshopRouter.get(
  '/jobs/:id/files/:fileId',
  requirePermission('workshop.view'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const fileId = paramId(req.params.fileId, 'file id');
    const file = getDb()
      .prepare(
        'SELECT filename, mime_type, content FROM workshop_job_files WHERE id = ? AND job_id = ?',
      )
      .get(fileId, id) as { filename: string; mime_type: string; content: Buffer } | undefined;
    if (!file) throw notFound('File not found');
    res.setHeader('Content-Type', file.mime_type);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename.replace(/"/g, '')}"`,
    );
    res.send(file.content);
  }),
);

workshopRouter.delete(
  '/jobs/:id/files/:fileId',
  requirePermission('workshop.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const fileId = paramId(req.params.fileId, 'file id');
    const result = getDb()
      .prepare('DELETE FROM workshop_job_files WHERE id = ? AND job_id = ?')
      .run(fileId, id);
    if (result.changes === 0) throw notFound('File not found');
    recordAudit(req.user!.id, 'delete', 'workshop_file', fileId);
    res.json({ ok: true });
  }),
);

workshopRouter.get(
  '/summary',
  requirePermission('workshop.view'),
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const byStatus = db
      .prepare('SELECT status, COUNT(*) AS count FROM workshop_jobs GROUP BY status')
      .all();
    const open = db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(quoted_cents), 0) AS quoted_cents
         FROM workshop_jobs WHERE status IN ('awaiting_payment', 'queued', 'in_progress', 'ready')`,
      )
      .get();
    res.json({ byStatus, open });
  }),
);
