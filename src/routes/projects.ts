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
  requireDate,
  requireEnum,
  requireInt,
  requireString,
} from '../utils/validate.js';
import { nextNumber } from '../services/sequences.js';
import { recordAudit } from '../services/audit.js';

export const projectsRouter = Router();
projectsRouter.use(authenticate);

const PROJECT_STATUSES = ['planned', 'active', 'on_hold', 'completed', 'cancelled'] as const;
const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done'] as const;
const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

const PROJECT_SELECT = `
  SELECT p.*, u.first_name || ' ' || u.last_name AS manager_name,
    (SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id) AS task_count,
    (SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_task_count,
    COALESCE((SELECT SUM(ts.hours) FROM timesheets ts WHERE ts.project_id = p.id), 0) AS logged_hours
  FROM projects p
  LEFT JOIN users u ON u.id = p.manager_id`;

const TASK_SELECT = `
  SELECT t.*, e.first_name || ' ' || e.last_name AS assignee_name
  FROM project_tasks t
  LEFT JOIN employees e ON e.id = t.assigned_employee_id`;

/** Employee picker so projects do not depend on the HR module being enabled. */
projectsRouter.get(
  '/employees',
  requirePermission('projects.view'),
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

projectsRouter.get(
  '/',
  requirePermission('projects.view'),
  asyncHandler(async (req, res) => {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (typeof req.query.status === 'string' && req.query.status !== 'all') {
      where.push('p.status = ?');
      params.push(req.query.status);
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where.push('(p.name LIKE ? OR p.code LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    const projects = getDb()
      .prepare(`${PROJECT_SELECT} WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC`)
      .all(...params);
    res.json({ projects });
  }),
);

projectsRouter.get(
  '/:id',
  requirePermission('projects.view'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const project = db.prepare(`${PROJECT_SELECT} WHERE p.id = ?`).get(id);
    if (!project) throw notFound('Project not found');
    const tasks = db.prepare(`${TASK_SELECT} WHERE t.project_id = ? ORDER BY t.created_at`).all(id);
    const costs = db
      .prepare('SELECT * FROM project_costs WHERE project_id = ? ORDER BY cost_date DESC, id DESC')
      .all(id) as { type: string; amount_cents: number }[];
    const totals = { material: 0, labour: 0, expense: 0 };
    for (const cost of costs) {
      if (cost.type in totals) totals[cost.type as keyof typeof totals] += cost.amount_cents;
    }
    const totalCost = totals.material + totals.labour + totals.expense;
    const budget = Number((project as { budget_cents: number }).budget_cents ?? 0);
    res.json({
      project,
      tasks,
      costs,
      profitability: { budget, ...totals, totalCost, margin: budget - totalCost },
    });
  }),
);

projectsRouter.get(
  '/:id/costs',
  requirePermission('projects.view'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const costs = getDb()
      .prepare('SELECT * FROM project_costs WHERE project_id = ? ORDER BY cost_date DESC, id DESC')
      .all(id);
    res.json({ costs });
  }),
);

projectsRouter.post(
  '/:id/costs',
  requirePermission('projects.manage'),
  asyncHandler(async (req, res) => {
    const projectId = paramId(req.params.id);
    const db = getDb();
    if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) {
      throw notFound('Project not found');
    }
    const result = db
      .prepare(
        `INSERT INTO project_costs (project_id, type, description, amount_cents, cost_date, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        projectId,
        requireEnum(req.body?.type, 'Type', ['material', 'labour', 'expense'] as const),
        requireString(req.body?.description, 'Description', 500),
        requireInt(req.body?.amountCents, 'Amount', 0),
        requireDate(req.body?.costDate, 'Cost date'),
        req.user!.id,
      );
    const id = Number(result.lastInsertRowid);
    recordAudit(req.user!.id, 'create', 'project_cost', id, { projectId });
    res.status(201).json({
      cost: db.prepare('SELECT * FROM project_costs WHERE id = ?').get(id),
    });
  }),
);

projectsRouter.delete(
  '/costs/:costId',
  requirePermission('projects.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.costId);
    const result = getDb().prepare('DELETE FROM project_costs WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('Project cost not found');
    recordAudit(req.user!.id, 'delete', 'project_cost', id);
    res.json({ ok: true });
  }),
);

projectsRouter.post(
  '/',
  requirePermission('projects.manage'),
  asyncHandler(async (req, res) => {
    const name = requireString(req.body?.name, 'Name', 200);
    const status =
      req.body?.status === undefined
        ? 'planned'
        : requireEnum(req.body.status, 'Status', PROJECT_STATUSES);
    const startDate = optionalDate(req.body?.startDate, 'Start date');
    const endDate = optionalDate(req.body?.endDate, 'End date');
    if (startDate && endDate && endDate < startDate) {
      throw new ValidationError('End date cannot be before start date');
    }

    const db = getDb();
    const id = db.transaction(() => {
      const code = optionalString(req.body?.code, 'Code', 30) ?? nextNumber('project');
      const result = db
        .prepare(
          `INSERT INTO projects (code, name, description, status, manager_id, start_date, end_date, budget_cents)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          code,
          name,
          optionalString(req.body?.description, 'Description', 5000),
          status,
          optionalInt(req.body?.managerId, 'Manager', 1),
          startDate,
          endDate,
          optionalCents(req.body?.budgetCents, 'Budget') ?? 0,
        );
      return Number(result.lastInsertRowid);
    })();

    recordAudit(req.user!.id, 'create', 'project', id);
    res.status(201).json({ project: db.prepare(`${PROJECT_SELECT} WHERE p.id = ?`).get(id) });
  }),
);

