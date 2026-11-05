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
import { recordAudit } from '../services/audit.js';

export const timesheetsRouter = Router();
timesheetsRouter.use(authenticate);

const EDITABLE = new Set(['draft', 'rejected']);

const TIMESHEET_SELECT = `
  SELECT t.*, e.first_name || ' ' || e.last_name AS employee_name, e.employee_number,
         p.code AS project_code, p.name AS project_name
  FROM timesheets t
  JOIN employees e ON e.id = t.employee_id
  LEFT JOIN projects p ON p.id = t.project_id`;

/** Employee picker so this module works without the HR module enabled. */
timesheetsRouter.get(
  '/employees',
  requirePermission('hr.view'),
  asyncHandler(async (_req, res) => {
    const employees = getDb()
      .prepare(
        `SELECT id, employee_number, first_name, last_name, status
         FROM employees WHERE status <> 'terminated'
         ORDER BY last_name, first_name`,
      )
      .all();
    res.json({ employees });
  }),
);

timesheetsRouter.get(
  '/projects',
  requirePermission('hr.view'),
  asyncHandler(async (_req, res) => {
    const projects = getDb()
      .prepare(
        `SELECT id, code, name, status FROM projects
         WHERE status IN ('planned', 'active') ORDER BY name`,
      )
      .all();
    res.json({ projects });
  }),
);

timesheetsRouter.get(
  '/',
  requirePermission('hr.view'),
  asyncHandler(async (req, res) => {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (req.query.employeeId) {
      where.push('t.employee_id = ?');
      params.push(Number(req.query.employeeId));
    }
    if (req.query.projectId) {
      where.push('t.project_id = ?');
      params.push(Number(req.query.projectId));
    }
    if (typeof req.query.status === 'string' && req.query.status !== 'all') {
      where.push('t.status = ?');
      params.push(req.query.status);
    }
    if (typeof req.query.from === 'string' && req.query.from !== '') {
      where.push('t.work_date >= ?');
      params.push(req.query.from);
    }
    if (typeof req.query.to === 'string' && req.query.to !== '') {
      where.push('t.work_date <= ?');
      params.push(req.query.to);
    }

    const timesheets = getDb()
      .prepare(
        `${TIMESHEET_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.work_date DESC, t.id DESC LIMIT 500`,
      )
      .all(...params);
    res.json({ timesheets });
  }),
);

timesheetsRouter.get(
  '/summary',
  requirePermission('hr.view'),
  asyncHandler(async (req, res) => {
    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';
    if (!from || !to) throw new ValidationError('From and to dates are required');

    const rows = getDb()
      .prepare(
        `SELECT e.id AS employee_id, e.employee_number,
                e.first_name || ' ' || e.last_name AS employee_name,
                COALESCE(SUM(t.hours), 0) AS total_hours,
                COALESCE(SUM(CASE WHEN t.billable = 1 THEN t.hours END), 0) AS billable_hours,
                COUNT(*) AS entries
         FROM timesheets t JOIN employees e ON e.id = t.employee_id
         WHERE t.work_date >= ? AND t.work_date <= ? AND t.status <> 'rejected'
         GROUP BY e.id ORDER BY e.last_name, e.first_name`,
      )
      .all(from, to);
    res.json({ from, to, summary: rows });
  }),
);

function assertEmployeeAndProject(employeeId: number, projectId: number | null): void {
  const db = getDb();
  if (!db.prepare('SELECT id FROM employees WHERE id = ?').get(employeeId)) {
    throw new ValidationError('Employee not found');
  }
  if (projectId !== null && !db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) {
    throw new ValidationError('Project not found');
  }
}

