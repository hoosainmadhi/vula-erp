import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError, ValidationError, notFound } from '../utils/errors.js';
import {
  optionalString,
  paramId,
  requireDate,
  requireInt,
  requireNumber,
  requireString,
} from '../utils/validate.js';
import { recordAudit } from '../services/audit.js';
import { addDays } from '../utils/dates.js';

/**
 * Time Off module. Owns leave types, leave requests and leave balances.
 * Mounted at /leave and gated by requireModule('time-off').
 */
export const leaveRouter = Router();
leaveRouter.use(authenticate);

interface LinkedEmployee {
  id: number;
  employee_number: string;
  first_name: string;
  last_name: string;
  email: string | null;
  job_title: string | null;
  status: string;
}

/** Finds the employee record behind the signed-in user, linking by email if needed. */
function linkedEmployee(userId: number, email: string): LinkedEmployee {
  const db = getDb();
  const employee = db
    .prepare(
      `SELECT id, employee_number, first_name, last_name, email, job_title, status, user_id
       FROM employees
       WHERE user_id = ? OR (email IS NOT NULL AND lower(email) = lower(?))
       ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END, id
       LIMIT 1`,
    )
    .get(userId, email, userId) as (LinkedEmployee & { user_id: number | null }) | undefined;
  if (!employee) {
    throw new HttpError(
      403,
      'No employee record is linked to this login. Ask an administrator to link your user to an employee.',
      'employee_not_linked',
    );
  }
  if (employee.user_id !== userId) {
    db.prepare('UPDATE employees SET user_id = ? WHERE id = ?').run(userId, employee.id);
  }
  return employee;
}

