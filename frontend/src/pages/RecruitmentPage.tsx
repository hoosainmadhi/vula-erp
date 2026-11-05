import { useState, type FormEvent } from 'react';
import { Briefcase, Pencil, Plus, Search, Trash2, UserCheck, UserPlus, Users } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../lib/useFetch';
import { money, shortDate, titleCase, today } from '../lib/format';
import {
  Badge,
  btnGhost,
  btnPrimary,
  btnSecondary,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  inputCls,
  Modal,
  PageHeader,
  Spinner,
  tdCls,
  thCls,
} from '../components/ui';
import type {
  Department,
  RecruitmentApplicant,
  RecruitmentCandidate,
  RecruitmentJob,
  RecruitmentStage,
} from '../types';

type Tab = 'jobs' | 'candidates' | 'applicants';

const JOB_STATUSES = ['draft', 'open', 'on_hold', 'closed'] as const;
const EMPLOYMENT_TYPES = ['permanent', 'contract', 'part_time', 'intern'] as const;

interface Recruiter {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}

function JobForm({
  job,
  departments,
  recruiters,
  onSaved,
  onClose,
}: {
  job: RecruitmentJob | null;
  departments: Department[];
  recruiters: Recruiter[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(job?.title ?? '');
  const [departmentId, setDepartmentId] = useState(String(job?.department_id ?? ''));
  const [location, setLocation] = useState(job?.location ?? '');
  const [employmentType, setEmploymentType] = useState(job?.employment_type ?? 'permanent');
  const [openings, setOpenings] = useState(String(job?.openings ?? 1));
  const [salaryMin, setSalaryMin] = useState(((job?.salary_min_cents ?? 0) / 100).toFixed(2));
  const [salaryMax, setSalaryMax] = useState(((job?.salary_max_cents ?? 0) / 100).toFixed(2));
  const [status, setStatus] = useState<string>(job?.status ?? 'draft');
  const [recruiterId, setRecruiterId] = useState(String(job?.recruiter_id ?? ''));
  const [postedAt, setPostedAt] = useState(job?.posted_at ?? '');
  const [closesAt, setClosesAt] = useState(job?.closes_at ?? '');
  const [description, setDescription] = useState(job?.description ?? '');
  const [requirements, setRequirements] = useState(job?.requirements ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        title,
        departmentId: departmentId ? Number(departmentId) : null,
        location: location || null,
        employmentType,
        openings: Number(openings) || 1,
        salaryMinCents: Math.round((Number(salaryMin) || 0) * 100),
        salaryMaxCents: Math.round((Number(salaryMax) || 0) * 100),
        status,
        recruiterId: recruiterId ? Number(recruiterId) : null,
        postedAt: postedAt || null,
        closesAt: closesAt || null,
        description: description || null,
        requirements: requirements || null,
      };
      if (job) await api.put(`/recruitment/jobs/${job.id}`, body);
      else await api.post('/recruitment/jobs', body);
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {error ? <ErrorBox message={error} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Job title">
          <input
            className={inputCls}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </Field>
        <Field label="Department">
          <select
            className={inputCls}
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">Unassigned</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Location">
          <input
            className={inputCls}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
        </Field>
        <Field label="Employment type">
          <select
            className={inputCls}
            value={employmentType}
            onChange={(event) => setEmploymentType(event.target.value)}
          >
            {EMPLOYMENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Openings">
          <input
            className={inputCls}
            type="number"
            min={1}
            value={openings}
            onChange={(event) => setOpenings(event.target.value)}
          />
        </Field>
        <Field label="Status">
          <select
            className={inputCls}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {JOB_STATUSES.map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Minimum salary (R)">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.01"
            value={salaryMin}
            onChange={(event) => setSalaryMin(event.target.value)}
          />
        </Field>
        <Field label="Maximum salary (R)">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.01"
            value={salaryMax}
            onChange={(event) => setSalaryMax(event.target.value)}
          />
        </Field>
        <Field label="Recruiter">
          <select
            className={inputCls}
            value={recruiterId}
            onChange={(event) => setRecruiterId(event.target.value)}
          >
            <option value="">Unassigned</option>
            {recruiters.map((recruiter) => (
              <option key={recruiter.id} value={recruiter.id}>
                {recruiter.first_name} {recruiter.last_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Posted on">
          <input
            className={inputCls}
            type="date"
            value={postedAt}
            onChange={(event) => setPostedAt(event.target.value)}
          />
        </Field>
        <Field label="Closes on">
          <input
            className={inputCls}
            type="date"
            value={closesAt}
            onChange={(event) => setClosesAt(event.target.value)}
          />
        </Field>
      </div>
      <Field label="Description">
        <textarea
          className={inputCls}
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <Field label="Requirements">
        <textarea
          className={inputCls}
          rows={2}
          value={requirements}
          onChange={(event) => setRequirements(event.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : job ? 'Save changes' : 'Create job'}
        </button>
      </div>
    </form>
  );
}

function CandidateForm({
  candidate,
  onSaved,
  onClose,
}: {
  candidate: RecruitmentCandidate | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(candidate?.name ?? '');
  const [email, setEmail] = useState(candidate?.email ?? '');
  const [phone, setPhone] = useState(candidate?.phone ?? '');
  const [linkedinProfile, setLinkedinProfile] = useState(candidate?.linkedin_profile ?? '');
  const [degree, setDegree] = useState(candidate?.degree ?? '');
  const [source, setSource] = useState(candidate?.source ?? '');
  const [availabilityDate, setAvailabilityDate] = useState(candidate?.availability_date ?? '');
  const [notes, setNotes] = useState(candidate?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        name,
        email: email || null,
        phone: phone || null,
        linkedinProfile: linkedinProfile || null,
        degree: degree || null,
        source: source || null,
        availabilityDate: availabilityDate || null,
        notes: notes || null,
      };
      if (candidate) await api.put(`/recruitment/candidates/${candidate.id}`, body);
      else await api.post('/recruitment/candidates', body);
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {error ? <ErrorBox message={error} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name">
          <input
            className={inputCls}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Field>
        <Field label="Email">
          <input
            className={inputCls}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="Phone">
          <input
            className={inputCls}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </Field>
        <Field label="Degree">
          <input
            className={inputCls}
            value={degree}
            onChange={(event) => setDegree(event.target.value)}
          />
        </Field>
        <Field label="LinkedIn profile">
          <input
            className={inputCls}
            value={linkedinProfile}
            onChange={(event) => setLinkedinProfile(event.target.value)}
          />
        </Field>
        <Field label="Source">
          <input
            className={inputCls}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="Referral, job board, careers page…"
          />
        </Field>
        <Field label="Available from">
          <input
            className={inputCls}
            type="date"
            value={availabilityDate}
            onChange={(event) => setAvailabilityDate(event.target.value)}
          />
        </Field>
      </div>
      <Field label="Notes">
        <textarea
          className={inputCls}
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : candidate ? 'Save changes' : 'Add candidate'}
        </button>
      </div>
    </form>
  );
}

function ApplicantForm({
  jobs,
  candidates,
  stages,
  onSaved,
  onClose,
}: {
  jobs: RecruitmentJob[];
  candidates: RecruitmentCandidate[];
  stages: RecruitmentStage[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [jobId, setJobId] = useState(String(jobs[0]?.id ?? ''));
  const [candidateId, setCandidateId] = useState(String(candidates[0]?.id ?? ''));
  const [stageId, setStageId] = useState(String(stages[0]?.id ?? ''));
  const [appliedAt, setAppliedAt] = useState(today());
  const [salaryExpected, setSalaryExpected] = useState('0.00');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/recruitment/applicants', {
        jobId: Number(jobId),
        candidateId: Number(candidateId),
        stageId: stageId ? Number(stageId) : null,
        appliedAt,
        salaryExpectedCents: Math.round((Number(salaryExpected) || 0) * 100),
        notes: notes || null,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {error ? <ErrorBox message={error} /> : null}
      <Field label="Job">
        <select
          className={inputCls}
          value={jobId}
          onChange={(event) => setJobId(event.target.value)}
          required
        >
          <option value="">Select a job…</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.number} — {job.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Candidate">
        <select
          className={inputCls}
          value={candidateId}
          onChange={(event) => setCandidateId(event.target.value)}
          required
        >
          <option value="">Select a candidate…</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
              {candidate.email ? ` · ${candidate.email}` : ''}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Stage">
          <select
            className={inputCls}
            value={stageId}
            onChange={(event) => setStageId(event.target.value)}
          >
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Applied on">
          <input
            className={inputCls}
            type="date"
            value={appliedAt}
            onChange={(event) => setAppliedAt(event.target.value)}
          />
        </Field>
        <Field label="Expected salary (R)">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.01"
            value={salaryExpected}
            onChange={(event) => setSalaryExpected(event.target.value)}
          />
        </Field>
      </div>
      <Field label="Notes">
        <textarea
          className={inputCls}
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : 'Add applicant'}
        </button>
      </div>
    </form>
  );
}

export default function RecruitmentPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('jobs');
  const [jobStatus, setJobStatus] = useState('all');
  const [applicantJob, setApplicantJob] = useState('all');
  const [applicantStage, setApplicantStage] = useState('all');
  const [candidateQuery, setCandidateQuery] = useState('');
  const [jobModal, setJobModal] = useState<RecruitmentJob | 'new' | null>(null);
  const [candidateModal, setCandidateModal] = useState<RecruitmentCandidate | 'new' | null>(null);
  const [applicantModal, setApplicantModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const jobParams = new URLSearchParams();
  if (jobStatus !== 'all') jobParams.set('status', jobStatus);

  const applicantParams = new URLSearchParams();
  if (applicantJob !== 'all') applicantParams.set('jobId', applicantJob);
  if (applicantStage !== 'all') applicantParams.set('stageId', applicantStage);

  const jobs = useFetch<{ jobs: RecruitmentJob[] }>(`/recruitment/jobs?${jobParams}`, [jobStatus]);
  const allJobs = useFetch<{ jobs: RecruitmentJob[] }>('/recruitment/jobs');
  const candidates = useFetch<{ candidates: RecruitmentCandidate[] }>(
    `/recruitment/candidates?${new URLSearchParams(candidateQuery ? { q: candidateQuery } : {})}`,
    [candidateQuery],
  );
  const applicants = useFetch<{ applicants: RecruitmentApplicant[] }>(
    `/recruitment/applicants?${applicantParams}`,
    [applicantJob, applicantStage],
  );
  const stages = useFetch<{ stages: RecruitmentStage[] }>('/recruitment/stages');
  const options = useFetch<{ departments: Department[]; recruiters: Recruiter[] }>(
    '/recruitment/options',
  );

  const reloadAll = () => {
    jobs.reload();
    allJobs.reload();
    applicants.reload();
    candidates.reload();
  };

  const removeJob = async (job: RecruitmentJob) => {
    if (!window.confirm(`Delete job ${job.number} and all its applications?`)) return;
    setError(null);
    try {
      await api.del(`/recruitment/jobs/${job.id}`);
      reloadAll();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const removeCandidate = async (candidate: RecruitmentCandidate) => {
    if (!window.confirm(`Delete candidate “${candidate.name}” and their applications?`)) return;
    setError(null);
    try {
      await api.del(`/recruitment/candidates/${candidate.id}`);
      reloadAll();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const removeApplicant = async (applicant: RecruitmentApplicant) => {
    if (!window.confirm(`Remove ${applicant.candidate_name} from ${applicant.job_title}?`)) return;
    setError(null);
    try {
      await api.del(`/recruitment/applicants/${applicant.id}`);
      reloadAll();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const moveStage = async (applicant: RecruitmentApplicant, stageId: number) => {
    setError(null);
    try {
      await api.put(`/recruitment/applicants/${applicant.id}`, { stageId });
      reloadAll();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const hire = async (applicant: RecruitmentApplicant) => {
    if (
      !window.confirm(
        `Hire ${applicant.candidate_name} for ${applicant.job_title}? An employee record will be created.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await api.post(`/recruitment/applicants/${applicant.id}/hire`);
      reloadAll();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const jobRows = jobs.data?.jobs ?? [];
  const allJobRows = allJobs.data?.jobs ?? [];
  const candidateRows = candidates.data?.candidates ?? [];
  const applicantRows = applicants.data?.applicants ?? [];
  const stageRows = stages.data?.stages ?? [];
  const departments = options.data?.departments ?? [];
  const recruiters = options.data?.recruiters ?? [];

  return (
    <>
      <PageHeader
        title="Recruitment"
        subtitle="Job openings, candidates and the hiring pipeline"
        actions={
          can('recruitment.manage') ? (
            tab === 'jobs' ? (
              <button type="button" className={btnPrimary} onClick={() => setJobModal('new')}>
                <Plus className="size-4" /> New job
              </button>
            ) : tab === 'candidates' ? (
              <button type="button" className={btnPrimary} onClick={() => setCandidateModal('new')}>
                <UserPlus className="size-4" /> New candidate
              </button>
            ) : (
              <button type="button" className={btnPrimary} onClick={() => setApplicantModal(true)}>
                <Plus className="size-4" /> New application
              </button>
            )
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {(
            [
              ['jobs', 'Jobs'],
              ['candidates', 'Candidates'],
              ['applicants', 'Applications'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === value ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'jobs' ? (
          <select
            className={`${inputCls} w-auto`}
            value={jobStatus}
            onChange={(event) => setJobStatus(event.target.value)}
          >
            <option value="all">All job statuses</option>
            {JOB_STATUSES.map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </select>
        ) : null}

        {tab === 'candidates' ? (
          <div className="relative min-w-56 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
            <input
              className={`${inputCls} pl-9`}
              placeholder="Search candidates…"
              value={candidateQuery}
              onChange={(event) => setCandidateQuery(event.target.value)}
            />
          </div>
        ) : null}

        {tab === 'applicants' ? (
          <>
            <select
              className={`${inputCls} w-auto`}
              value={applicantJob}
              onChange={(event) => setApplicantJob(event.target.value)}
            >
              <option value="all">All jobs</option>
              {allJobRows.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.number} — {job.title}
                </option>
              ))}
            </select>
            <select
              className={`${inputCls} w-auto`}
              value={applicantStage}
              onChange={(event) => setApplicantStage(event.target.value)}
            >
              <option value="all">All stages</option>
              {stageRows.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {tab === 'jobs' ? (
        jobs.loading && !jobs.data ? (
          <Spinner />
        ) : jobs.error ? (
          <ErrorBox message={jobs.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Number</th>
                  <th className={thCls}>Job</th>
                  <th className={thCls}>Department</th>
                  <th className={thCls}>Type</th>
                  <th className={thCls}>Status</th>
                  <th className={`${thCls} text-right`}>Openings</th>
                  <th className={`${thCls} text-right`}>Applicants</th>
                  <th className={`${thCls} text-right`}>Salary range</th>
                  <th className={thCls}>Closes</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {jobRows.length === 0 ? (
                  <EmptyState colSpan={10} message="No job openings yet." />
                ) : (
                  jobRows.map((job) => (
                    <tr key={job.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-mono text-xs`}>{job.number}</td>
                      <td className={tdCls}>
                        <p className="font-semibold text-slate-800">{job.title}</p>
                        <p className="text-xs text-slate-400">{job.location ?? '—'}</p>
                      </td>
                      <td className={tdCls}>{job.department_name ?? '—'}</td>
                      <td className={tdCls}>{titleCase(job.employment_type)}</td>
                      <td className={tdCls}>
                        <Badge value={job.status} />
                      </td>
                      <td className={`${tdCls} text-right`}>{job.openings}</td>
                      <td className={`${tdCls} text-right`}>
                        <span className="font-semibold">{job.applicant_count}</span>
                        {job.hired_count > 0 ? (
                          <span className="text-xs text-emerald-600">
                            {' '}
                            · {job.hired_count} hired
                          </span>
                        ) : null}
                      </td>
                      <td className={`${tdCls} text-right`}>
                        {job.salary_min_cents || job.salary_max_cents
                          ? `${money(job.salary_min_cents)} – ${money(job.salary_max_cents)}`
                          : '—'}
                      </td>
                      <td className={tdCls}>{shortDate(job.closes_at)}</td>
                      <td className={tdCls}>
                        <div className="flex justify-end gap-1">
                          {can('recruitment.manage') ? (
                            <>
                              <button
                                type="button"
                                className={btnGhost}
                                onClick={() => setJobModal(job)}
                              >
                                <Pencil className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                className={btnGhost}
                                onClick={() => void removeJob(job)}
                              >
                                <Trash2 className="size-3.5 text-red-500" />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === 'candidates' ? (
        candidates.loading && !candidates.data ? (
          <Spinner />
        ) : candidates.error ? (
          <ErrorBox message={candidates.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Candidate</th>
                  <th className={thCls}>Contact</th>
                  <th className={thCls}>Degree</th>
                  <th className={thCls}>Source</th>
                  <th className={thCls}>Available</th>
                  <th className={`${thCls} text-right`}>Applications</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {candidateRows.length === 0 ? (
                  <EmptyState colSpan={7} message="No candidates yet." />
                ) : (
                  candidateRows.map((candidate) => (
                    <tr key={candidate.id} className="hover:bg-slate-50">
                      <td className={tdCls}>
                        <p className="font-semibold text-slate-800">{candidate.name}</p>
                        {candidate.linkedin_profile ? (
                          <p className="max-w-56 truncate text-xs text-slate-400">
                            {candidate.linkedin_profile}
                          </p>
                        ) : null}
                      </td>
                      <td className={tdCls}>
                        {candidate.email ?? '—'}
                        {candidate.phone ? (
                          <p className="text-xs text-slate-400">{candidate.phone}</p>
                        ) : null}
                      </td>
                      <td className={tdCls}>{candidate.degree ?? '—'}</td>
                      <td className={tdCls}>{candidate.source ?? '—'}</td>
                      <td className={tdCls}>{shortDate(candidate.availability_date)}</td>
                      <td className={`${tdCls} text-right font-semibold`}>
                        {candidate.application_count ?? 0}
                      </td>
                      <td className={tdCls}>
                        <div className="flex justify-end gap-1">
                          {can('recruitment.manage') ? (
                            <>
                              <button
                                type="button"
                                className={btnGhost}
                                onClick={() => setCandidateModal(candidate)}
                              >
                                <Pencil className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                className={btnGhost}
                                onClick={() => void removeCandidate(candidate)}
                              >
                                <Trash2 className="size-3.5 text-red-500" />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === 'applicants' ? (
        applicants.loading && !applicants.data ? (
          <Spinner />
        ) : applicants.error ? (
          <ErrorBox message={applicants.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Candidate</th>
                  <th className={thCls}>Job</th>
                  <th className={thCls}>Stage</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Applied</th>
                  <th className={`${thCls} text-right`}>Expected</th>
                  <th className={thCls}>Employee</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {applicantRows.length === 0 ? (
                  <EmptyState colSpan={8} message="No applications yet." />
                ) : (
                  applicantRows.map((applicant) => (
                    <tr key={applicant.id} className="hover:bg-slate-50">
                      <td className={tdCls}>
                        <p className="font-semibold text-slate-800">{applicant.candidate_name}</p>
                        <p className="text-xs text-slate-400">{applicant.candidate_email ?? '—'}</p>
                      </td>
                      <td className={tdCls}>
                        <p>{applicant.job_title}</p>
                        <p className="font-mono text-xs text-slate-400">{applicant.job_number}</p>
                      </td>
                      <td className={tdCls}>
                        {can('recruitment.manage') && applicant.status === 'active' ? (
                          <select
                            className={`${inputCls} w-auto py-1 text-xs`}
                            value={applicant.stage_id}
                            onChange={(event) =>
                              void moveStage(applicant, Number(event.target.value))
                            }
                          >
                            {stageRows.map((stage) => (
                              <option key={stage.id} value={stage.id}>
                                {stage.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          applicant.stage_name
                        )}
                      </td>
                      <td className={tdCls}>
                        <Badge value={applicant.status} />
                      </td>
                      <td className={tdCls}>{shortDate(applicant.applied_at)}</td>
                      <td className={`${tdCls} text-right`}>
                        {money(applicant.salary_expected_cents)}
                      </td>
                      <td className={tdCls}>
                        {applicant.hired_employee_number ? (
                          <span className="font-mono text-xs text-emerald-700">
                            {applicant.hired_employee_number}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={tdCls}>
                        <div className="flex justify-end gap-1">
                          {can('recruitment.manage') &&
                          (applicant.status === 'active' ||
                            (applicant.status === 'hired' && !applicant.employee_id)) ? (
                            <>
                              <button
                                type="button"
                                className={btnGhost}
                                onClick={() => void hire(applicant)}
                              >
                                <UserCheck className="size-3.5" /> Hire
                              </button>
                              <button
                                type="button"
                                className={btnGhost}
                                onClick={() => void removeApplicant(applicant)}
                              >
                                <Trash2 className="size-3.5 text-red-500" />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === 'jobs' ? (
        <Card className="mt-4 flex items-center gap-3 p-4 text-sm text-slate-600">
          <Briefcase className="size-4 text-emerald-600" />
          <span>
            Job openings appear here once created. Applications are tracked per candidate in the
            Applications tab.
          </span>
        </Card>
      ) : null}

      {tab === 'candidates' ? (
        <Card className="mt-4 flex items-center gap-3 p-4 text-sm text-slate-600">
          <Users className="size-4 text-emerald-600" />
          <span>
            Candidates are reusable across jobs — add one here, then attach them to a job from the
            Applications tab.
          </span>
        </Card>
      ) : null}

      {jobModal ? (
        <Modal
          title={jobModal === 'new' ? 'New job opening' : `Edit ${jobModal.number}`}
          onClose={() => setJobModal(null)}
          wide
        >
          <JobForm
            job={jobModal === 'new' ? null : jobModal}
            departments={departments}
            recruiters={recruiters}
            onSaved={reloadAll}
            onClose={() => setJobModal(null)}
          />
        </Modal>
      ) : null}

      {candidateModal ? (
        <Modal
          title={candidateModal === 'new' ? 'New candidate' : 'Edit candidate'}
          onClose={() => setCandidateModal(null)}
          wide
        >
          <CandidateForm
            candidate={candidateModal === 'new' ? null : candidateModal}
            onSaved={reloadAll}
            onClose={() => setCandidateModal(null)}
          />
        </Modal>
      ) : null}

      {applicantModal ? (
        <Modal title="New application" onClose={() => setApplicantModal(false)}>
          <ApplicantForm
            jobs={allJobRows}
            candidates={candidateRows}
            stages={stageRows}
            onSaved={reloadAll}
            onClose={() => setApplicantModal(false)}
          />
        </Modal>
      ) : null}
    </>
  );
}
