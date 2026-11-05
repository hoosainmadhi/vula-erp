import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { ValidationError, notFound } from '../utils/errors.js';
import {
  optionalCents,
  optionalDate,
  optionalInt,
  optionalString,
  paramId,
  requireEnum,
  requireInt,
  requireString,
} from '../utils/validate.js';
import { nextNumber } from '../services/sequences.js';
import { recordAudit } from '../services/audit.js';

export const recruitmentRouter = Router();
recruitmentRouter.use(authenticate);

const JOB_STATUSES = ['draft', 'open', 'on_hold', 'closed'] as const;
const APPLICANT_STATUSES = ['active', 'hired', 'refused', 'withdrawn'] as const;
const EMPLOYMENT_TYPES = ['permanent', 'contract', 'part_time', 'intern'] as const;

const JOB_SELECT = `
  SELECT j.*, d.name AS department_name, u.first_name || ' ' || u.last_name AS recruiter_name,
    (SELECT COUNT(*) FROM recruitment_applicants a WHERE a.job_id = j.id) AS applicant_count,
    (SELECT COUNT(*) FROM recruitment_applicants a
      WHERE a.job_id = j.id AND a.status = 'hired') AS hired_count
  FROM recruitment_jobs j
  LEFT JOIN departments d ON d.id = j.department_id
  LEFT JOIN users u ON u.id = j.recruiter_id`;

const APPLICANT_SELECT = `
  SELECT a.*, j.number AS job_number, j.title AS job_title,
         c.name AS candidate_name, c.email AS candidate_email, c.phone AS candidate_phone,
         s.name AS stage_name, s.is_hired,
         e.employee_number AS hired_employee_number
  FROM recruitment_applicants a
  JOIN recruitment_jobs j ON j.id = a.job_id
  JOIN recruitment_candidates c ON c.id = a.candidate_id
  JOIN recruitment_stages s ON s.id = a.stage_id
  LEFT JOIN employees e ON e.id = a.employee_id`;

function defaultStageId(): number {
  const stage = getDb()
    .prepare('SELECT id FROM recruitment_stages ORDER BY sort, id LIMIT 1')
    .get() as { id: number } | undefined;
  if (!stage) throw new ValidationError('No recruitment stages are configured');
  return stage.id;
}

function hiredStageId(): number | null {
  const stage = getDb()
    .prepare('SELECT id FROM recruitment_stages WHERE is_hired = 1 ORDER BY sort, id LIMIT 1')
    .get() as { id: number } | undefined;
  return stage?.id ?? null;
}

function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0] ?? fullName, last: '' };
  return { first: parts[0] ?? fullName, last: parts.slice(1).join(' ') };
}

