import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { HttpError } from '../utils/errors.js';

export interface AuthUser {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
  warehouseId: number | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

interface UserRow {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  is_active: number;
  warehouse_id: number | null;
}

export function loadUser(id: number): AuthUser | null {
  const db = getDb();
  const user = db
    .prepare(
      'SELECT id, email, first_name, last_name, is_active, warehouse_id FROM users WHERE id = ?',
    )
    .get(id) as UserRow | undefined;
  if (!user || user.is_active !== 1) return null;

  const roles = db
    .prepare(
      `SELECT r.name FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = ?
       ORDER BY r.name`,
    )
    .all(id) as { name: string }[];

  const permissions = db
    .prepare(
      `SELECT DISTINCT p.key FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur ON ur.role_id = rp.role_id
       WHERE ur.user_id = ?
       ORDER BY p.key`,
    )
    .all(id) as { key: string }[];

  return {
    id: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    roles: roles.map((r) => r.name),
    permissions: permissions.map((p) => p.key),
    warehouseId: user.warehouse_id ?? null,
  };
}

export function signToken(userId: number): string {
  return jwt.sign({ sub: String(userId) }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new HttpError(401, 'Authentication required', 'unauthenticated'));
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const subject = typeof payload === 'string' ? null : payload.sub;
    const userId = Number(subject);
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('bad subject');
    const user = loadUser(userId);
    if (!user) throw new Error('inactive user');
    req.user = user;
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired session', 'unauthenticated'));
  }
};

export function requirePermission(permission: string): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new HttpError(401, 'Authentication required', 'unauthenticated'));
      return;
    }
    if (!req.user.permissions.includes(permission)) {
      next(new HttpError(403, 'You do not have permission to do that', 'forbidden'));
      return;
    }
    next();
  };
}

/**
 * Branch scope for a user. Admins see every branch; any other user with a
 * warehouse assigned is restricted to it. Returns null when unscoped.
 */
export function branchWarehouseId(user: AuthUser): number | null {
  if (user.roles.includes('admin')) return null;
  return user.warehouseId;
}

/** Force the user's branch when scoped, otherwise honour the requested branch. */
export function effectiveWarehouseId(
  user: AuthUser,
  requested: number | null | undefined,
): number | null {
  const scope = branchWarehouseId(user);
  if (scope !== null) return scope;
  return requested ?? null;
}

export function requireRole(role: string): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new HttpError(401, 'Authentication required', 'unauthenticated'));
      return;
    }
    if (!req.user.roles.includes(role)) {
      next(new HttpError(403, 'You do not have permission to do that', 'forbidden'));
      return;
    }
    next();
  };
}

export function isModuleEnabled(key: string): boolean {
  const row = getDb().prepare('SELECT is_enabled FROM modules WHERE key = ?').get(key) as
    { is_enabled: number } | undefined;
  return row ? row.is_enabled === 1 : true;
}

/** Blocks a router when its module has been disabled in the plugin manager. */
export function requireModule(key: string): RequestHandler {
  return (_req, _res, next) => {
    if (!isModuleEnabled(key)) {
      next(new HttpError(403, `The ${key} module is disabled`, 'module_disabled'));
      return;
    }
    next();
  };
}

/** Simple in-memory fixed-window rate limiter. One process = one store = good enough. */
export function rateLimit(limit: number, windowMs: number): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, _res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (entry.count >= limit) {
      next(new HttpError(429, 'Too many attempts. Try again later.', 'rate_limited'));
      return;
    }
    entry.count += 1;
    next();
  };
}

export function publicUser(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    roles: user.roles,
    permissions: user.permissions,
    warehouseId: user.warehouseId,
  };
}
