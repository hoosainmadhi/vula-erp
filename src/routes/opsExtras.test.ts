import request from 'supertest';
import { createApp } from '../app.js';
import { getDb } from '../db.js';
import { freshDb, seedPartner, seedProduct, seedUser } from '../test/helpers.js';

const app = createApp();

function seedEmployee(): number {
  const result = getDb()
    .prepare(
      `INSERT INTO employees (employee_number, first_name, last_name, start_date)
       VALUES ('EMP-9001', 'Thabo', 'Mokoena', '2026-01-01')`,
    )
    .run();
  return Number(result.lastInsertRowid);
}

describe('expenses, attendance and aging', () => {
  let token = '';

  beforeEach(() => {
    freshDb();
    token = seedUser().token;
  });

  it('captures an expense, posts it and reverses it on void', async () => {
    const supplierId = seedPartner({ name: 'City Power', isSupplier: true });
    const expense = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        expenseDate: '2026-11-05',
        category: 'Utilities',
        description: 'October electricity',
        supplierId,
        amountCents: 200_000,
        taxCents: 30_000,
        paymentMethod: 'bank',
        post: true,
      })
      .expect(201);
    expect(expense.body.expense.number).toBe('EXP-00001');
    expect(expense.body.expense.status).toBe('posted');
    expect(expense.body.expense.total_cents).toBe(230_000);
    expect(expense.body.expense.journal_entry_id).toBeTruthy();

    const posted = getDb()
      .prepare('SELECT COUNT(*) AS count FROM journal_entries WHERE source_type = ?')
      .get('expense') as { count: number };
    expect(posted.count).toBe(1);

    const voided = await request(app)
      .post(`/api/expenses/${expense.body.expense.id}/void`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(voided.body.expense.status).toBe('void');
    const reversals = getDb()
      .prepare('SELECT COUNT(*) AS count FROM journal_entries WHERE source_type = ?')
      .get('expense_void') as { count: number };
    expect(reversals.count).toBe(1);
  });

  it('records attendance and calculates hours from clock times', async () => {
    const employeeId = seedEmployee();
    const record = await request(app)
      .post('/api/attendance')
      .set('Authorization', `Bearer ${token}`)
      .send({
        employeeId,
        workDate: '2026-11-05',
        clockIn: '08:00',
        clockOut: '16:30',
        status: 'present',
      })
      .expect(201);
    expect(record.body.record.hours).toBe(8.5);
    expect(record.body.record.employee_name).toBe('Thabo Mokoena');

    await request(app)
      .post('/api/attendance')
      .set('Authorization', `Bearer ${token}`)
      .send({ employeeId, workDate: '2026-11-05', status: 'present' })
      .expect(400);

    const list = await request(app)
      .get('/api/attendance?from=2026-11-01&to=2026-11-30')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.records).toHaveLength(1);
    expect(list.body.summary.present).toBe(1);
    expect(list.body.summary.hours).toBe(8.5);
  });

  it('reports receivable aging buckets', async () => {
    const customerId = seedPartner({ name: 'Kitchen Studio', isCustomer: true });
    const productId = seedProduct({ sku: 'AGE-BOARD', name: 'Board', salePriceCents: 100_000 });
    await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        direction: 'sale',
        partnerId: customerId,
        issueDate: '2026-09-01',
        dueDate: '2026-09-30',
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

    const report = await request(app)
      .get('/api/accounting/reports/aging?asOf=2026-11-05&direction=sale')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(report.body.partners).toHaveLength(1);
    expect(report.body.partners[0].partner_name).toBe('Kitchen Studio');
    expect(report.body.totals.days31_60).toBe(115_000);
    expect(report.body.totals.total).toBe(115_000);

    const payables = await request(app)
      .get('/api/accounting/reports/aging?asOf=2026-11-05&direction=purchase')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(payables.body.partners).toHaveLength(0);
  });
});
