import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { notFound, ValidationError } from '../utils/errors.js';
import { recordAudit } from '../services/audit.js';

export const modulesRouter = Router();
modulesRouter.use(authenticate);

interface ModuleRow {
  key: string;
  name: string;
  description: string;
  category: string;
  is_core: number;
  is_enabled: number;
  sort: number;
  enabled_at: string | null;
}

function listModules() {
  const rows = getDb()
    .prepare(
      `SELECT key, name, description, category, is_core, is_enabled, sort, enabled_at
       FROM modules ORDER BY sort, name`,
    )
    .all() as ModuleRow[];

  return rows.map((row) => ({
    key: row.key,
    name: row.name,
    description: row.description,
    category: row.category,
    isCore: row.is_core === 1,
    enabled: row.is_enabled === 1,
    enabledAt: row.enabled_at,
    sort: row.sort,
  }));
}

modulesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ modules: listModules() });
  }),
);

function setEnabled(key: string, enabled: boolean, userId: number) {
  const db = getDb();
  const module = db.prepare('SELECT key, is_core FROM modules WHERE key = ?').get(key) as
    { key: string; is_core: number } | undefined;
  if (!module) throw notFound('Module not found');
  if (!enabled && module.is_core === 1)
    throw new ValidationError('Core modules cannot be disabled');

  db.prepare(
    `UPDATE modules
     SET is_enabled = ?, enabled_at = ?, updated_at = datetime('now')
     WHERE key = ?`,
  ).run(enabled ? 1 : 0, enabled ? new Date().toISOString() : null, key);

  recordAudit(userId, enabled ? 'enable' : 'disable', 'module', null, { key });
  return listModules();
}

modulesRouter.post(
  '/:key/enable',
  requirePermission('modules.manage'),
  asyncHandler(async (req, res) => {
    res.json({ modules: setEnabled(req.params.key ?? '', true, req.user!.id) });
  }),
);

modulesRouter.post(
  '/:key/disable',
  requirePermission('modules.manage'),
  asyncHandler(async (req, res) => {
    res.json({ modules: setEnabled(req.params.key ?? '', false, req.user!.id) });
  }),
);