/** Creates the employee record for a hired applicant exactly once. */
function ensureEmployee(applicantId: number): number {
  const db = getDb();
  const applicant = db
    .prepare(
      `SELECT a.employee_id, a.salary_expected_cents, c.name AS candidate_name, c.email,
                j.title AS job_title, j.department_id, j.employment_type,
                j.salary_min_cents
         FROM recruitment_applicants a
         JOIN recruitment_candidates c ON c.id = a.candidate_id
         JOIN recruitment_jobs j ON j.id = a.job_id
         WHERE a.id = ?`,
    )
    .get(applicantId) as
    | {
        employee_id: number | null;
        salary_expected_cents: number;
        candidate_name: string;
        email: string | null;
        job_title: string;
        department_id: number | null;
        employment_type: string;
        salary_min_cents: number;
      }
    | undefined;
  if (!applicant) throw notFound('Applicant not found');
  if (applicant.employee_id) return applicant.employee_id;

  const { first, last } = splitName(applicant.candidate_name);
  const result = db
    .prepare(
      `INSERT INTO employees
           (employee_number, first_name, last_name, email, department_id, job_title,
            employment_type, status, start_date, salary_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
    .run(
      nextNumber('employee'),
      first,
      last,
      applicant.email,
      applicant.department_id,
      applicant.job_title,
      EMPLOYMENT_TYPES.includes(applicant.employment_type as (typeof EMPLOYMENT_TYPES)[number])
        ? applicant.employment_type
        : 'permanent',
      new Date().toISOString().slice(0, 10),
      applicant.salary_expected_cents || applicant.salary_min_cents,
    );
  const employeeId = Number(result.lastInsertRowid);
  db.prepare('UPDATE recruitment_applicants SET employee_id = ? WHERE id = ?').run(
    employeeId,
    applicantId,
  );
  return employeeId;
}

// Stages
recruitmentRouter.get(
  '/stages',
  requirePermission('recruitment.view'),
  asyncHandler(async (_req, res) => {
    const stages = getDb().prepare('SELECT * FROM recruitment_stages ORDER BY sort, id').all();
    res.json({ stages });
  }),
);

// Departments and recruiters, available without the HR module.
recruitmentRouter.get(
  '/options',
  requirePermission('recruitment.view'),
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const departments = db.prepare('SELECT id, name FROM departments ORDER BY name').all();
    const recruiters = db
      .prepare('SELECT id, first_name, last_name, email FROM users ORDER BY first_name, last_name')
      .all();
    res.json({ departments, recruiters });
  }),
);

// Jobs
recruitmentRouter.get(
  '/jobs',
  requirePermission('recruitment.view'),
  asyncHandler(async (req, res) => {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (typeof req.query.status === 'string' && req.query.status !== 'all') {
      where.push('j.status = ?');
      params.push(req.query.status);
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where.push('(j.title LIKE ? OR j.number LIKE ? OR j.location LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const jobs = getDb()
      .prepare(`${JOB_SELECT} WHERE ${where.join(' AND ')} ORDER BY j.created_at DESC`)
      .all(...params);
    res.json({ jobs });
  }),
);

recruitmentRouter.get(
  '/jobs/:id',
  requirePermission('recruitment.view'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const job = db.prepare(`${JOB_SELECT} WHERE j.id = ?`).get(id);
    if (!job) throw notFound('Job not found');
    const applicants = db
      .prepare(`${APPLICANT_SELECT} WHERE a.job_id = ? ORDER BY a.created_at DESC`)
      .all(id);
    res.json({ job, applicants });
  }),
);

recruitmentRouter.post(
  '/jobs',
  requirePermission('recruitment.manage'),
  asyncHandler(async (req, res) => {
    const title = requireString(req.body?.title, 'Title', 200);
    const salaryMin = optionalCents(req.body?.salaryMinCents, 'Minimum salary') ?? 0;
    const salaryMax = optionalCents(req.body?.salaryMaxCents, 'Maximum salary') ?? 0;
    if (salaryMax > 0 && salaryMax < salaryMin) {
      throw new ValidationError('Maximum salary cannot be less than the minimum');
    }

    const db = getDb();
    const id = db.transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO recruitment_jobs
             (number, title, department_id, location, employment_type, description, requirements,
              openings, salary_min_cents, salary_max_cents, status, recruiter_id, posted_at, closes_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          nextNumber('job'),
          title,
          optionalInt(req.body?.departmentId, 'Department', 1),
          optionalString(req.body?.location, 'Location', 200),
          req.body?.employmentType === undefined
            ? 'permanent'
            : requireEnum(req.body.employmentType, 'Employment type', EMPLOYMENT_TYPES),
          optionalString(req.body?.description, 'Description', 5000),
          optionalString(req.body?.requirements, 'Requirements', 5000),
          requireInt(req.body?.openings ?? 1, 'Openings', 1, 999),
          salaryMin,
          salaryMax,
          req.body?.status === undefined
            ? 'draft'
            : requireEnum(req.body.status, 'Status', JOB_STATUSES),
          optionalInt(req.body?.recruiterId, 'Recruiter', 1),
          optionalDate(req.body?.postedAt, 'Posted date'),
          optionalDate(req.body?.closesAt, 'Closing date'),
        );
      return Number(result.lastInsertRowid);
    })();

    recordAudit(req.user!.id, 'create', 'recruitment_job', id);
    res.status(201).json({ job: db.prepare(`${JOB_SELECT} WHERE j.id = ?`).get(id) });
  }),
);

recruitmentRouter.put(
  '/jobs/:id',
  requirePermission('recruitment.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM recruitment_jobs WHERE id = ?').get(id) as
      | (Record<string, unknown> & {
          title: string;
          salary_min_cents: number;
          salary_max_cents: number;
          posted_at: string | null;
          closes_at: string | null;
        })
      | undefined;
    if (!existing) throw notFound('Job not found');

    const salaryMin =
      req.body?.salaryMinCents === undefined
        ? existing.salary_min_cents
        : (optionalCents(req.body.salaryMinCents, 'Minimum salary') ?? 0);
    const salaryMax =
      req.body?.salaryMaxCents === undefined
        ? existing.salary_max_cents
        : (optionalCents(req.body.salaryMaxCents, 'Maximum salary') ?? 0);
    if (salaryMax > 0 && salaryMax < salaryMin) {
      throw new ValidationError('Maximum salary cannot be less than the minimum');
    }

    db.prepare(
      `UPDATE recruitment_jobs SET title = ?, department_id = ?, location = ?,
         employment_type = ?, description = ?, requirements = ?, openings = ?,
         salary_min_cents = ?, salary_max_cents = ?, status = ?, recruiter_id = ?,
         posted_at = ?, closes_at = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      req.body?.title === undefined ? existing.title : requireString(req.body.title, 'Title', 200),
      req.body?.departmentId === undefined
        ? (existing.department_id as number | null)
        : optionalInt(req.body.departmentId, 'Department', 1),
      req.body?.location === undefined
        ? (existing.location as string | null)
        : optionalString(req.body.location, 'Location', 200),
      req.body?.employmentType === undefined
        ? existing.employment_type
        : requireEnum(req.body.employmentType, 'Employment type', EMPLOYMENT_TYPES),
      req.body?.description === undefined
        ? (existing.description as string | null)
        : optionalString(req.body.description, 'Description', 5000),
      req.body?.requirements === undefined
        ? (existing.requirements as string | null)
        : optionalString(req.body.requirements, 'Requirements', 5000),
      req.body?.openings === undefined
        ? existing.openings
        : requireInt(req.body.openings, 'Openings', 1, 999),
      salaryMin,
      salaryMax,
      req.body?.status === undefined
        ? existing.status
        : requireEnum(req.body.status, 'Status', JOB_STATUSES),
      req.body?.recruiterId === undefined
        ? (existing.recruiter_id as number | null)
        : optionalInt(req.body.recruiterId, 'Recruiter', 1),
      req.body?.postedAt === undefined
        ? existing.posted_at
        : optionalDate(req.body.postedAt, 'Posted date'),
      req.body?.closesAt === undefined
        ? existing.closes_at
        : optionalDate(req.body.closesAt, 'Closing date'),
      id,
    );
    recordAudit(req.user!.id, 'update', 'recruitment_job', id);
    res.json({ job: db.prepare(`${JOB_SELECT} WHERE j.id = ?`).get(id) });
  }),
);

