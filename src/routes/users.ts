import { Router } from 'express';
import bcrypt from 'bcrypt';
import { getDb } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { ValidationError, notFound } from '../utils/errors.js';
import {
  optionalString,
  paramId,
  requireEnum,
  requireString,
  optionalBool,
} from '../utils/validate.js';
import { recordAudit } from '../services/audit.js';

export const usersRouter = Router();
usersRouter.use(authenticate);

interface RoleRow {
  id: number;
  name: string;
}

function roleIdsFor(names: string[]): number[] {
  const db = getDb();
  const rows: RoleRow[] = [];
  for (const name of names) {
    const role = db.prepare('SELECT id, name FROM roles WHERE name = ?').get(name) as
      RoleRow | undefined;
    if (!role) throw new ValidationError(`Unknown role: ${name}`);
    rows.push(role);
  }
  return rows.map((row) => row.id);
}

function setRoles(userId: number, names: string[]): void {
  const db = getDb();
  db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(userId);
  const insert = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)');
  for (const roleId of roleIdsFor(names)) insert.run(userId, roleId);
}

interface UserWithRoles {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  is_active: number;
  last_login_at: string | null;
  created_at: string;
  roles: string[];
}

function userRow(id: number): UserWithRoles {
  const db = getDb();
  const user = db
    .prepare(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active, u.last_login_at, u.created_at,
              COALESCE(GROUP_CONCAT(r.name, ','), '') AS role_names
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.id = ?
       GROUP BY u.id`,
    )
    .get(id) as (Omit<UserWithRoles, 'roles'> & { role_names: string }) | undefined;
  if (!user) throw notFound('User not found');
  const { role_names, ...rest } = user;
  return { ...rest, roles: role_names ? role_names.split(',') : [] };
}

usersRouter.get(
  '/',
  requirePermission('users.manage'),
  asyncHandler(async (_req, res) => {
    const rows = getDb()
      .prepare(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active, u.last_login_at, u.created_at,
                COALESCE(GROUP_CONCAT(r.name, ','), '') AS role_names
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         GROUP BY u.id
         ORDER BY u.first_name, u.last_name`,
      )
      .all() as (Record<string, unknown> & { role_names: string })[];
    res.json({
      users: rows.map(({ role_names, ...row }) => ({
        ...row,
        roles: role_names ? role_names.split(',') : [],
      })),
    });
  }),
);

usersRouter.post(
  '/',
  requirePermission('users.manage'),
  asyncHandler(async (req, res) => {
    const email = requireString(req.body?.email, 'Email', 320).toLowerCase();
    if (!email.includes('@')) throw new ValidationError('Email is not valid');
    const firstName = requireString(req.body?.firstName, 'First name', 100);
    const lastName = requireString(req.body?.lastName, 'Last name', 100);
    const password = requireString(req.body?.password, 'Password', 200);
    if (password.length < 8) throw new ValidationError('Password must be at least 8 characters');
    const roles = Array.isArray(req.body?.roles)
      ? (req.body.roles as unknown[]).map(String)
      : ['viewer'];

    const db = getDb();
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (exists) throw new ValidationError('A user with that email already exists');

    const id = db.transaction(() => {
      const result = db
        .prepare(
          'INSERT INTO users (email, password_hash, first_name, last_name) VALUES (?, ?, ?, ?)',
        )
        .run(email, bcrypt.hashSync(password, 10), firstName, lastName);
      const userId = Number(result.lastInsertRowid);
      setRoles(userId, roles);
      db.prepare(
        'UPDATE employees SET user_id = ? WHERE lower(email) = lower(?) AND user_id IS NULL',
      ).run(userId, email);
      recordAudit(req.user!.id, 'create', 'user', userId, { email, roles });
      return userId;
    })();

    res.status(201).json({ user: userRow(id) });
  }),
);

usersRouter.put(
  '/:id',
  requirePermission('users.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const current = userRow(id);
    if (!current) throw notFound('User not found');

    const firstName =
      req.body?.firstName === undefined
        ? current.first_name
        : requireString(req.body.firstName, 'First name', 100);
    const lastName =
      req.body?.lastName === undefined
        ? current.last_name
        : requireString(req.body.lastName, 'Last name', 100);
    const isActive = optionalBool(req.body?.isActive, 'Active');

    const db = getDb();
    db.transaction(() => {
      if (firstName !== current.first_name || lastName !== current.last_name || isActive !== null) {
        db.prepare(
          "UPDATE users SET first_name = ?, last_name = ?, is_active = COALESCE(?, is_active), updated_at = datetime('now') WHERE id = ?",
        ).run(firstName, lastName, isActive === null ? null : isActive ? 1 : 0, id);
      }
      if (typeof req.body?.password === 'string' && req.body.password.length > 0) {
        if (req.body.password.length < 8)
          throw new ValidationError('Password must be at least 8 characters');
        db.prepare(
          "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?",
        ).run(bcrypt.hashSync(req.body.password, 10), id);
      }
      if (Array.isArray(req.body?.roles)) setRoles(id, (req.body.roles as unknown[]).map(String));
      db.prepare(
        'UPDATE employees SET user_id = ? WHERE lower(email) = lower(?) AND user_id IS NULL',
      ).run(id, current.email);
      recordAudit(req.user!.id, 'update', 'user', id, { roles: req.body?.roles });
    })();

    res.json({ user: userRow(id) });
  }),
);

