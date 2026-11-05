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
  requireEnum,
  requireInt,
  requireString,
} from '../utils/validate.js';
import { nextNumber } from '../services/sequences.js';
import { recordAudit } from '../services/audit.js';

export const employeesRouter = Router();
employeesRouter.use(authenticate);

const EMPLOYEE_SELECT = `
  SELECT e.*, d.name AS department_name
  FROM employees e LEFT JOIN departments d ON d.id = e.department_id`;

employeesRouter.get(
  '/',
  requirePermission('hr.view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (typeof req.query.status === 'string' && req.query.status !== 'all') {
      where.push('e.status = ?');
      params.push(req.query.status);
    }
    if (req.query.departmentId) {
      where.push('e.department_id = ?');
      params.push(Number(req.query.departmentId));
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where.push(
        '(e.first_name LIKE ? OR e.last_name LIKE ? OR e.email LIKE ? OR e.employee_number LIKE ?)',
      );
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const employees = db
      .prepare(`${EMPLOYEE_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.last_name, e.first_name`)
      .all(...params);
    res.json({ employees });
  }),
);

employeesRouter.post(
  '/',
  requirePermission('hr.manage'),
  asyncHandler(async (req, res) => {
    const firstName = requireString(req.body?.firstName, 'First name', 100);
    const lastName = requireString(req.body?.lastName, 'Last name', 100);
    const startDate = requireDate(req.body?.startDate, 'Start date');
    const departmentId = optionalInt(req.body?.departmentId, 'Department', 1);
    if (departmentId !== null) {
      const department = getDb()
        .prepare('SELECT id FROM departments WHERE id = ?')
        .get(departmentId);
      if (!department) throw new ValidationError('Department not found');
    }

    const id = getDb().transaction(() => {
      const number = nextNumber('employee');
      const result = getDb()
        .prepare(
          `INSERT INTO employees
             (employee_number, user_id, first_name, last_name, email, phone, id_number, department_id,
              job_title, employment_type, status, start_date, end_date, salary_cents, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          number,
          optionalInt(req.body?.userId, 'User', 1),
          firstName,
          lastName,
          optionalString(req.body?.email, 'Email', 320),
          optionalString(req.body?.phone, 'Phone', 50),
          optionalString(req.body?.idNumber, 'ID number', 30),
          departmentId,
          optionalString(req.body?.jobTitle, 'Job title', 150),
          req.body?.employmentType === undefined
            ? 'permanent'
            : requireEnum(req.body.employmentType, 'Employment type', [
                'permanent',
                'contract',
                'part_time',
                'intern',
              ] as const),
          req.body?.status === undefined
            ? 'active'
            : requireEnum(req.body.status, 'Status', ['active', 'on_leave', 'terminated'] as const),
          startDate,
          optionalDate(req.body?.endDate, 'End date'),
          optionalInt(req.body?.salaryCents, 'Salary', 0) ?? 0,
          optionalString(req.body?.notes, 'Notes', 5000),
        );
      const employeeId = Number(result.lastInsertRowid);
      recordAudit(req.user!.id, 'create', 'employee', employeeId, { number });
      return employeeId;
    })();

    res
      .status(201)
      .json({ employee: getDb().prepare(`${EMPLOYEE_SELECT} WHERE e.id = ?`).get(id) });
  }),
);

employeesRouter.put(
  '/:id',
  requirePermission('hr.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as
      (Record<string, unknown> & { first_name: string; last_name: string }) | undefined;
    if (!existing) throw notFound('Employee not found');

    const text = (key: string, label: string, max: number, column: string) =>
      req.body?.[key] === undefined
        ? (existing[column] as string | null)
        : optionalString(req.body[key], label, max);

    const result = db
      .prepare(
        `UPDATE employees SET
           first_name = ?, last_name = ?, email = ?, phone = ?, id_number = ?, department_id = ?,
           job_title = ?, employment_type = ?, status = ?, start_date = ?, end_date = ?,
           salary_cents = ?, notes = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        req.body?.firstName === undefined
          ? existing.first_name
          : requireString(req.body.firstName, 'First name', 100),
        req.body?.lastName === undefined
          ? existing.last_name
          : requireString(req.body.lastName, 'Last name', 100),
        text('email', 'Email', 320, 'email'),
        text('phone', 'Phone', 50, 'phone'),
        text('idNumber', 'ID number', 30, 'id_number'),
        req.body?.departmentId === undefined
          ? existing.department_id
          : optionalInt(req.body.departmentId, 'Department', 1),
        text('jobTitle', 'Job title', 150, 'job_title'),
        req.body?.employmentType === undefined
          ? existing.employment_type
          : requireEnum(req.body.employmentType, 'Employment type', [
              'permanent',
              'contract',
              'part_time',
              'intern',
            ] as const),
        req.body?.status === undefined
          ? existing.status
          : requireEnum(req.body.status, 'Status', ['active', 'on_leave', 'terminated'] as const),
        req.body?.startDate === undefined
          ? existing.start_date
          : requireDate(req.body.startDate, 'Start date'),
        req.body?.endDate === undefined
          ? existing.end_date
          : optionalDate(req.body.endDate, 'End date'),
        req.body?.salaryCents === undefined
          ? existing.salary_cents
          : requireInt(req.body.salaryCents, 'Salary', 0),
        text('notes', 'Notes', 5000, 'notes'),
        id,
      );
    if (result.changes === 0) throw notFound('Employee not found');
    recordAudit(req.user!.id, 'update', 'employee', id);
    res.json({ employee: db.prepare(`${EMPLOYEE_SELECT} WHERE e.id = ?`).get(id) });
  }),
);

employeesRouter.delete(
  '/:id',
  requirePermission('hr.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb().prepare('DELETE FROM employees WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('Employee not found');
    recordAudit(req.user!.id, 'delete', 'employee', id);
    res.json({ ok: true });
  }),
);

// Departments
export const departmentsRouter = Router();
departmentsRouter.use(authenticate);

departmentsRouter.get(
  '/',
  requirePermission('hr.view'),
  asyncHandler(async (_req, res) => {
    const departments = getDb()
      .prepare(
        `SELECT d.*, (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id AND e.status = 'active') AS employee_count
         FROM departments d ORDER BY d.name`,
      )
      .all();
    res.json({ departments });
  }),
);

departmentsRouter.post(
  '/',
  requirePermission('hr.manage'),
  asyncHandler(async (req, res) => {
    const name = requireString(req.body?.name, 'Name', 100);
    try {
      const result = getDb()
        .prepare('INSERT INTO departments (name, description) VALUES (?, ?)')
        .run(name, optionalString(req.body?.description, 'Description', 500));
      res.status(201).json({
        department: getDb()
          .prepare('SELECT * FROM departments WHERE id = ?')
          .get(Number(result.lastInsertRowid)),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        throw new ValidationError('A department with that name already exists');
      }
      throw error;
    }
  }),
);

departmentsRouter.put(
  '/:id',
  requirePermission('hr.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb()
      .prepare('UPDATE departments SET name = ?, description = ? WHERE id = ?')
      .run(
        requireString(req.body?.name, 'Name', 100),
        optionalString(req.body?.description, 'Description', 500),
        id,
      );
    if (result.changes === 0) throw notFound('Department not found');
    res.json({ department: getDb().prepare('SELECT * FROM departments WHERE id = ?').get(id) });
  }),
);
