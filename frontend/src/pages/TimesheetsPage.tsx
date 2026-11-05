import { useState, type FormEvent } from 'react';
import { Clock, Plus } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../lib/useFetch';
import { monthEnd, monthStart, shortDate, titleCase, today } from '../lib/format';
import {
  Badge,
  btnGhost,
  btnPrimary,
  btnSecondary,
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
import type { EmployeeOption, Timesheet } from '../types';

const STATUSES = ['draft', 'submitted', 'approved', 'rejected'] as const;

interface ProjectOption {
  id: number;
  code: string;
  name: string;
}

function TimesheetForm({
  timesheet,
  employees,
  projects,
  onSaved,
  onClose,
}: {
  timesheet: Timesheet | null;
  employees: EmployeeOption[];
  projects: ProjectOption[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [employeeId, setEmployeeId] = useState(
    String(timesheet?.employee_id ?? employees[0]?.id ?? ''),
  );
  const [projectId, setProjectId] = useState(String(timesheet?.project_id ?? ''));
  const [workDate, setWorkDate] = useState(timesheet?.work_date ?? today());
  const [hours, setHours] = useState(String(timesheet?.hours ?? 8));
  const [task, setTask] = useState(timesheet?.task ?? '');
  const [notes, setNotes] = useState(timesheet?.notes ?? '');
  const [billable, setBillable] = useState(timesheet ? timesheet.billable === 1 : true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        employeeId: Number(employeeId),
        projectId: projectId ? Number(projectId) : null,
        workDate,
        hours: Number(hours),
        task: task || null,
        notes: notes || null,
        billable,
      };
      if (timesheet) await api.put(`/timesheets/${timesheet.id}`, body);
      else await api.post('/timesheets', body);
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
        <Field label="Employee">
          <select
            className={inputCls}
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            required
          >
            <option value="">Select an employee…</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.employee_number} — {employee.first_name} {employee.last_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Project">
          <select
            className={inputCls}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} — {project.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Work date">
          <input
            className={inputCls}
            type="date"
            value={workDate}
            onChange={(event) => setWorkDate(event.target.value)}
            required
          />
        </Field>
        <Field label="Hours">
          <input
            className={inputCls}
            type="number"
            min={0.25}
            max={24}
            step="0.25"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
            required
          />
        </Field>
      </div>
      <Field label="Task">
        <input
          className={inputCls}
          value={task}
          onChange={(event) => setTask(event.target.value)}
          placeholder="What did you work on?"
        />
      </Field>
      <Field label="Notes">
        <textarea
          className={inputCls}
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={billable}
          onChange={(event) => setBillable(event.target.checked)}
          className="size-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
        />
        Billable
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : timesheet ? 'Save changes' : 'Add entry'}
        </button>
      </div>
    </form>
  );
}

export default function TimesheetsPage() {
  const { can } = useAuth();
  const [employeeId, setEmployeeId] = useState('');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const [modal, setModal] = useState<Timesheet | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (employeeId) params.set('employeeId', employeeId);
  if (status !== 'all') params.set('status', status);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const timesheets = useFetch<{ timesheets: Timesheet[] }>(`/timesheets?${params}`, [
    employeeId,
    status,
    from,
    to,
  ]);
  const employees = useFetch<{ employees: EmployeeOption[] }>('/timesheets/employees');
  const projects = useFetch<{ projects: ProjectOption[] }>('/timesheets/projects');

  const act = async (timesheet: Timesheet, action: 'submit' | 'approve' | 'reject') => {
    setError(null);
    try {
      await api.post(`/timesheets/${timesheet.id}/${action}`);
      timesheets.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = async (timesheet: Timesheet) => {
    if (!window.confirm(`Delete the ${timesheet.hours}h entry for ${timesheet.work_date}?`)) return;
    setError(null);
    try {
      await api.del(`/timesheets/${timesheet.id}`);
      timesheets.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const rows = timesheets.data?.timesheets ?? [];
  const totalHours = rows.reduce((sum, row) => sum + row.hours, 0);
  const billableHours = rows.reduce((sum, row) => sum + (row.billable === 1 ? row.hours : 0), 0);

  return (
    <>
      <PageHeader
        title="Timesheets"
        subtitle="Hours booked against employees and projects"
        actions={
          can('hr.manage') ? (
            <button type="button" className={btnPrimary} onClick={() => setModal('new')}>
              <Plus className="size-4" /> New entry
            </button>
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <select
          className={`${inputCls} w-auto`}
          value={employeeId}
          onChange={(event) => setEmployeeId(event.target.value)}
        >
          <option value="">All employees</option>
          {(employees.data?.employees ?? []).map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.first_name} {employee.last_name}
            </option>
          ))}
        </select>
        <select
          className={`${inputCls} w-auto`}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">All statuses</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {titleCase(value)}
            </option>
          ))}
        </select>
        <input
          className={`${inputCls} w-auto`}
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <input
          className={`${inputCls} w-auto`}
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
        <div className="ml-auto flex items-center gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-4 text-emerald-600" />
            <span className="font-semibold text-slate-900">{totalHours}</span> h
          </span>
          <span>
            <span className="font-semibold text-slate-900">{billableHours}</span> h billable
          </span>
          <span>
            <span className="font-semibold text-slate-900">{rows.length}</span> entries
          </span>
        </div>
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {timesheets.loading && !timesheets.data ? (
        <Spinner />
      ) : timesheets.error ? (
        <ErrorBox message={timesheets.error} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr>
                <th className={thCls}>Date</th>
                <th className={thCls}>Employee</th>
                <th className={thCls}>Project</th>
                <th className={thCls}>Task</th>
                <th className={`${thCls} text-right`}>Hours</th>
                <th className={thCls}>Billable</th>
                <th className={thCls}>Status</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyState colSpan={8} message="No timesheet entries in this period." />
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className={tdCls}>{shortDate(row.work_date)}</td>
                    <td className={tdCls}>
                      <p className="font-semibold text-slate-800">{row.employee_name}</p>
                      <p className="font-mono text-xs text-slate-400">{row.employee_number}</p>
                    </td>
                    <td className={tdCls}>
                      {row.project_code ? (
                        <>
                          <p className="font-mono text-xs text-slate-400">{row.project_code}</p>
                          <p>{row.project_name}</p>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={`${tdCls} max-w-56 truncate text-slate-500`}>
                      {row.task ?? '—'}
                    </td>
                    <td className={`${tdCls} text-right font-semibold`}>{row.hours}</td>
                    <td className={tdCls}>{row.billable === 1 ? 'Yes' : 'No'}</td>
                    <td className={tdCls}>
                      <Badge value={row.status} />
                    </td>
                    <td className={tdCls}>
                      <div className="flex justify-end gap-1">
                        {can('hr.manage') ? (
                          <>
                            {row.status === 'draft' || row.status === 'rejected' ? (
                              <>
                                <button
                                  type="button"
                                  className={btnGhost}
                                  onClick={() => setModal(row)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className={btnGhost}
                                  onClick={() => void act(row, 'submit')}
                                >
                                  Submit
                                </button>
                                <button
                                  type="button"
                                  className={`${btnGhost} text-red-600`}
                                  onClick={() => void remove(row)}
                                >
                                  Delete
                                </button>
                              </>
                            ) : null}
                            {row.status === 'submitted' ? (
                              <>
                                <button
                                  type="button"
                                  className={btnGhost}
                                  onClick={() => void act(row, 'approve')}
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  className={`${btnGhost} text-red-600`}
                                  onClick={() => void act(row, 'reject')}
                                >
                                  Reject
                                </button>
                              </>
                            ) : null}
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
      )}

      {modal ? (
        <Modal
          title={modal === 'new' ? 'New timesheet entry' : 'Edit timesheet entry'}
          onClose={() => setModal(null)}
        >
          <TimesheetForm
            timesheet={modal === 'new' ? null : modal}
            employees={employees.data?.employees ?? []}
            projects={projects.data?.projects ?? []}
            onSaved={timesheets.reload}
            onClose={() => setModal(null)}
          />
        </Modal>
      ) : null}
    </>
  );
}