usersRouter.delete(
  '/:id',
  requirePermission('users.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    if (id === req.user!.id) throw new ValidationError('You cannot delete your own account');
    const target = userRow(id);
    if (!target) throw notFound('User not found');
    getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
    recordAudit(req.user!.id, 'delete', 'user', id, { email: target.email });
    res.json({ ok: true });
  }),
);

// Roles & permissions
export const rolesRouter = Router();
rolesRouter.use(authenticate, requirePermission('users.manage'));

rolesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const roles = db
      .prepare('SELECT id, name, description, is_system, created_at FROM roles ORDER BY id')
      .all() as { id: number }[];
    const permissions = db
      .prepare(
        `SELECT rp.role_id, p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id ORDER BY p.key`,
      )
      .all() as { role_id: number; key: string }[];

    res.json({
      roles: roles.map((role) => ({
        ...role,
        permissions: permissions.filter((p) => p.role_id === role.id).map((p) => p.key),
      })),
      permissions: db
        .prepare('SELECT id, key, module, description FROM permissions ORDER BY module, key')
        .all(),
    });
  }),
);

rolesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const name = requireString(req.body?.name, 'Role name', 60).toLowerCase().replace(/\s+/g, '_');
    const description = optionalString(req.body?.description, 'Description', 300);
    const keys = Array.isArray(req.body?.permissions)
      ? (req.body.permissions as unknown[]).map(String)
      : [];

    const db = getDb();
    if (db.prepare('SELECT id FROM roles WHERE name = ?').get(name)) {
      throw new ValidationError('A role with that name already exists');
    }

    const id = db.transaction(() => {
      const result = db
        .prepare('INSERT INTO roles (name, description, is_system) VALUES (?, ?, 0)')
        .run(name, description);
      const roleId = Number(result.lastInsertRowid);
      const insert = db.prepare(
        'INSERT OR IGNORE INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE key = ?',
      );
      for (const key of keys) insert.run(roleId, key);
      return roleId;
    })();

    res.status(201).json({ role: db.prepare('SELECT * FROM roles WHERE id = ?').get(id) });
  }),
);

rolesRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const role = db.prepare('SELECT id, name, is_system FROM roles WHERE id = ?').get(id) as
      { id: number; name: string; is_system: number } | undefined;
    if (!role) throw notFound('Role not found');
    if (role.name === 'admin')
      throw new ValidationError('The admin role always has every permission');

    const description = optionalString(req.body?.description, 'Description', 300);
    db.transaction(() => {
      db.prepare('UPDATE roles SET description = COALESCE(?, description) WHERE id = ?').run(
        description,
        id,
      );
      if (Array.isArray(req.body?.permissions)) {
        db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(id);
        const insert = db.prepare(
          'INSERT OR IGNORE INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE key = ?',
        );
        for (const key of (req.body.permissions as unknown[]).map(String)) insert.run(id, key);
      }
      recordAudit(req.user!.id, 'update', 'role', id, { permissions: req.body?.permissions });
    })();

    res.json({ role: db.prepare('SELECT * FROM roles WHERE id = ?').get(id) });
  }),
);

rolesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const role = db.prepare('SELECT id, name, is_system FROM roles WHERE id = ?').get(id) as
      { id: number; name: string; is_system: number } | undefined;
    if (!role) throw notFound('Role not found');
    if (role.is_system === 1) throw new ValidationError('System roles cannot be deleted');
    db.prepare('DELETE FROM roles WHERE id = ?').run(id);
    res.json({ ok: true });
  }),
);

// Audit trail (read-only)
export const auditRouter = Router();
auditRouter.use(authenticate, requirePermission('users.manage'));

auditRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const rows = getDb()
      .prepare(
        `SELECT a.id, a.action, a.entity, a.entity_id, a.details, a.created_at,
                u.email AS user_email, u.first_name || ' ' || u.last_name AS user_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         ORDER BY a.id DESC LIMIT ?`,
      )
      .all(limit);
    res.json({ audit: rows });
  }),
);