recruitmentRouter.delete(
  '/jobs/:id',
  requirePermission('recruitment.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb().prepare('DELETE FROM recruitment_jobs WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('Job not found');
    recordAudit(req.user!.id, 'delete', 'recruitment_job', id);
    res.json({ ok: true });
  }),
);

// Candidates
recruitmentRouter.get(
  '/candidates',
  requirePermission('recruitment.view'),
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (q) {
      where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const candidates = getDb()
      .prepare(
        `SELECT c.*,
           (SELECT COUNT(*) FROM recruitment_applicants a WHERE a.candidate_id = c.id) AS application_count
         FROM recruitment_candidates c
         WHERE ${where.join(' AND ')} ORDER BY c.name LIMIT 300`,
      )
      .all(...params);
    res.json({ candidates });
  }),
);

recruitmentRouter.post(
  '/candidates',
  requirePermission('recruitment.manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const result = db
      .prepare(
        `INSERT INTO recruitment_candidates
           (name, email, phone, linkedin_profile, degree, source, availability_date, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        requireString(req.body?.name, 'Name', 200),
        optionalString(req.body?.email, 'Email', 200),
        optionalString(req.body?.phone, 'Phone', 50),
        optionalString(req.body?.linkedinProfile, 'LinkedIn profile', 300),
        optionalString(req.body?.degree, 'Degree', 200),
        optionalString(req.body?.source, 'Source', 100),
        optionalDate(req.body?.availabilityDate, 'Availability date'),
        optionalString(req.body?.notes, 'Notes', 5000),
      );
    const id = Number(result.lastInsertRowid);
    recordAudit(req.user!.id, 'create', 'recruitment_candidate', id);
    res
      .status(201)
      .json({ candidate: db.prepare('SELECT * FROM recruitment_candidates WHERE id = ?').get(id) });
  }),
);

recruitmentRouter.put(
  '/candidates/:id',
  requirePermission('recruitment.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM recruitment_candidates WHERE id = ?').get(id) as
      | (Record<string, unknown> & {
          name: string;
          availability_date: string | null;
        })
      | undefined;
    if (!existing) throw notFound('Candidate not found');

    db.prepare(
      `UPDATE recruitment_candidates SET name = ?, email = ?, phone = ?, linkedin_profile = ?,
         degree = ?, source = ?, availability_date = ?, notes = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      req.body?.name === undefined ? existing.name : requireString(req.body.name, 'Name', 200),
      req.body?.email === undefined
        ? (existing.email as string | null)
        : optionalString(req.body.email, 'Email', 200),
      req.body?.phone === undefined
        ? (existing.phone as string | null)
        : optionalString(req.body.phone, 'Phone', 50),
      req.body?.linkedinProfile === undefined
        ? (existing.linkedin_profile as string | null)
        : optionalString(req.body.linkedinProfile, 'LinkedIn profile', 300),
      req.body?.degree === undefined
        ? (existing.degree as string | null)
        : optionalString(req.body.degree, 'Degree', 200),
      req.body?.source === undefined
        ? (existing.source as string | null)
        : optionalString(req.body.source, 'Source', 100),
      req.body?.availabilityDate === undefined
        ? existing.availability_date
        : optionalDate(req.body.availabilityDate, 'Availability date'),
      req.body?.notes === undefined
        ? (existing.notes as string | null)
        : optionalString(req.body.notes, 'Notes', 5000),
      id,
    );
    recordAudit(req.user!.id, 'update', 'recruitment_candidate', id);
    res.json({
      candidate: db.prepare('SELECT * FROM recruitment_candidates WHERE id = ?').get(id),
    });
  }),
);