/** Mark weekdays in an approved leave range as leave on the attendance register. */
function markLeaveAttendance(employeeId: number, startDate: string, endDate: string): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO attendance (employee_id, work_date, status, hours, notes)
     VALUES (?, ?, 'leave', 0, 'Approved leave')`,
  );
  let date = startDate;
  while (date <= endDate) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) insert.run(employeeId, date);
    date = addDays(date, 1);
  }
}

function balancesFor(employeeId: number, year: number) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  return getDb()
    .prepare(
      `SELECT lt.id AS leave_type_id, lt.name AS leave_type_name, lt.days_per_year,
         COALESCE(SUM(CASE WHEN lr.status = 'approved' THEN lr.days END), 0) AS approved_days,
         COALESCE(SUM(CASE WHEN lr.status = 'pending' THEN lr.days END), 0) AS pending_days
       FROM leave_types lt
       LEFT JOIN leave_requests lr
         ON lr.leave_type_id = lt.id AND lr.employee_id = ?
        AND lr.end_date >= ? AND lr.start_date <= ?
       GROUP BY lt.id
       ORDER BY lt.name`,
    )
    .all(employeeId, from, to);
}

/** Minimal employee list so this module works without the HR module enabled. */
leaveRouter.get(
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

leaveRouter.get(
  '/types',
  requirePermission('hr.view'),
  asyncHandler(async (_req, res) => {
    res.json({ leaveTypes: getDb().prepare('SELECT * FROM leave_types ORDER BY name').all() });
  }),
);

leaveRouter.post(
  '/types',
  requirePermission('hr.manage'),
  asyncHandler(async (req, res) => {
    try {
      const result = getDb()
        .prepare('INSERT INTO leave_types (name, days_per_year, is_paid) VALUES (?, ?, ?)')
        .run(
          requireString(req.body?.name, 'Name', 100),
          requireNumber(req.body?.daysPerYear, 'Days per year', 0, 365),
          req.body?.isPaid === false ? 0 : 1,
        );
      res.status(201).json({
        leaveType: getDb()
          .prepare('SELECT * FROM leave_types WHERE id = ?')
          .get(Number(result.lastInsertRowid)),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        throw new ValidationError('A leave type with that name already exists');
      }
      throw error;
    }
  }),
);

leaveRouter.get(
  '/requests',
  requirePermission('hr.view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (req.query.employeeId) {
      where.push('lr.employee_id = ?');
      params.push(Number(req.query.employeeId));
    }
    if (typeof req.query.status === 'string' && req.query.status !== 'all') {
      where.push('lr.status = ?');
      params.push(req.query.status);
    }
    if (typeof req.query.from === 'string' && req.query.from !== '') {
      where.push('lr.end_date >= ?');
      params.push(req.query.from);
    }
    if (typeof req.query.to === 'string' && req.query.to !== '') {
      where.push('lr.start_date <= ?');
      params.push(req.query.to);
    }
    const requests = db
      .prepare(
        `SELECT lr.*, e.first_name || ' ' || e.last_name AS employee_name, e.employee_number,
                lt.name AS leave_type_name
         FROM leave_requests lr
         JOIN employees e ON e.id = lr.employee_id
         JOIN leave_types lt ON lt.id = lr.leave_type_id
         WHERE ${where.join(' AND ')}
         ORDER BY lr.start_date DESC LIMIT 300`,
      )
      .all(...params);
    res.json({ leaveRequests: requests });
  }),
);

leaveRouter.get(
  '/summary',
  requirePermission('hr.view'),
  asyncHandler(async (req, res) => {
    const year = Number(req.query.year ?? new Date().getUTCFullYear());
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new ValidationError('Year must be a four-digit year');
    }
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;

    const rows = getDb()
      .prepare(
        `SELECT e.id AS employee_id,
                e.employee_number,
                e.first_name || ' ' || e.last_name AS employee_name,
                lt.id AS leave_type_id,
                lt.name AS leave_type_name,
                lt.days_per_year,
                COALESCE(SUM(CASE WHEN lr.status = 'approved' THEN lr.days END), 0) AS approved_days,
                COALESCE(SUM(CASE WHEN lr.status = 'pending' THEN lr.days END), 0) AS pending_days
         FROM employees e
         CROSS JOIN leave_types lt
         LEFT JOIN leave_requests lr
           ON lr.employee_id = e.id AND lr.leave_type_id = lt.id
          AND lr.end_date >= ? AND lr.start_date <= ?
         WHERE e.status <> 'terminated'
         GROUP BY e.id, lt.id
         ORDER BY e.last_name, e.first_name, lt.name`,
      )
      .all(from, to);

    res.json({ year, balances: rows });
  }),
);

// Employee self-service
leaveRouter.get(
  '/me',
  requirePermission('leave.self'),
  asyncHandler(async (req, res) => {
    const employee = linkedEmployee(req.user!.id, req.user!.email);
    const year = Number(req.query.year ?? new Date().getUTCFullYear());
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new ValidationError('Year must be a four-digit year');
    }
    const db = getDb();
    const requests = db
      .prepare(
        `SELECT lr.*, lt.name AS leave_type_name
         FROM leave_requests lr
         JOIN leave_types lt ON lt.id = lr.leave_type_id
         WHERE lr.employee_id = ?
         ORDER BY lr.start_date DESC LIMIT 200`,
      )
      .all(employee.id);
    res.json({
      year,
      employee,
      leaveTypes: db.prepare('SELECT * FROM leave_types ORDER BY name').all(),
      requests,
      balances: balancesFor(employee.id, year),
    });
  }),
);

leaveRouter.post(
  '/me/requests',
  requirePermission('leave.self'),
  asyncHandler(async (req, res) => {
    const employee = linkedEmployee(req.user!.id, req.user!.email);
    const leaveTypeId = requireInt(req.body?.leaveTypeId, 'Leave type', 1);
    const startDate = requireDate(req.body?.startDate, 'Start date');
    const endDate = requireDate(req.body?.endDate, 'End date');
    if (endDate < startDate) throw new ValidationError('End date cannot be before start date');

    const db = getDb();
    const leaveType = db.prepare('SELECT id FROM leave_types WHERE id = ?').get(leaveTypeId);
    if (!leaveType) throw notFound('Leave type not found');

    const days =
      Math.round(
        ((new Date(`${endDate}T00:00:00Z`).getTime() -
          new Date(`${startDate}T00:00:00Z`).getTime()) /
          86_400_000 +
          1) *
          100,
      ) / 100;

    const result = db
      .prepare(
        `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        employee.id,
        leaveTypeId,
        startDate,
        endDate,
        days,
        optionalString(req.body?.reason, 'Reason', 1000),
      );
    recordAudit(req.user!.id, 'request', 'leave_request', Number(result.lastInsertRowid));
    res.status(201).json({
      leaveRequest: db
        .prepare(
          `SELECT lr.*, lt.name AS leave_type_name
           FROM leave_requests lr JOIN leave_types lt ON lt.id = lr.leave_type_id
           WHERE lr.id = ?`,
        )
        .get(Number(result.lastInsertRowid)),
    });
  }),
);

