import request from 'supertest';
import { createApp } from '../app.js';
import { freshDb, seedPartner, seedProduct, seedUser } from '../test/helpers.js';

const app = createApp();

describe('workshop jobs', () => {
  let token = '';

  beforeEach(() => {
    freshDb();
    token = seedUser().token;
  });

  it('blocks production until the linked invoice is paid, then runs the job', async () => {
    const customerId = seedPartner({ name: 'Kitchen Studio', isCustomer: true });
    const productId = seedProduct({ sku: 'WS-BOARD', name: 'Board', salePriceCents: 100_000 });
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
            description: 'Cut and edge',
            quantity: 1,
            unitPriceCents: 500_000,
            taxRateBp: 1500,
          },
        ],
      })
      .expect(201);

    const job = await request(app)
      .post('/api/workshop/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Kitchen carcasses',
        customerId,
        invoiceId: invoice.body.invoice.id,
        paymentRequired: true,
        quotedCents: 500_000,
        materialCostCents: 200_000,
        labourCostCents: 100_000,
        cuttingListNotes: '16mm white, 22mm ABS edging',
      })
      .expect(201);
    expect(job.body.job.number).toBe('WS-00001');
    expect(job.body.job.operations).toHaveLength(4);

    const blocked = await request(app)
      .post(`/api/workshop/jobs/${job.body.job.id}/release`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(blocked.body.error).toMatch(/paid/i);

    await request(app)
      .post('/api/invoices/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        partnerId: customerId,
        invoiceId: invoice.body.invoice.id,
        direction: 'in',
        paymentDate: '2026-11-05',
        amountCents: invoice.body.invoice.total_cents,
        method: 'eft',
      })
      .expect(201);

    const released = await request(app)
      .post(`/api/workshop/jobs/${job.body.job.id}/release`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(released.body.job.status).toBe('queued');

    for (const operation of released.body.job.operations) {
      await request(app)
        .post(`/api/workshop/jobs/${job.body.job.id}/operations/${operation.id}/start`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await request(app)
        .post(`/api/workshop/jobs/${job.body.job.id}/operations/${operation.id}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }

    const ready = await request(app)
      .get(`/api/workshop/jobs/${job.body.job.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(ready.body.job.status).toBe('ready');
    expect(ready.body.job.done_operation_count).toBe(4);

    const collected = await request(app)
      .post(`/api/workshop/jobs/${job.body.job.id}/collect`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(collected.body.job.status).toBe('collected');
  });

  it('stores and returns cutting-list files', async () => {
    const customerId = seedPartner({ name: 'Kitchen Studio', isCustomer: true });
    const job = await request(app)
      .post('/api/workshop/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Cut list', customerId, paymentRequired: false })
      .expect(201);

    const upload = await request(app)
      .post(`/api/workshop/jobs/${job.body.job.id}/files`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        filename: 'cutting-list.txt',
        mimeType: 'text/plain',
        dataBase64: Buffer.from('cutting list').toString('base64'),
      })
      .expect(201);
    expect(upload.body.file.size_bytes).toBe(12);

    const download = await request(app)
      .get(`/api/workshop/jobs/${job.body.job.id}/files/${upload.body.file.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(download.text).toBe('cutting list');
  });
});