recruitmentRouter.delete(
  '/candidates/:id',
  requirePermission('recruitment.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb().prepare('DELETE FROM recruitment_candidates WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('Candidate not found');
    recordAudit(req.user!.id, 'delete', 'recruitment_candidate', id);
    res.json({ ok: true });
  }),
);

// Applicants
recruitmentRouter.get(
  '/applicants',
  requirePermission('recruitment.view'),
  asyncHandler(async (req, res) => {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (req.query.jobId) {
      where.push('a.job_id = ?');
      params.push(Number(req.query.jobId));
    }
    if (req.query.stageId) {
      where.push('a.stage_id = ?');
      params.push(Number(req.query.stageId));
    }
    if (typeof req.query.status === 'string' && req.query.status !== 'all') {
      where.push('a.status = ?');
      params.push(req.query.status);
    }
    const applicants = getDb()
      .prepare(
        `${APPLICANT_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT 300`,
      )
      .all(...params);
    res.json({ applicants });
  }),
);

recruitmentRouter.post(
  '/applicants',
  requirePermission('recruitment.manage'),
  asyncHandler(async (req, res) => {
    const jobId = requireInt(req.body?.jobId, 'Job', 1);
    const candidateId = requireInt(req.body?.candidateId, 'Candidate', 1);
    const db = getDb();
    if (!db.prepare('SELECT id FROM recruitment_jobs WHERE id = ?').get(jobId)) {
      throw notFound('Job not found');
    }
    if (!db.prepare('SELECT id FROM recruitment_candidates WHERE id = ?').get(candidateId)) {
      throw notFound('Candidate not found');
    }
    if (
      db
        .prepare('SELECT id FROM recruitment_applicants WHERE job_id = ? AND candidate_id = ?')
        .get(jobId, candidateId)
    ) {
      throw new ValidationError('That candidate has already applied for this job');
    }

    const result = db
      .prepare(
        `INSERT INTO recruitment_applicants
           (job_id, candidate_id, stage_id, applied_at, salary_expected_cents, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        jobId,
        candidateId,
        optionalInt(req.body?.stageId, 'Stage', 1) ?? defaultStageId(),
        optionalDate(req.body?.appliedAt, 'Applied date') ?? new Date().toISOString().slice(0, 10),
        optionalCents(req.body?.salaryExpectedCents, 'Expected salary') ?? 0,
        optionalString(req.body?.notes, 'Notes', 5000),
      );
    const id = Number(result.lastInsertRowid);
    recordAudit(req.user!.id, 'create', 'recruitment_applicant', id);
    res.status(201).json({ applicant: db.prepare(`${APPLICANT_SELECT} WHERE a.id = ?`).get(id) });
  }),
);

recruitmentRouter.put(
  '/applicants/:id',
  requirePermission('recruitment.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM recruitment_applicants WHERE id = ?').get(id) as
      | (Record<string, unknown> & {
          status: string;
          stage_id: number;
          applied_at: string;
        })
      | undefined;
    if (!existing) throw notFound('Applicant not found');

    const status =
      req.body?.status === undefined
        ? existing.status
        : requireEnum(req.body.status, 'Status', APPLICANT_STATUSES);
    const stageId =
      req.body?.stageId === undefined
        ? existing.stage_id
        : requireInt(req.body.stageId, 'Stage', 1);
    if (!db.prepare('SELECT id FROM recruitment_stages WHERE id = ?').get(stageId)) {
      throw new ValidationError('Stage not found');
    }

    const closedAt =
      status === 'active'
        ? null
        : (optionalDate(req.body?.closedAt, 'Closed date') ??
          new Date().toISOString().slice(0, 10));

    db.transaction(() => {
      db.prepare(
        `UPDATE recruitment_applicants SET stage_id = ?, status = ?, salary_expected_cents = ?,
           notes = ?, refuse_reason = ?, closed_at = ?, updated_at = datetime('now')
         WHERE id = ?`,
      ).run(
        stageId,
        status,
        req.body?.salaryExpectedCents === undefined
          ? existing.salary_expected_cents
          : (optionalCents(req.body.salaryExpectedCents, 'Expected salary') ?? 0),
        req.body?.notes === undefined
          ? (existing.notes as string | null)
          : optionalString(req.body.notes, 'Notes', 5000),
        req.body?.refuseReason === undefined
          ? (existing.refuse_reason as string | null)
          : optionalString(req.body.refuseReason, 'Refusal reason', 1000),
        closedAt,
        id,
      );

      if (status === 'hired') ensureEmployee(id);
    })();
    recordAudit(req.user!.id, `status:${status}`, 'recruitment_applicant', id);
    res.json({ applicant: db.prepare(`${APPLICANT_SELECT} WHERE a.id = ?`).get(id) });
  }),
);

/** Moves an applicant to the hired stage and creates the employee record. */
recruitmentRouter.post(
  '/applicants/:id/hire',
  requirePermission('recruitment.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db
      .prepare('SELECT status, employee_id FROM recruitment_applicants WHERE id = ?')
      .get(id) as { status: string; employee_id: number | null } | undefined;
    if (!existing) throw notFound('Applicant not found');
    if (existing.status === 'hired' && existing.employee_id) {
      throw new ValidationError('Applicant is already hired');
    }

    const stageId = hiredStageId();
    if (stageId === null) throw new ValidationError('No hired stage is configured');
    const employeeId = db.transaction(() => {
      db.prepare(
        `UPDATE recruitment_applicants SET stage_id = ?, status = 'hired', closed_at = ?,
           updated_at = datetime('now') WHERE id = ?`,
      ).run(stageId, new Date().toISOString().slice(0, 10), id);
      return ensureEmployee(id);
    })();
    recordAudit(req.user!.id, 'hire', 'recruitment_applicant', id, { employeeId });
    res.json({ applicant: db.prepare(`${APPLICANT_SELECT} WHERE a.id = ?`).get(id) });
  }),
);

recruitmentRouter.delete(
  '/applicants/:id',
  requirePermission('recruitment.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb().prepare('DELETE FROM recruitment_applicants WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('Applicant not found');
    recordAudit(req.user!.id, 'delete', 'recruitment_applicant', id);
    res.json({ ok: true });
  }),
);