projectsRouter.put(
  '/:id',
  requirePermission('projects.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      | (Record<string, unknown> & { start_date: string | null; end_date: string | null })
      | undefined;
    if (!existing) throw notFound('Project not found');

    const startDate =
      req.body?.startDate === undefined
        ? (existing.start_date as string | null)
        : optionalDate(req.body.startDate, 'Start date');
    const endDate =
      req.body?.endDate === undefined
        ? (existing.end_date as string | null)
        : optionalDate(req.body.endDate, 'End date');
    if (startDate && endDate && endDate < startDate) {
      throw new ValidationError('End date cannot be before start date');
    }

    db.prepare(
      `UPDATE projects SET code = ?, name = ?, description = ?, status = ?, manager_id = ?,
         start_date = ?, end_date = ?, budget_cents = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      req.body?.code === undefined ? existing.code : requireString(req.body.code, 'Code', 30),
      req.body?.name === undefined ? existing.name : requireString(req.body.name, 'Name', 200),
      req.body?.description === undefined
        ? (existing.description as string | null)
        : optionalString(req.body.description, 'Description', 5000),
      req.body?.status === undefined
        ? existing.status
        : requireEnum(req.body.status, 'Status', PROJECT_STATUSES),
      req.body?.managerId === undefined
        ? (existing.manager_id as number | null)
        : optionalInt(req.body.managerId, 'Manager', 1),
      startDate,
      endDate,
      req.body?.budgetCents === undefined
        ? existing.budget_cents
        : (optionalCents(req.body.budgetCents, 'Budget') ?? 0),
      id,
    );
    recordAudit(req.user!.id, 'update', 'project', id);
    res.json({ project: db.prepare(`${PROJECT_SELECT} WHERE p.id = ?`).get(id) });
  }),
);

projectsRouter.delete(
  '/:id',
  requirePermission('projects.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('Project not found');
    recordAudit(req.user!.id, 'delete', 'project', id);
    res.json({ ok: true });
  }),
);

// Tasks
projectsRouter.post(
  '/:id/tasks',
  requirePermission('projects.manage'),
  asyncHandler(async (req, res) => {
    const projectId = paramId(req.params.id);
    const db = getDb();
    if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) {
      throw notFound('Project not found');
    }
    const result = db
      .prepare(
        `INSERT INTO project_tasks
           (project_id, title, description, assigned_employee_id, status, priority, due_date, estimated_hours)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        projectId,
        requireString(req.body?.title, 'Title', 200),
        optionalString(req.body?.description, 'Description', 5000),
        optionalInt(req.body?.assignedEmployeeId, 'Assignee', 1),
        req.body?.status === undefined
          ? 'todo'
          : requireEnum(req.body.status, 'Status', TASK_STATUSES),
        req.body?.priority === undefined
          ? 'medium'
          : requireEnum(req.body.priority, 'Priority', TASK_PRIORITIES),
        optionalDate(req.body?.dueDate, 'Due date'),
        optionalNumber(req.body?.estimatedHours, 'Estimated hours', 0, 1000) ?? 0,
      );
    const id = Number(result.lastInsertRowid);
    recordAudit(req.user!.id, 'create', 'project_task', id, { projectId });
    res.status(201).json({ task: db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id) });
  }),
);

projectsRouter.put(
  '/tasks/:taskId',
  requirePermission('projects.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.taskId);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM project_tasks WHERE id = ?').get(id) as
      (Record<string, unknown> & { status: string }) | undefined;
    if (!existing) throw notFound('Task not found');

    db.prepare(
      `UPDATE project_tasks SET title = ?, description = ?, assigned_employee_id = ?, status = ?,
         priority = ?, due_date = ?, estimated_hours = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      req.body?.title === undefined ? existing.title : requireString(req.body.title, 'Title', 200),
      req.body?.description === undefined
        ? (existing.description as string | null)
        : optionalString(req.body.description, 'Description', 5000),
      req.body?.assignedEmployeeId === undefined
        ? (existing.assigned_employee_id as number | null)
        : optionalInt(req.body.assignedEmployeeId, 'Assignee', 1),
      req.body?.status === undefined
        ? existing.status
        : requireEnum(req.body.status, 'Status', TASK_STATUSES),
      req.body?.priority === undefined
        ? existing.priority
        : requireEnum(req.body.priority, 'Priority', TASK_PRIORITIES),
      req.body?.dueDate === undefined
        ? (existing.due_date as string | null)
        : optionalDate(req.body.dueDate, 'Due date'),
      req.body?.estimatedHours === undefined
        ? existing.estimated_hours
        : (optionalNumber(req.body.estimatedHours, 'Estimated hours', 0, 1000) ?? 0),
      id,
    );
    recordAudit(req.user!.id, 'update', 'project_task', id);
    res.json({ task: db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id) });
  }),
);

projectsRouter.delete(
  '/tasks/:taskId',
  requirePermission('projects.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.taskId);
    const result = getDb().prepare('DELETE FROM project_tasks WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('Task not found');
    recordAudit(req.user!.id, 'delete', 'project_task', id);
    res.json({ ok: true });
  }),
);
