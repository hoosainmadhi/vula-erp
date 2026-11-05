import { getDb } from '../db.js';

export function recordAudit(
  userId: number | null,
  action: string,
  entity: string,
  entityId: number | null,
  details?: unknown,
): void {
  getDb()
    .prepare(
      'INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)',
    )
    .run(userId, action, entity, entityId, details === undefined ? null : JSON.stringify(details));
}