timesheetsRouter.post(
  '/',
  requirePermission('hr.manage'),
  asyncHandler(async (req, res) => {
    const employeeId = requireInt(req.body?.employeeId, 'Employee', 1);
    const projectId = optionalInt(req.body?.projectId, 'Project', 1);
    const workDate = requireDate(req.body?.workDate, 'Work date');
    const hours = requireNumber(req.body?.hours, 'Hours', 0.01, 24);
    assertEmployeeAndProject(employeeId, projectId);

    const result = getDb()
      .prepare(
        `INSERT INTO timesheets (employee_id, project_id, work_date, hours, task, notes, billable)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        employeeId,
        projectId,
        workDate,
        hours,
        optionalString(req.body?.task, 'Task', 200),
        optionalString(req.body?.notes, 'Notes', 2000),
        req.body?.billable === false ? 0 : 1,
      );
    const id = Number(result.lastInsertRowid);
    recordAudit(req.user!.id, 'create', 'timesheet', id, { hours });
    res
      .status(201)
      .json({ timesheet: getDb().prepare(`${TIMESHEET_SELECT} WHERE t.id = ?`).get(id) });
  }),
);

timesheetsRouter.put(
  '/:id',
  requirePermission('hr.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM timesheets WHERE id = ?').get(id) as
      (Record<string, unknown> & { status: string }) | undefined;
    if (!existing) throw notFound('Timesheet not found');
    if (!EDITABLE.has(existing.status)) {
      throw new ValidationError(
        `Only draft or rejected timesheets can be edited (this one is ${existing.status})`,
      );
    }

    const employeeId =
      req.body?.employeeId === undefined
        ? (existing.employee_id as number)
        : requireInt(req.body.employeeId, 'Employee', 1);
    const projectId =
      req.body?.projectId === undefined
        ? (existing.project_id as number | null)
        : optionalInt(req.body.projectId, 'Project', 1);
    assertEmployeeAndProject(employeeId, projectId);

    db.prepare(
      `UPDATE timesheets SET employee_id = ?, project_id = ?, work_date = ?, hours = ?,
         task = ?, notes = ?, billable = ?, status = 'draft', updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      employeeId,
      projectId,
      req.body?.workDate === undefined
        ? existing.work_date
        : requireDate(req.body.workDate, 'Work date'),
      req.body?.hours === undefined
        ? existing.hours
        : requireNumber(req.body.hours, 'Hours', 0.01, 24),
      req.body?.task === undefined
        ? (existing.task as string | null)
        : optionalString(req.body.task, 'Task', 200),
      req.body?.notes === undefined
        ? (existing.notes as string | null)
        : optionalString(req.body.notes, 'Notes', 2000),
      req.body?.billable === undefined ? existing.billable : req.body.billable ? 1 : 0,
      id,
    );
    recordAudit(req.user!.id, 'update', 'timesheet', id);
    res.json({ timesheet: db.prepare(`${TIMESHEET_SELECT} WHERE t.id = ?`).get(id) });
  }),
);

timesheetsRouter.delete(
  '/:id',
  requirePermission('hr.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const existing = getDb().prepare('SELECT status FROM timesheets WHERE id = ?').get(id) as
      { status: string } | undefined;
    if (!existing) throw notFound('Timesheet not found');
    if (!EDITABLE.has(existing.status)) {
      throw new ValidationError(
        `Only draft or rejected timesheets can be deleted (this one is ${existing.status})`,
      );
    }
    getDb().prepare('DELETE FROM timesheets WHERE id = ?').run(id);
    recordAudit(req.user!.id, 'delete', 'timesheet', id);
    res.json({ ok: true });
  }),
);

timesheetsRouter.post(
  '/:id/:action',
  requirePermission('hr.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const action = req.params.action ?? '';
    const target =
      action === 'submit'
        ? { from: ['draft', 'rejected'], to: 'submitted', approvedBy: null }
        : action === 'approve'
          ? { from: ['submitted'], to: 'approved', approvedBy: req.user!.id }
          : action === 'reject'
            ? { from: ['submitted'], to: 'rejected', approvedBy: null }
            : null;
    if (!target) throw new ValidationError('Unknown timesheet action');

    const db = getDb();
    const existing = db.prepare('SELECT status FROM timesheets WHERE id = ?').get(id) as
      { status: string } | undefined;
    if (!existing) throw notFound('Timesheet not found');
    if (!target.from.includes(existing.status)) {
      throw new ValidationError(`Cannot ${action} a ${existing.status} timesheet`);
    }

    db.prepare(
      `UPDATE timesheets SET status = ?, approved_by = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(target.to, target.approvedBy, id);
    recordAudit(req.user!.id, action, 'timesheet', id);
    res.json({ ok: true, status: target.to });
  }),
);

/** Weekly totals for the timesheet grid. */
timesheetsRouter.get(
  '/week',
  requirePermission('hr.view'),
  asyncHandler(async (req, res) => {
    const start = requireDate(
      typeof req.query.from === 'string' ? req.query.from : '',
      'From date',
    );
    const end =
      optionalDate(typeof req.query.to === 'string' ? req.query.to : '', 'To date') ?? start;
    const rows = getDb()
      .prepare(
        `SELECT work_date, SUM(hours) AS hours
         FROM timesheets WHERE work_date >= ? AND work_date <= ? AND status <> 'rejected'
         GROUP BY work_date ORDER BY work_date`,
      )
      .all(start, end);
    res.json({ from: start, to: end, days: rows });
  }),
);
