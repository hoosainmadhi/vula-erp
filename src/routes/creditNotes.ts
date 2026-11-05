import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { ValidationError, notFound } from '../utils/errors.js';
import {
  optionalCents,
  optionalString,
  paramId,
  requireCents,
  requireDate,
  requireInt,
} from '../utils/validate.js';
import { accountByCode, postJournalEntry } from '../services/accounting.js';
import { nextNumber } from '../services/sequences.js';
import { recordAudit } from '../services/audit.js';

export const creditNotesRouter = Router();
creditNotesRouter.use(authenticate);

function detail(id: number) {
  const note = getDb()
    .prepare(
      `SELECT c.*, i.number AS invoice_number, i.direction AS invoice_direction,
              p.name AS partner_name
       FROM credit_notes c
       JOIN invoices i ON i.id = c.invoice_id
       JOIN partners p ON p.id = c.partner_id
       WHERE c.id = ?`,
    )
    .get(id);
  if (!note) throw notFound('Credit note not found');
  return note;
}

creditNotesRouter.get(
  '/',
  requirePermission('invoices.view'),
  asyncHandler(async (req, res) => {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (req.query.invoiceId) {
      where.push('c.invoice_id = ?');
      params.push(Number(req.query.invoiceId));
    }
    if (req.query.partnerId) {
      where.push('c.partner_id = ?');
      params.push(Number(req.query.partnerId));
    }
    const creditNotes = getDb()
      .prepare(
        `SELECT c.*, i.number AS invoice_number, i.direction AS invoice_direction,
                p.name AS partner_name
         FROM credit_notes c
         JOIN invoices i ON i.id = c.invoice_id
         JOIN partners p ON p.id = c.partner_id
         WHERE ${where.join(' AND ')}
         ORDER BY c.id DESC LIMIT 300`,
      )
      .all(...params);
    res.json({ creditNotes });
  }),
);

creditNotesRouter.get(
  '/:id',
  requirePermission('invoices.view'),
  asyncHandler(async (req, res) => {
    res.json({ creditNote: detail(paramId(req.params.id)) });
  }),
);

creditNotesRouter.post(
  '/',
  requirePermission('invoices.manage'),
  asyncHandler(async (req, res) => {
    const invoiceId = requireInt(req.body?.invoiceId, 'Invoice', 1);
    const issueDate = requireDate(req.body?.issueDate, 'Issue date');
    const subtotal = optionalCents(req.body?.subtotalCents, 'Net amount') ?? 0;
    const tax = optionalCents(req.body?.taxCents, 'VAT amount') ?? 0;
    const total = subtotal + tax;
    if (total <= 0) throw new ValidationError('A credit note needs a positive amount');

    const db = getDb();
    const invoice = db
      .prepare(
        `SELECT id, number, direction, partner_id, total_cents, status
         FROM invoices WHERE id = ?`,
      )
      .get(invoiceId) as
      | {
          id: number;
          number: string;
          direction: 'sale' | 'purchase';
          partner_id: number;
          total_cents: number;
          status: string;
        }
      | undefined;
    if (!invoice) throw notFound('Invoice not found');
    if (invoice.status === 'void') throw new ValidationError('Cannot credit a void invoice');
    const credited = db
      .prepare(
        "SELECT COALESCE(SUM(total_cents), 0) AS total FROM credit_notes WHERE invoice_id = ? AND status = 'posted'",
      )
      .get(invoiceId) as { total: number };
    if (total + credited.total > invoice.total_cents) {
      throw new ValidationError(
        `Credit note cannot exceed the invoice total (already credited ${credited.total} cents)`,
      );
    }

    const id = db.transaction(() => {
      const number = nextNumber('credit_note');
      const result = db
        .prepare(
          `INSERT INTO credit_notes
             (number, invoice_id, partner_id, issue_date, subtotal_cents, tax_cents, total_cents,
              reason, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?)`,
        )
        .run(
          number,
          invoice.id,
          invoice.partner_id,
          issueDate,
          subtotal,
          tax,
          total,
          optionalString(req.body?.reason, 'Reason', 2000),
          req.user!.id,
        );
      const creditId = Number(result.lastInsertRowid);

      const items =
        invoice.direction === 'sale'
          ? [
              {
                accountId: accountByCode('4000').id,
                debitCents: subtotal,
                description: `Credit note ${number}`,
              },
              {
                accountId: accountByCode('2100').id,
                debitCents: tax,
                description: `VAT on credit note ${number}`,
              },
              {
                accountId: accountByCode('1100').id,
                creditCents: total,
                description: `Credit note ${number}`,
              },
            ]
          : [
              {
                accountId: accountByCode('2000').id,
                debitCents: total,
                description: `Credit note ${number}`,
              },
              {
                accountId: accountByCode('1200').id,
                creditCents: subtotal,
                description: `Credit note ${number}`,
              },
              {
                accountId: accountByCode('1300').id,
                creditCents: tax,
                description: `VAT on credit note ${number}`,
              },
            ];

      const journalId = postJournalEntry({
        journalCode: 'GEN',
        entryDate: issueDate,
        description: `Credit note ${number} against ${invoice.number}`,
        sourceType: 'credit_note',
        sourceId: creditId,
        userId: req.user!.id,
        items,
      });
      db.prepare('UPDATE credit_notes SET journal_entry_id = ? WHERE id = ?').run(
        journalId,
        creditId,
      );
      return creditId;
    })();

    recordAudit(req.user!.id, 'create', 'credit_note', id);
    res.status(201).json({ creditNote: detail(id) });
  }),
);
