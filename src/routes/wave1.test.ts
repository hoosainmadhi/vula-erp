import request from 'supertest';
import { createApp } from '../app.js';
import { getDb } from '../db.js';
import { defaultLocationId, freshDb, seedProduct, seedUser } from '../test/helpers.js';

const app = createApp();

function seedEmployee(): number {
  const result = getDb()
    .prepare(
      `INSERT INTO employees (employee_number, first_name, last_name, start_date)
       VALUES (?, ?, ?, ?)`,
    )
    .run('EMP-00001', 'Thandi', 'Mokoena', '2024-01-15');
  return Number(result.lastInsertRowid);
}

describe('wave 1 modules', () => {
  let token = '';

  beforeEach(() => {
    freshDb();
    token = seedUser().token;
  });

  describe('projects', () => {
    it('creates a project with a generated code and tracks tasks', async () => {
      const created = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Website Revamp',
          status: 'active',
          startDate: '2026-11-01',
          endDate: '2026-12-15',
          budgetCents: 15_000_000,
        })
        .expect(201);

      expect(created.body.project.code).toBe('PRJ-00001');
      expect(created.body.project.budget_cents).toBe(15_000_000);

      const projectId = created.body.project.id;
      const task = await request(app)
        .post(`/api/projects/${projectId}/tasks`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Design home page', priority: 'high', estimatedHours: 8 })
        .expect(201);
      expect(task.body.task.status).toBe('todo');

      await request(app)
        .put(`/api/projects/tasks/${task.body.task.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'done' })
        .expect(200);

      const detail = await request(app)
        .get(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(detail.body.tasks).toHaveLength(1);
      expect(detail.body.project.done_task_count).toBe(1);
    });

    it('rejects an end date before the start date', async () => {
      const res = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Bad dates', startDate: '2026-12-31', endDate: '2026-01-01' })
        .expect(400);
      expect(res.body.error).toMatch(/end date/i);
    });
  });

  describe('timesheets', () => {
    it('runs draft → submitted → approved and totals billable hours', async () => {
      const employeeId = seedEmployee();
      const created = await request(app)
        .post('/api/timesheets')
        .set('Authorization', `Bearer ${token}`)
        .send({
          employeeId,
          workDate: '2026-11-02',
          hours: 6.5,
          task: 'Wireframes',
          billable: true,
        })
        .expect(201);
      expect(created.body.timesheet.status).toBe('draft');

      const id = created.body.timesheet.id;
      await request(app)
        .post(`/api/timesheets/${id}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await request(app)
        .post(`/api/timesheets/${id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const summary = await request(app)
        .get('/api/timesheets/summary?from=2026-11-01&to=2026-11-30')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(summary.body.summary[0].total_hours).toBe(6.5);
      expect(summary.body.summary[0].billable_hours).toBe(6.5);
    });

    it('refuses to edit an approved entry', async () => {
      const employeeId = seedEmployee();
      const created = await request(app)
        .post('/api/timesheets')
        .set('Authorization', `Bearer ${token}`)
        .send({ employeeId, workDate: '2026-11-03', hours: 4 })
        .expect(201);
      const id = created.body.timesheet.id;
      await request(app)
        .post(`/api/timesheets/${id}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await request(app)
        .post(`/api/timesheets/${id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const res = await request(app)
        .put(`/api/timesheets/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ hours: 8 })
        .expect(400);
      expect(res.body.error).toMatch(/approved/i);
    });
  });

  describe('time off', () => {
    it('creates a leave request, approves it and reports the balance', async () => {
      const employeeId = seedEmployee();
      const db = getDb();
      const leaveType = db
        .prepare("SELECT id FROM leave_types WHERE name = 'Annual Leave'")
        .get() as {
        id: number;
      };

      const created = await request(app)
        .post('/api/leave/requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          employeeId,
          leaveTypeId: leaveType.id,
          startDate: '2026-12-20',
          endDate: '2026-12-24',
          reason: 'Family holiday',
        })
        .expect(201);
      expect(created.body.leaveRequest.days).toBe(5);
      expect(created.body.leaveRequest.status).toBe('pending');

      await request(app)
        .post(`/api/leave/requests/${created.body.leaveRequest.id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const summary = await request(app)
        .get('/api/leave/summary?year=2026')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const balance = summary.body.balances.find(
        (row: { employee_id: number; leave_type_id: number }) =>
          row.employee_id === employeeId && row.leave_type_id === leaveType.id,
      );
      expect(balance.approved_days).toBe(5);
      expect(balance.pending_days).toBe(0);
    });
  });

  describe('barcode', () => {
    it('looks up a product by barcode or SKU and lists it for labels', async () => {
      const productId = seedProduct({ sku: 'SKU-LABEL-1', name: 'Label Test' });
      getDb()
        .prepare('UPDATE products SET barcode = ? WHERE id = ?')
        .run('6001234567890', productId);
      getDb()
        .prepare(
          `INSERT INTO stock_levels (product_id, location_id, quantity, updated_at)
           VALUES (?, ?, 12, datetime('now'))`,
        )
        .run(productId, defaultLocationId());

      const byBarcode = await request(app)
        .get('/api/barcode/lookup?code=6001234567890')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(byBarcode.body.product.id).toBe(productId);
      expect(byBarcode.body.product.stock_quantity).toBe(12);

      const bySku = await request(app)
        .get('/api/barcode/lookup?code=sku-label-1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(bySku.body.product.id).toBe(productId);

      const labels = await request(app)
        .get('/api/barcode/labels?q=Label')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(labels.body.products).toHaveLength(1);
    });

    it('returns 404 for an unknown code', async () => {
      await request(app)
        .get('/api/barcode/lookup?code=NOPE')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  it('blocks the barcode API when the module is disabled', async () => {
    await request(app)
      .post('/api/modules/barcode/disable')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const res = await request(app)
      .get('/api/barcode/labels')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(res.body.code).toBe('module_disabled');
  });
});
