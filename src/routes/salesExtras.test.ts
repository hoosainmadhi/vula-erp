import request from 'supertest';
import { createApp } from '../app.js';
import { freshDb, seedPartner, seedProduct, seedUser } from '../test/helpers.js';

const app = createApp();

describe('quotations, credit notes and project costing', () => {
  let token = '';

  beforeEach(() => {
    freshDb();
    token = seedUser().token;
  });

  it('creates a quotation and converts it to a sales order', async () => {
    const customerId = seedPartner({ name: 'Kitchen Studio', isCustomer: true });
    const productId = seedProduct({ sku: 'Q-BOARD', name: 'Board', salePriceCents: 100_000 });

    const quote = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        quoteDate: '2026-11-05',
        validUntil: '2026-11-30',
        lines: [
          {
            productId,
            description: 'Cut and edge board',
            quantity: 2,
            unitPriceCents: 100_000,
            taxRateBp: 1500,
          },
        ],
      })
      .expect(201);
    expect(quote.body.quotation.number).toBe('QT-00001');
    expect(quote.body.quotation.status).toBe('draft');
    expect(quote.body.quotation.total_cents).toBe(230_000);

    const converted = await request(app)
      .post(`/api/quotations/${quote.body.quotation.id}/convert`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(converted.body.quotation.status).toBe('converted');
    expect(converted.body.salesOrderId).toBeTruthy();

    const order = await request(app)
      .get(`/api/sales-orders/${converted.body.salesOrderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(order.body.salesOrder.lines).toHaveLength(1);
    expect(order.body.salesOrder.total_cents).toBe(230_000);
  });

  it('posts a credit note against an invoice', async () => {
    const customerId = seedPartner({ name: 'Kitchen Studio', isCustomer: true });
    const productId = seedProduct({ sku: 'C-BOARD', name: 'Board', salePriceCents: 100_000 });
    const invoice = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        direction: 'sale',
        partnerId: customerId,
        issueDate: '2026-11-05',
        dueDate: '2026-11-30',
        post: true,
        lines: [
          {
            productId,
            description: 'Board',
            quantity: 1,
            unitPriceCents: 100_000,
            taxRateBp: 1500,
          },
        ],
      })
      .expect(201);

    const credit = await request(app)
      .post('/api/credit-notes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        invoiceId: invoice.body.invoice.id,
        issueDate: '2026-11-05',
        subtotalCents: 50_000,
        taxCents: 7_500,
        reason: 'Short delivery',
      })
      .expect(201);
    expect(credit.body.creditNote.number).toBe('CRN-00001');
    expect(credit.body.creditNote.total_cents).toBe(57_500);
    expect(credit.body.creditNote.journal_entry_id).toBeTruthy();

    const list = await request(app)
      .get('/api/credit-notes')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.creditNotes).toHaveLength(1);
    expect(list.body.creditNotes[0].reason).toBe('Short delivery');
  });

  it('tracks project costs and profitability', async () => {
    const project = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Kitchen renovation', budgetCents: 10_000_000 })
      .expect(201);

    await request(app)
      .post(`/api/projects/${project.body.project.id}/costs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'material',
        description: 'Boards',
        amountCents: 3_000_000,
        costDate: '2026-11-05',
      })
      .expect(201);
    await request(app)
      .post(`/api/projects/${project.body.project.id}/costs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'labour',
        description: 'Installation',
        amountCents: 1_500_000,
        costDate: '2026-11-05',
      })
      .expect(201);

    const detail = await request(app)
      .get(`/api/projects/${project.body.project.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detail.body.costs).toHaveLength(2);
    expect(detail.body.profitability.material).toBe(3_000_000);
    expect(detail.body.profitability.labour).toBe(1_500_000);
    expect(detail.body.profitability.totalCost).toBe(4_500_000);
    expect(detail.body.profitability.margin).toBe(5_500_000);
  });
});
