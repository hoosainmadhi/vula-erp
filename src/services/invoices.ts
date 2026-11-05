import { getDb } from '../db.js';
import { ValidationError, notFound } from '../utils/errors.js';
import { lineTotals } from '../utils/money.js';
import { postPayment, postPurchaseBill, postSalesInvoice } from './accounting.js';
import { recordAudit } from './audit.js';
import { nextNumber } from './sequences.js';

export interface InvoiceLineInput {
  productId?: number | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBp: number;
}

export interface CreateInvoiceInput {
  direction: 'sale' | 'purchase';
  partnerId: number;
  issueDate: string;
  dueDate: string;
  notes?: string | null;
  salesOrderId?: number | null;
  purchaseOrderId?: number | null;
  warehouseId?: number | null;
  lines: InvoiceLineInput[];
  post?: boolean;
  userId?: number | null;
}

export function createInvoice(input: CreateInvoiceInput) {
  const db = getDb();
  const partner = db
    .prepare('SELECT id, name, is_customer, is_supplier FROM partners WHERE id = ?')
    .get(input.partnerId) as
    { id: number; name: string; is_customer: number; is_supplier: number } | undefined;
  if (!partner) throw notFound('Partner not found');
  if (input.direction === 'sale' && partner.is_customer !== 1) {
    throw new ValidationError(`${partner.name} is not a customer`);
  }
  if (input.direction === 'purchase' && partner.is_supplier !== 1) {
    throw new ValidationError(`${partner.name} is not a supplier`);
  }
  if (input.lines.length === 0) throw new ValidationError('An invoice needs at least one line');

  const computed = input.lines.map((line) => {
    if (line.quantity <= 0)
      throw new ValidationError('Invoice line quantity must be greater than zero');
    if (line.unitPriceCents < 0) throw new ValidationError('Invoice line price cannot be negative');
    const totals = lineTotals(line.quantity, line.unitPriceCents, line.taxRateBp);
    return { ...line, ...totals };
  });

  const subtotal = computed.reduce((t, l) => t + l.subtotalCents, 0);
  const tax = computed.reduce((t, l) => t + l.taxCents, 0);
  const total = subtotal + tax;
  const shouldPost = input.post !== false;
  const status = shouldPost ? 'open' : 'draft';
  let warehouseId = input.warehouseId ?? null;
  if (warehouseId === null && input.salesOrderId) {
    const order = db
      .prepare('SELECT warehouse_id FROM sales_orders WHERE id = ?')
      .get(input.salesOrderId) as { warehouse_id: number | null } | undefined;
    warehouseId = order?.warehouse_id ?? null;
  }
  if (warehouseId === null && input.purchaseOrderId) {
    const order = db
      .prepare('SELECT warehouse_id FROM purchase_orders WHERE id = ?')
      .get(input.purchaseOrderId) as { warehouse_id: number | null } | undefined;
    warehouseId = order?.warehouse_id ?? null;
  }

  const invoiceId = db.transaction(() => {
    const number = nextNumber(input.direction === 'sale' ? 'sales_invoice' : 'purchase_bill');
    const result = db
      .prepare(
        `INSERT INTO invoices
           (number, direction, partner_id, sales_order_id, purchase_order_id, warehouse_id, status,
            issue_date, due_date, subtotal_cents, tax_cents, total_cents, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        number,
        input.direction,
        input.partnerId,
        input.salesOrderId ?? null,
        input.purchaseOrderId ?? null,
        warehouseId,
        status,
        input.issueDate,
        input.dueDate,
        subtotal,
        tax,
        total,
        input.notes ?? null,
        input.userId ?? null,
      );
    const id = Number(result.lastInsertRowid);

    const insertLine = db.prepare(
      `INSERT INTO invoice_lines
         (invoice_id, product_id, description, quantity, unit_price_cents, tax_rate_bp,
          line_subtotal_cents, line_tax_cents, line_total_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const line of computed) {
      insertLine.run(
        id,
        line.productId ?? null,
        line.description,
        line.quantity,
        line.unitPriceCents,
        line.taxRateBp,
        line.subtotalCents,
        line.taxCents,
        line.totalCents,
      );
    }

    if (shouldPost) {
      if (input.direction === 'sale') postSalesInvoice(id);
      else postPurchaseBill(id);
    }

    if (input.salesOrderId) {
      db.prepare(
        "UPDATE sales_orders SET status = 'invoiced', updated_at = datetime('now') WHERE id = ?",
      ).run(input.salesOrderId);
    }

    recordAudit(input.userId ?? null, 'create', 'invoice', id, {
      number,
      direction: input.direction,
      totalCents: total,
    });
    return id;
  })();

  return getInvoice(invoiceId);
}

export function getInvoice(id: number) {
  const db = getDb();
  const invoice = db
    .prepare(
      `SELECT i.*, p.name AS partner_name, p.vat_number AS partner_vat_number,
              p.email AS partner_email, p.address_line1 AS partner_address,
              w.name AS warehouse_name
       FROM invoices i
       JOIN partners p ON p.id = i.partner_id
       LEFT JOIN warehouses w ON w.id = i.warehouse_id
       WHERE i.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!invoice) throw notFound('Invoice not found');
  const lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id').all(id);
  return { ...invoice, lines };
}

export interface PaymentInput {
  partnerId: number;
  invoiceId?: number | null;
  direction: 'in' | 'out';
  paymentDate: string;
  amountCents: number;
  method: 'cash' | 'bank' | 'card' | 'eft' | 'other';
  reference?: string | null;
  notes?: string | null;
  userId?: number | null;
}

export function recordPayment(input: PaymentInput) {
  const db = getDb();
  if (input.amountCents <= 0) throw new ValidationError('Payment amount must be greater than zero');

  let invoice:
    | {
        id: number;
        number: string;
        direction: 'sale' | 'purchase';
        total_cents: number;
        amount_paid_cents: number;
        status: string;
      }
    | undefined;
  if (input.invoiceId) {
    invoice = db
      .prepare(
        'SELECT id, number, direction, total_cents, amount_paid_cents, status FROM invoices WHERE id = ?',
      )
      .get(input.invoiceId) as typeof invoice;
    if (!invoice) throw notFound('Invoice not found');
    if (invoice.status === 'void') throw new ValidationError('Cannot pay a void invoice');
    const expectedDirection = invoice.direction === 'sale' ? 'in' : 'out';
    if (input.direction !== expectedDirection) {
      throw new ValidationError(
        `This invoice expects a payment ${expectedDirection === 'in' ? 'in' : 'out'}`,
      );
    }
    const outstanding = invoice.total_cents - invoice.amount_paid_cents;
    if (input.amountCents > outstanding) {
      throw new ValidationError(`Payment exceeds outstanding amount (${outstanding} cents)`);
    }
  }

  const paymentId = db.transaction(() => {
    const number = nextNumber('payment');
    const result = db
      .prepare(
        `INSERT INTO payments
           (number, direction, partner_id, invoice_id, payment_date, amount_cents, method, reference, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        number,
        input.direction,
        input.partnerId,
        input.invoiceId ?? null,
        input.paymentDate,
        input.amountCents,
        input.method,
        input.reference ?? null,
        input.notes ?? null,
        input.userId ?? null,
      );
    const id = Number(result.lastInsertRowid);

    if (invoice) {
      const paid = invoice.amount_paid_cents + input.amountCents;
      const status = paid >= invoice.total_cents ? 'paid' : 'open';
      db.prepare(
        "UPDATE invoices SET amount_paid_cents = ?, status = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(paid, status, invoice.id);
    }

    postPayment(id);
    recordAudit(input.userId ?? null, 'create', 'payment', id, {
      number,
      amountCents: input.amountCents,
      invoice: invoice?.number ?? null,
    });
    return id;
  })();

  return db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
}

export function deleteDraftInvoice(id: number, userId: number | null): void {
  const invoice = getDb()
    .prepare('SELECT id, status, direction, number FROM invoices WHERE id = ?')
    .get(id) as
    { id: number; status: string; direction: 'sale' | 'purchase'; number: string } | undefined;
  if (!invoice) throw notFound('Invoice not found');
  if (invoice.status !== 'draft') throw new ValidationError('Only draft invoices can be deleted');
  getDb().prepare('DELETE FROM invoices WHERE id = ?').run(id);
  recordAudit(userId, 'delete', 'invoice', id, { number: invoice.number });
}

export function postDraftInvoice(id: number, userId: number | null): number {
  const db = getDb();
  const invoice = db
    .prepare('SELECT id, status, direction, number FROM invoices WHERE id = ?')
    .get(id) as
    { id: number; status: string; direction: 'sale' | 'purchase'; number: string } | undefined;
  if (!invoice) throw notFound('Invoice not found');
  if (invoice.status !== 'draft') throw new ValidationError('Only draft invoices can be posted');

  const entryId = db.transaction(() => {
    const posted = invoice.direction === 'sale' ? postSalesInvoice(id) : postPurchaseBill(id);
    db.prepare(
      "UPDATE invoices SET status = 'open', updated_at = datetime('now') WHERE id = ?",
    ).run(id);
    recordAudit(userId, 'post', 'invoice', id, { number: invoice.number });
    return posted;
  })();
  return entryId;
}
