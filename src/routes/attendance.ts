import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { ValidationError, notFound } from '../utils/errors.js';
import {
  optionalNumber,
  optionalString,
  paramId,
  requireDate,
  requireEnum,
  requireInt,
} from '../utils/validate.js';
import { recordAudit } from '../services/audit.js';

export const attendanceRouter = Router();
attendanceRouter.use(authenticate);

const STATUSES = ['present', 'late', 'absent', 'leave', 'holiday'] as const;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function optionalTime(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) {
    throw new ValidationError(`${label} must be a time like 08:30`);
  }
  return value;
}

function hoursBetween(clockIn: string | null, clockOut: string | null): number {
  if (!clockIn || !clockOut) return 0;
  const inParts = clockIn.split(':').map(Number);
  const outParts = clockOut.split(':').map(Number);
  const minutes =
    (outParts[0] ?? 0) * 60 + (outParts[1] ?? 0) - ((inParts[0] ?? 0) * 60 + (inParts[1] ?? 0));
  return minutes > 0 ? Math.round((minutes / 60) * 100) / 100 : 0;
}

const ATTENDANCE_SELECT = `
  SELECT a.*, e.first_name || ' ' || e.last_name AS employee_name, e.employee_number
  FROM attendance a JOIN employees e ON e.id = a.employee_id`;

function detail(id: number) {
  const row = getDb().prepare(`${ATTENDANCE_SELECT} WHERE a.id = ?`).get(id);
  if (!row) throw notFound('Attendance record not found');
  return row;
}

function assertEmployee(employeeId: number): void {
  if (!getDb().prepare('SELECT id FROM employees WHERE id = ?').get(employeeId)) {
    throw new ValidationError('Employee not found');
  }
}

attendanceRouter.get(
  '/employees',
  requirePermission('attendance.view'),
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

attendanceRouter.get(
  '/',
  requirePermission('attendance.view'),
  asyncHandler(async (req, res) => {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (req.query.employeeId) {
      where.push('a.employee_id = ?');
      params.push(Number(req.query.employeeId));
    }
    if (typeof req.query.status === 'string' && req.query.status !== 'all') {
      where.push('a.status = ?');
      params.push(req.query.status);
    }
    if (typeof req.query.from === 'string' && req.query.from !== '') {
      where.push('a.work_date >= ?');
      params.push(req.query.from);
    }
    if (typeof req.query.to === 'string' && req.query.to !== '') {
      where.push('a.work_date <= ?');
      params.push(req.query.to);
    }

    const records = getDb()
      .prepare(
        `${ATTENDANCE_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.work_date DESC, e.last_name LIMIT 1000`,
      )
      .all(...params);
    const summary = getDb()
      .prepare(
        `SELECT COUNT(*) AS records,
                COALESCE(SUM(CASE WHEN a.status = 'present' THEN 1 END), 0) AS present,
                COALESCE(SUM(CASE WHEN a.status = 'late' THEN 1 END), 0) AS late,
                COALESCE(SUM(CASE WHEN a.status = 'absent' THEN 1 END), 0) AS absent,
                COALESCE(SUM(CASE WHEN a.status = 'leave' THEN 1 END), 0) AS on_leave,
                COALESCE(SUM(a.hours), 0) AS hours
         FROM attendance a
         WHERE ${where.join(' AND ')}`,
      )
      .get(...params);
    res.json({ records, summary });
  }),
);

attendanceRouter.post(
  '/',
  requirePermission('attendance.manage'),
  asyncHandler(async (req, res) => {
    const employeeId = requireInt(req.body?.employeeId, 'Employee', 1);
    const workDate = requireDate(req.body?.workDate, 'Work date');
    assertEmployee(employeeId);
    const db = getDb();
    if (
      db
        .prepare('SELECT id FROM attendance WHERE employee_id = ? AND work_date = ?')
        .get(employeeId, workDate)
    ) {
      throw new ValidationError('Attendance is already recorded for this employee on that date');
    }
    const clockIn = optionalTime(req.body?.clockIn, 'Clock in');
    const clockOut = optionalTime(req.body?.clockOut, 'Clock out');
    const hours =
      optionalNumber(req.body?.hours, 'Hours', 0, 24) ?? hoursBetween(clockIn, clockOut);

    const result = db
      .prepare(
        `INSERT INTO attendance (employee_id, work_date, clock_in, clock_out, status, hours, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        employeeId,
        workDate,
        clockIn,
        clockOut,
        req.body?.status === undefined
          ? 'present'
          : requireEnum(req.body.status, 'Status', STATUSES),
        hours,
        optionalString(req.body?.notes, 'Notes', 1000),
      );
    const id = Number(result.lastInsertRowid);
    recordAudit(req.user!.id, 'create', 'attendance', id, { employeeId, workDate });
    res.status(201).json({ record: detail(id) });
  }),
);

attendanceRouter.put(
  '/:id',
  requirePermission('attendance.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM attendance WHERE id = ?').get(id) as
      | (Record<string, unknown> & {
          employee_id: number;
          work_date: string;
          clock_in: string | null;
          clock_out: string | null;
          hours: number;
        })
      | undefined;
    if (!existing) throw notFound('Attendance record not found');

    const employeeId =
      req.body?.employeeId === undefined
        ? existing.employee_id
        : requireInt(req.body.employeeId, 'Employee', 1);
    const workDate =
      req.body?.workDate === undefined
        ? existing.work_date
        : requireDate(req.body.workDate, 'Work date');
    assertEmployee(employeeId);
    const clash = db
      .prepare('SELECT id FROM attendance WHERE employee_id = ? AND work_date = ? AND id <> ?')
      .get(employeeId, workDate, id);
    if (clash) {
      throw new ValidationError('Attendance is already recorded for this employee on that date');
    }

    const clockIn =
      req.body?.clockIn === undefined
        ? existing.clock_in
        : optionalTime(req.body.clockIn, 'Clock in');
    const clockOut =
      req.body?.clockOut === undefined
        ? existing.clock_out
        : optionalTime(req.body.clockOut, 'Clock out');
    const hours =
      req.body?.hours === undefined
        ? hoursBetween(clockIn, clockOut)
        : (optionalNumber(req.body.hours, 'Hours', 0, 24) ?? 0);

    db.prepare(
      `UPDATE attendance SET employee_id = ?, work_date = ?, clock_in = ?, clock_out = ?,
         status = ?, hours = ?, notes = ? WHERE id = ?`,
    ).run(
      employeeId,
      workDate,
      clockIn,
      clockOut,
      req.body?.status === undefined
        ? existing.status
        : requireEnum(req.body.status, 'Status', STATUSES),
      hours,
      req.body?.notes === undefined
        ? (existing.notes as string | null)
        : optionalString(req.body.notes, 'Notes', 1000),
      id,
    );
    recordAudit(req.user!.id, 'update', 'attendance', id);
    res.json({ record: detail(id) });
  }),
);

attendanceRouter.delete(
  '/:id',
  requirePermission('attendance.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb().prepare('DELETE FROM attendance WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('Attendance record not found');
    recordAudit(req.user!.id, 'delete', 'attendance', id);
    res.json({ ok: true });
  }),
);
