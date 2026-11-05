import request from 'supertest';
import { createApp } from '../app.js';
import { getDb } from '../db.js';
import { freshDb, seedPartner, seedProduct, seedUser } from '../test/helpers.js';

const app = createApp();

function addWarehouse(code: string, name: string): number {
  const result = getDb()
    .prepare('INSERT INTO warehouses (code, name) VALUES (?, ?)')
    .run(code, name);
  return Number(result.lastInsertRowid);
}

describe('branch-scoped users and workshop row scoping', () => {
  let adminToken = '';

  beforeEach(() => {
    freshDb();
    adminToken = seedUser().token;
  });

  it('restricts a branch user to their branch on list and create', async () => {
    const mainId = (
      getDb().prepare("SELECT id FROM warehouses WHERE code = 'MAIN'").get() as { id: number }
    ).id;
    const eastId = addWarehouse('EAST', 'Eastern Cape');

    const customerId = seedPartner({ name: 'Kitchen Studio', isCustomer: true });
    const productId = seedProduct({ sku: 'BR-1', name: 'Board', salePriceCents: 100_000 });
    const line = {
      productId,
      description: 'Board',
      quantity: 1,
      unitPriceCents: 100_000,
      taxRateBp: 1500,
    };

    await request(app)
      .post('/api/sales-orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, warehouseId: mainId, orderDate: '2026-11-05', lines: [line] })
      .expect(201);
    await request(app)
      .post('/api/sales-orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, warehouseId: eastId, orderDate: '2026-11-05', lines: [line] })
      .expect(201);

    const branchUser = seedUser({ email: 'east@example.com', role: 'sales' });
    getDb().prepare('UPDATE users SET warehouse_id = ? WHERE id = ?').run(eastId, branchUser.id);

    const list = await request(app)
      .get('/api/sales-orders')
      .set('Authorization', `Bearer ${branchUser.token}`)
      .expect(200);
    expect(list.body.salesOrders).toHaveLength(1);
    expect(list.body.salesOrders[0].warehouse_id).toBe(eastId);

    // A branch user cannot create an order in another branch, even if they ask.
    const created = await request(app)
      .post('/api/sales-orders')
      .set('Authorization', `Bearer ${branchUser.token}`)
      .send({ customerId, warehouseId: mainId, orderDate: '2026-11-05', lines: [line] })
      .expect(201);
    expect(created.body.salesOrder.warehouse_id).toBe(eastId);

    // Admins remain unscoped.
    const adminList = await request(app)
      .get('/api/sales-orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminList.body.salesOrders).toHaveLength(3);
  });

  it('hides workshop jobs assigned to other staff', async () => {
    const other = seedUser({ email: 'other@example.com', role: 'workshop' });
    const lead = seedUser({ email: 'lead@example.com', role: 'workshop' });

    const assigned = await request(app)
      .post('/api/workshop/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Assigned job', assignedTo: other.id, paymentRequired: false })
      .expect(201);
    const unassigned = await request(app)
      .post('/api/workshop/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Unassigned job', paymentRequired: false })
      .expect(201);

    const list = await request(app)
      .get('/api/workshop/jobs')
      .set('Authorization', `Bearer ${lead.token}`)
      .expect(200);
    const ids = list.body.jobs.map((job: { id: number }) => job.id);
    expect(ids).toContain(unassigned.body.job.id);
    expect(ids).not.toContain(assigned.body.job.id);

    await request(app)
      .get(`/api/workshop/jobs/${assigned.body.job.id}`)
      .set('Authorization', `Bearer ${lead.token}`)
      .expect(403);

    const adminList = await request(app)
      .get('/api/workshop/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminList.body.jobs).toHaveLength(2);
  });
});
