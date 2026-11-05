import request from 'supertest';
import { createApp } from '../app.js';
import { ensureReferenceData, getDb } from '../db.js';
import { freshDb, seedUser } from '../test/helpers.js';

const app = createApp();

describe('wave 2 modules', () => {
  let token = '';

  beforeEach(() => {
    freshDb();
    token = seedUser().token;
  });

  describe('maintenance', () => {
    it('registers equipment and runs a request from pending to done', async () => {
      const category = await request(app)
        .post('/api/maintenance/categories')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Forklifts', note: 'Warehouse equipment' })
        .expect(201);
      expect(category.body.category.name).toBe('Forklifts');

      const equipment = await request(app)
        .post('/api/maintenance/equipment')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Forklift A',
          categoryId: category.body.category.id,
          model: 'Toyota 8FG',
          serialNo: 'FL-001',
          location: 'Main warehouse',
          costCents: 25_000_000,
        })
        .expect(201);
      expect(equipment.body.equipment.category_name).toBe('Forklifts');
      expect(equipment.body.equipment.is_active).toBe(1);

      const created = await request(app)
        .post('/api/maintenance/requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          subject: 'Hydraulic leak',
          equipmentId: equipment.body.equipment.id,
          maintenanceType: 'corrective',
          priority: 'high',
          durationHours: 2,
          costCents: 150_000,
        })
        .expect(201);
      expect(created.body.request.number).toBe('MNT-00001');
      expect(created.body.request.status).toBe('pending');

      const id = created.body.request.id;
      await request(app)
        .post(`/api/maintenance/requests/${id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'scheduled', scheduledAt: '2026-11-10' })
        .expect(200);
      await request(app)
        .post(`/api/maintenance/requests/${id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'in_progress' })
        .expect(200);

      const done = await request(app)
        .post(`/api/maintenance/requests/${id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'done', resolution: 'Replaced seal', durationHours: 3, costCents: 200_000 })
        .expect(200);
      expect(done.body.request.status).toBe('done');
      expect(done.body.request.closed_at).toBeTruthy();
      expect(done.body.request.resolution).toBe('Replaced seal');

      const summary = await request(app)
        .get('/api/maintenance/requests/summary')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(summary.body.open.count).toBe(0);
      expect(summary.body.equipmentCount.count).toBe(1);
      expect(
        summary.body.byStatus.find((row: { status: string }) => row.status === 'done').count,
      ).toBe(1);

      const detail = await request(app)
        .get(`/api/maintenance/equipment/${equipment.body.equipment.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(detail.body.requests).toHaveLength(1);
      expect(detail.body.equipment.open_request_count).toBe(0);
    });

    it('refuses to edit a completed request', async () => {
      const equipment = await request(app)
        .post('/api/maintenance/equipment')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Compressor' })
        .expect(201);
      const created = await request(app)
        .post('/api/maintenance/requests')
        .set('Authorization', `Bearer ${token}`)
        .send({ subject: 'Service', equipmentId: equipment.body.equipment.id })
        .expect(201);

      const id = created.body.request.id;
      await request(app)
        .post(`/api/maintenance/requests/${id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'done', resolution: 'Serviced' })
        .expect(200);

      const res = await request(app)
        .put(`/api/maintenance/requests/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ subject: 'Changed' })
        .expect(400);
      expect(res.body.error).toMatch(/completed/i);
    });

    it('rejects a request for unknown equipment', async () => {
      await request(app)
        .post('/api/maintenance/requests')
        .set('Authorization', `Bearer ${token}`)
        .send({ subject: 'Ghost', equipmentId: 9999 })
        .expect(404);
    });

    it('blocks the maintenance API when the module is disabled', async () => {
      await request(app)
        .post('/api/modules/maintenance/disable')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const res = await request(app)
        .get('/api/maintenance/equipment')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(res.body.code).toBe('module_disabled');
    });
  });

  describe('recruitment', () => {
    it('creates a job, candidate and application, then hires into an employee', async () => {
      const job = await request(app)
        .post('/api/recruitment/jobs')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Senior Accountant',
          location: 'Cape Town',
          employmentType: 'permanent',
          openings: 2,
          salaryMinCents: 4_500_000,
          salaryMaxCents: 6_000_000,
          status: 'open',
        })
        .expect(201);
      expect(job.body.job.number).toBe('JOB-00001');
      expect(job.body.job.status).toBe('open');

      const candidate = await request(app)
        .post('/api/recruitment/candidates')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Lerato Nkosi',
          email: 'lerato@example.co.za',
          phone: '082 555 0101',
          degree: 'BCom Accounting',
          source: 'Referral',
        })
        .expect(201);

      const stages = await request(app)
        .get('/api/recruitment/stages')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const screening = stages.body.stages.find(
        (stage: { name: string }) => stage.name === 'Screening',
      );
      expect(screening).toBeTruthy();

      const applicant = await request(app)
        .post('/api/recruitment/applicants')
        .set('Authorization', `Bearer ${token}`)
        .send({
          jobId: job.body.job.id,
          candidateId: candidate.body.candidate.id,
          stageId: screening.id,
          salaryExpectedCents: 5_200_000,
        })
        .expect(201);
      expect(applicant.body.applicant.status).toBe('active');
      expect(applicant.body.applicant.stage_name).toBe('Screening');
      expect(applicant.body.applicant.candidate_name).toBe('Lerato Nkosi');

      const duplicate = await request(app)
        .post('/api/recruitment/applicants')
        .set('Authorization', `Bearer ${token}`)
        .send({ jobId: job.body.job.id, candidateId: candidate.body.candidate.id })
        .expect(400);
      expect(duplicate.body.error).toMatch(/already applied/i);

      const hired = await request(app)
        .post(`/api/recruitment/applicants/${applicant.body.applicant.id}/hire`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(hired.body.applicant.status).toBe('hired');
      expect(hired.body.applicant.stage_name).toBe('Hired');
      expect(hired.body.applicant.employee_id).toBeTruthy();
      expect(hired.body.applicant.hired_employee_number).toMatch(/^EMP-/);

      const employee = getDb()
        .prepare('SELECT * FROM employees WHERE id = ?')
        .get(hired.body.applicant.employee_id) as {
        first_name: string;
        last_name: string;
        email: string;
        job_title: string;
        salary_cents: number;
      };
      expect(employee.first_name).toBe('Lerato');
      expect(employee.last_name).toBe('Nkosi');
      expect(employee.email).toBe('lerato@example.co.za');
      expect(employee.job_title).toBe('Senior Accountant');
      expect(employee.salary_cents).toBe(5200_000);

      const again = await request(app)
        .post(`/api/recruitment/applicants/${applicant.body.applicant.id}/hire`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
      expect(again.body.error).toMatch(/already hired/i);

      const jobDetail = await request(app)
        .get(`/api/recruitment/jobs/${job.body.job.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(jobDetail.body.job.hired_count).toBe(1);
      expect(jobDetail.body.applicants).toHaveLength(1);
    });

    it('moves an applicant between stages and records a refusal', async () => {
      const job = await request(app)
        .post('/api/recruitment/jobs')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Store Manager', status: 'open' })
        .expect(201);
      const candidate = await request(app)
        .post('/api/recruitment/candidates')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Sipho Dlamini' })
        .expect(201);
      const applicant = await request(app)
        .post('/api/recruitment/applicants')
        .set('Authorization', `Bearer ${token}`)
        .send({ jobId: job.body.job.id, candidateId: candidate.body.candidate.id })
        .expect(201);

      const stages = await request(app)
        .get('/api/recruitment/stages')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const interview = stages.body.stages.find(
        (stage: { name: string }) => stage.name === 'Interview',
      );

      const moved = await request(app)
        .put(`/api/recruitment/applicants/${applicant.body.applicant.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stageId: interview.id })
        .expect(200);
      expect(moved.body.applicant.stage_name).toBe('Interview');
      expect(moved.body.applicant.status).toBe('active');

      const refused = await request(app)
        .put(`/api/recruitment/applicants/${applicant.body.applicant.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'refused', refuseReason: 'Not enough experience' })
        .expect(200);
      expect(refused.body.applicant.status).toBe('refused');
      expect(refused.body.applicant.refuse_reason).toBe('Not enough experience');
      expect(refused.body.applicant.closed_at).toBeTruthy();
    });

    it('keeps the employee sequence ahead of manually seeded employee numbers', () => {
      const db = getDb();
      db.prepare(
        `INSERT INTO employees (employee_number, first_name, last_name, start_date)
         VALUES ('EMP-00001', 'Demo', 'Employee', '2024-01-01')`,
      ).run();
      db.prepare("UPDATE sequences SET next_number = 1 WHERE doc_type = 'employee'").run();

      ensureReferenceData(db);

      const sequence = db
        .prepare("SELECT next_number FROM sequences WHERE doc_type = 'employee'")
        .get() as { next_number: number };
      expect(sequence.next_number).toBe(2);
    });

    it('rejects a job whose maximum salary is below the minimum', async () => {
      const res = await request(app)
        .post('/api/recruitment/jobs')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Bad range', salaryMinCents: 5_000_000, salaryMaxCents: 1_000_000 })
        .expect(400);
      expect(res.body.error).toMatch(/maximum salary/i);
    });

    it('blocks the recruitment API when the module is disabled', async () => {
      await request(app)
        .post('/api/modules/recruitment/disable')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const res = await request(app)
        .get('/api/recruitment/jobs')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(res.body.code).toBe('module_disabled');
    });
  });
});
