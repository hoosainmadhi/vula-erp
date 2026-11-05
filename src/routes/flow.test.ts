import request from 'supertest';
import { createApp } from '../app.js';
import { getDb } from '../db.js';
import {
  authHeader,
  defaultLocationId,
  freshDb,
  seedPartner,
  seedProduct,
  seedUser,
} from '../test/helpers.js';

const app = createApp();

describe('purchase-to-payment and order-to-cash flow', () => {
  let token: string;
  let headers: { Authorization: string };
  let locationId: number;
  let supplierId: number;
  let customerId: number;
  let productId: number;

  beforeEach(() => {
    freshDb();
    token = seedUser().token;
    headers = authHeader(token);
    locationId = defaultLocationId();
    supplierId = seedPartner({ name: 'Acme Supplies', isSupplier: true });
    customerId = seedPartner({ name: 'Beta Retail', isCustomer: true });
    productId = seedProduct({ sku: 'WIDGET-1', salePriceCents: 10_000, costCents: 6_000 });
  });

  it('receives stock, bills the supplier, sells, invoices and settles', async () => {
    // Opening stock so the sale can be fulfilled.
    await request(app)
      .post('/api/inventory/stock/adjust')
      .set(headers)
      .send({ productId, locationId, quantity: 10, note: 'Opening stock' })
      .expect(201);

    // Purchase 5 units at R60 excl VAT.
    const po = await request(app)
      .post('/api/purchase-orders')
      .set(headers)
      .send({
        supplierId,
        orderDate: '2026-11-01',
        lines: [{ productId, quantity: 5, unitCostCents: 6_000, taxRateBp: 1500 }],
      })
      .expect(201);
    const poId = po.body.purchaseOrder.id as number;
    expect(po.body.purchaseOrder.total_cents).toBe(34_500);

    await request(app).post(`/api/purchase-orders/${poId}/confirm`).set(headers).expect(200);
    const received = await request(app)
      .post(`/api/purchase-orders/${poId}/receive`)
      .set(headers)
      .send({ locationId, receivedDate: '2026-11-02' })
      .expect(201);
    expect(received.body.receipt.fullyReceived).toBe(true);

    const stockAfterReceipt = getDb()
      .prepare('SELECT quantity FROM stock_levels WHERE product_id = ? AND location_id = ?')
      .get(productId, locationId) as { quantity: number };
    expect(stockAfterReceipt.quantity).toBe(15);

    // Supplier bill + payment.
    const bill = await request(app)
      .post(`/api/invoices/from-purchase-order/${poId}`)
      .set(headers)
      .send({ issueDate: '2026-11-02' })
      .expect(201);
    const billId = bill.body.invoice.id as number;
    expect(bill.body.invoice.total_cents).toBe(34_500);
    expect(bill.body.invoice.journal_entry_id).toBeTruthy();

    await request(app)
      .post('/api/invoices/payments')
      .set(headers)
      .send({
        direction: 'out',
        partnerId: supplierId,
        invoiceId: billId,
        paymentDate: '2026-11-03',
        amountCents: 34_500,
        method: 'eft',
      })
      .expect(201);

    const paidBill = await request(app).get(`/api/invoices/${billId}`).set(headers).expect(200);
    expect(paidBill.body.invoice.status).toBe('paid');

    // Sales order for 3 units at R100 excl VAT.
    const so = await request(app)
      .post('/api/sales-orders')
      .set(headers)
      .send({
        customerId,
        orderDate: '2026-11-03',
        lines: [{ productId, quantity: 3, unitPriceCents: 10_000, taxRateBp: 1500 }],
      })
      .expect(201);
    const soId = so.body.salesOrder.id as number;
    expect(so.body.salesOrder.total_cents).toBe(34_500);

    await request(app).post(`/api/sales-orders/${soId}/confirm`).set(headers).expect(200);
    await request(app)
      .post(`/api/sales-orders/${soId}/fulfil`)
      .set(headers)
      .send({ locationId })
      .expect(200);

    const stockAfterSale = getDb()
      .prepare('SELECT quantity FROM stock_levels WHERE product_id = ? AND location_id = ?')
      .get(productId, locationId) as { quantity: number };
    expect(stockAfterSale.quantity).toBe(12);

    const invoice = await request(app)
      .post(`/api/sales-orders/${soId}/invoice`)
      .set(headers)
      .send({ issueDate: '2026-11-03' })
      .expect(201);
    const invoiceId = invoice.body.invoice.id as number;
    expect(invoice.body.invoice.total_cents).toBe(34_500);

    await request(app)
      .post('/api/invoices/payments')
      .set(headers)
      .send({
        direction: 'in',
        partnerId: customerId,
        invoiceId,
        paymentDate: '2026-11-03',
        amountCents: 34_500,
        method: 'eft',
      })
      .expect(201);

    const paidInvoice = await request(app)
      .get(`/api/invoices/${invoiceId}`)
      .set(headers)
      .expect(200);
    expect(paidInvoice.body.invoice.status).toBe('paid');

    // Ledger must balance and P&L must show the sale.
    const trial = await request(app)
      .get('/api/accounting/reports/trial-balance')
      .query({ asOf: '2026-12-31' })
      .set(headers)
      .expect(200);
    expect(trial.body.totalDebitCents).toBe(trial.body.totalCreditCents);

    const pl = await request(app)
      .get('/api/accounting/reports/profit-and-loss')
      .query({ from: '2026-11-01', to: '2026-11-30' })
      .set(headers)
      .expect(200);
    expect(pl.body.incomeCents).toBe(30_000);
    expect(pl.body.netProfitCents).toBe(30_000);

    const vat = await request(app)
      .get('/api/accounting/reports/vat')
      .query({ from: '2026-11-01', to: '2026-11-30' })
      .set(headers)
      .expect(200);
    expect(vat.body.outputVatCents).toBe(4_500);
    expect(vat.body.inputVatCents).toBe(4_500);
    expect(vat.body.netVatCents).toBe(0);

    const dashboard = await request(app).get('/api/dashboard').set(headers).expect(200);
    expect(dashboard.body.kpis.salesThisMonthCents).toBe(34_500);
    expect(dashboard.body.kpis.receivablesCents).toBe(0);
  });

  it('prevents overselling stock', async () => {
    await request(app)
      .post('/api/inventory/stock/adjust')
      .set(headers)
      .send({ productId, locationId, quantity: 1 })
      .expect(201);

    const so = await request(app)
      .post('/api/sales-orders')
      .set(headers)
      .send({
        customerId,
        orderDate: '2026-11-03',
        lines: [{ productId, quantity: 5, unitPriceCents: 10_000, taxRateBp: 1500 }],
      })
      .expect(201);
    const soId = so.body.salesOrder.id as number;
    await request(app).post(`/api/sales-orders/${soId}/confirm`).set(headers).expect(200);

    const res = await request(app)
      .post(`/api/sales-orders/${soId}/fulfil`)
      .set(headers)
      .send({ locationId })
      .expect(400);
    expect(res.body.error).toMatch(/insufficient stock/i);
  });

  it('rejects an unbalanced manual journal entry', async () => {
    const accounts = await request(app).get('/api/accounting/accounts').set(headers).expect(200);
    const bank = accounts.body.accounts.find(
      (account: { code: string }) => account.code === '1000',
    );
    const revenue = accounts.body.accounts.find(
      (account: { code: string }) => account.code === '4000',
    );

    const res = await request(app)
      .post('/api/accounting/journal-entries')
      .set(headers)
      .send({
        journalCode: 'GEN',
        entryDate: '2026-11-03',
        description: 'Bad entry',
        items: [
          { accountId: bank.id, debitCents: 1000 },
          { accountId: revenue.id, creditCents: 900 },
        ],
      })
      .expect(400);
    expect(res.body.error).toMatch(/does not balance/i);
  });
});
