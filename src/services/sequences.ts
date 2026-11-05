import { getDb } from '../db.js';
import { HttpError } from '../utils/errors.js';

/** Allocate the next human-readable document number for a sequence (must run inside a transaction). */
export function nextNumber(docType: string): string {
  const db = getDb();
  const sequence = db
    .prepare('SELECT prefix, next_number FROM sequences WHERE doc_type = ?')
    .get(docType) as { prefix: string; next_number: number } | undefined;
  if (!sequence) throw new HttpError(500, `No number sequence configured for ${docType}`);

  db.prepare('UPDATE sequences SET next_number = next_number + 1 WHERE doc_type = ?').run(docType);
  return `${sequence.prefix}-${String(sequence.next_number).padStart(5, '0')}`;
}