leaveRouter.post(
  '/me/requests/:id/cancel',
  requirePermission('leave.self'),
  asyncHandler(async (req, res) => {
    const employee = linkedEmployee(req.user!.id, req.user!.email);
    const id = paramId(req.params.id);
    const db = getDb();
    const request = db
      .prepare('SELECT id, status FROM leave_requests WHERE id = ? AND employee_id = ?')
      .get(id, employee.id) as { id: number; status: string } | undefined;
    if (!request) throw notFound('Leave request not found');
    if (request.status !== 'pending') {
      throw new ValidationError('Only pending requests can be cancelled');
    }
    db.prepare(
      "UPDATE leave_requests SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?",
    ).run(id);
    recordAudit(req.user!.id, 'cancel', 'leave_request', id);
    res.json({ ok: true });
  }),
);

leaveRouter.post(
  '/requests',
  requirePermission('hr.manage'),
  asyncHandler(async (req, res) => {
    const employeeId = requireInt(req.body?.employeeId, 'Employee', 1);
    const leaveTypeId = requireInt(req.body?.leaveTypeId, 'Leave type', 1);
    const startDate = requireDate(req.body?.startDate, 'Start date');
    const endDate = requireDate(req.body?.endDate, 'End date');
    if (endDate < startDate) throw new ValidationError('End date cannot be before start date');

    const db = getDb();
    const employee = db.prepare('SELECT id FROM employees WHERE id = ?').get(employeeId);
    if (!employee) throw notFound('Employee not found');
    const leaveType = db.prepare('SELECT id FROM leave_types WHERE id = ?').get(leaveTypeId);
    if (!leaveType) throw notFound('Leave type not found');

    const days =
      Math.round(
        ((new Date(`${endDate}T00:00:00Z`).getTime() -
          new Date(`${startDate}T00:00:00Z`).getTime()) /
          86_400_000 +
          1) *
          100,
      ) / 100;

    const result = db
      .prepare(
        `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        employeeId,
        leaveTypeId,
        startDate,
        endDate,
        days,
        optionalString(req.body?.reason, 'Reason', 1000),
      );

    res.status(201).json({
      leaveRequest: db
        .prepare(
          `SELECT lr.*, e.first_name || ' ' || e.last_name AS employee_name, lt.name AS leave_type_name
           FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id JOIN leave_types lt ON lt.id = lr.leave_type_id
           WHERE lr.id = ?`,
        )
        .get(Number(result.lastInsertRowid)),
    });
  }),
);

leaveRouter.post(
  '/requests/:id/:action',
  requirePermission('hr.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const action = req.params.action;
    const status =
      action === 'approve'
        ? 'approved'
        : action === 'reject'
          ? 'rejected'
          : action === 'cancel'
            ? 'cancelled'
            : null;
    if (!status) throw new ValidationError('Unknown leave action');

    const db = getDb();
    const request = db
      .prepare(
        'SELECT id, status, employee_id, start_date, end_date FROM leave_requests WHERE id = ?',
      )
      .get(id) as
      | {
          id: number;
          status: string;
          employee_id: number;
          start_date: string;
          end_date: string;
        }
      | undefined;
    if (!request) throw notFound('Leave request not found');
    if (request.status !== 'pending')
      throw new ValidationError('Only pending requests can be changed');

    db.transaction(() => {
      db.prepare(
        "UPDATE leave_requests SET status = ?, approved_by = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(status, status === 'approved' ? req.user!.id : null, id);
      if (status === 'approved') {
        markLeaveAttendance(request.employee_id, request.start_date, request.end_date);
      }
    })();
    recordAudit(req.user!.id, status, 'leave_request', id);
    res.json({ ok: true, status });
  }),
);
