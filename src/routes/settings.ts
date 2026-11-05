import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { ValidationError } from '../utils/errors.js';
import { recordAudit } from '../services/audit.js';

export const settingsRouter = Router();
settingsRouter.use(authenticate);

const TEXT_KEYS = new Set([
  'company_name',
  'company_registration',
  'company_vat_number',
  'company_email',
  'company_phone',
  'company_address',
  'company_logo',
  'currency',
]);

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = getDb()
      .prepare('SELECT key, value, updated_at FROM settings ORDER BY key')
      .all() as {
      key: string;
      value: string;
      updated_at: string;
    }[];
    const settings: Record<string, string> = {};
    for (const row of rows) settings[row.key] = row.value;
    res.json({ settings });
  }),
);

settingsRouter.put(
  '/',
  requirePermission('settings.manage'),
  asyncHandler(async (req, res) => {
    const updates = req.body?.settings;
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      throw new ValidationError('settings must be an object');
    }

    const db = getDb();
    const known = db.prepare('SELECT key FROM settings').all() as { key: string }[];
    const allowed = new Set(known.map((row) => row.key));

    const normalized: Record<string, string> = {};
    for (const [key, raw] of Object.entries(updates as Record<string, unknown>)) {
      if (!allowed.has(key)) throw new ValidationError(`Unknown setting: ${key}`);
      if (TEXT_KEYS.has(key)) {
        if (typeof raw !== 'string') throw new ValidationError(`${key} must be text`);
        normalized[key] = raw.trim();
        continue;
      }
      if (key === 'vat_rate_bp') {
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 0 || value > 10000) {
          throw new ValidationError('VAT rate must be between 0 and 10000 basis points');
        }
        normalized[key] = String(value);
        continue;
      }
      if (key === 'invoice_due_days') {
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 0 || value > 365) {
          throw new ValidationError('Invoice due days must be between 0 and 365');
        }
        normalized[key] = String(value);
        continue;
      }
      if (key === 'fiscal_year_start') {
        if (typeof raw !== 'string' || !/^\d{2}-\d{2}$/.test(raw)) {
          throw new ValidationError('Fiscal year start must be MM-DD');
        }
        normalized[key] = raw;
        continue;
      }
      if (key === 'default_warehouse_id') {
        const value = Number(raw);
        if (!Number.isInteger(value) || value <= 0) throw new ValidationError('Invalid warehouse');
        const warehouse = db.prepare('SELECT id FROM warehouses WHERE id = ?').get(value);
        if (!warehouse) throw new ValidationError('Warehouse not found');
        normalized[key] = String(value);
        continue;
      }
      normalized[key] = String(raw);
    }

    db.transaction(() => {
      const upsert = db.prepare(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
      );
      for (const [key, value] of Object.entries(normalized)) upsert.run(key, value);
      recordAudit(req.user!.id, 'update', 'settings', null, normalized);
    })();

    const rows = db.prepare('SELECT key, value FROM settings ORDER BY key').all() as {
      key: string;
      value: string;
    }[];
    const settings: Record<string, string> = {};
    for (const row of rows) settings[row.key] = row.value;
    res.json({ settings });
  }),
);
