import request from 'supertest';
import { createApp } from '../app.js';
import { getDb } from '../db.js';
import { freshDb, seedUser } from '../test/helpers.js';

const app = createApp();

function seedEmployee(email: string, number: string): number {
  const result = getDb()
    .prepare(
      `INSERT INTO employees (employee_number, first_name, last_name, email, start_date)
       VALUES (?, ?, ?, ?, '2024-01-15')`,
    )
    .run(number, 'Test', 'Employee', email);
  return Number(result.lastInsertRowid);
}

describe('employee self-service', () => {
  let token = '';

  beforeEach(() => {
    freshDb();
    token = seedUser({
      email: 'employee@example.com',
      role: 'employee',
      firstName: 'Test',
      lastName: 'Employee',
    }).token;
  });

  it('lets an employee view their own leave and apply for leave', async () => {
    const employeeId = seedEmployee('employee@example.com', 'EMP-00001');
    const leaveType = getDb()
      .prepare("SELECT id FROM leave_types WHERE name = 'Annual Leave'")
      .get() as { id: number };

    const before = await request(app)
      .get('/api/leave/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(before.body.employee.id).toBe(employeeId);
    expect(before.body.requests).toHaveLength(0);
    expect(
      before.body.balances.find(
        (b: { leave_type_name: string }) => b.leave_type_name === 'Annual Leave',
      ).approved_days,
    ).toBe(0);

    const created = await request(app)
      .post('/api/leave/me/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        leaveTypeId: leaveType.id,
        startDate: '2026-12-20',
        endDate: '2026-12-24',
        reason: 'Family holiday',
      })
      .expect(201);
    expect(created.body.leaveRequest.days).toBe(5);
    expect(created.body.leaveRequest.status).toBe('pending');

    const after = await request(app)
      .get('/api/leave/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(after.body.requests).toHaveLength(1);
    const balance = after.body.balances.find(
      (b: { leave_type_name: string }) => b.leave_type_name === 'Annual Leave',
    );
    expect(balance.pending_days).toBe(5);

    const cancelled = await request(app)
      .post(`/api/leave/me/requests/${created.body.leaveRequest.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(cancelled.body.ok).toBe(true);
  });

  it('only exposes the signed-in employee’s own requests', async () => {
    const ownId = seedEmployee('employee@example.com', 'EMP-00001');
    const otherId = seedEmployee('other@example.com', 'EMP-00002');
    const leaveType = getDb()
      .prepare("SELECT id FROM leave_types WHERE name = 'Annual Leave'")
      .get() as { id: number };

    getDb()
      .prepare(
        `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, status)
         VALUES (?, ?, '2026-12-01', '2026-12-02', 2, 'approved')`,
      )
      .run(otherId, leaveType.id);

    const mine = await request(app)
      .get('/api/leave/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(mine.body.employee.id).toBe(ownId);
    expect(mine.body.requests).toHaveLength(0);

    const adminList = await request(app)
      .get('/api/leave/requests')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(adminList.body.error).toMatch(/permission/i);
  });

  it('refuses self-service when the user is not linked to an employee', async () => {
    const res = await request(app)
      .get('/api/leave/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(res.body.code).toBe('employee_not_linked');
  });
});
