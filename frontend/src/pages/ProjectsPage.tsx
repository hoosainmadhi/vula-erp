import { useState, type FormEvent } from 'react';
import { FolderKanban, ListChecks, Plus, Search } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../lib/useFetch';
import { money, shortDate, titleCase } from '../lib/format';
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
import type { EmployeeOption, Project, ProjectTask } from '../types';

const PROJECT_STATUSES = ['planned', 'active', 'on_hold', 'completed', 'cancelled'] as const;
const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done'] as const;
const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

interface UserOption {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}

function ProjectForm({
  project,
  users,
  onSaved,
  onClose,
}: {
  project: Project | null;
  users: UserOption[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState(project?.code ?? '');
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [status, setStatus] = useState<string>(project?.status ?? 'planned');
  const [managerId, setManagerId] = useState(String(project?.manager_id ?? ''));
  const [startDate, setStartDate] = useState(project?.start_date ?? '');
  const [endDate, setEndDate] = useState(project?.end_date ?? '');
  const [budget, setBudget] = useState(((project?.budget_cents ?? 0) / 100).toFixed(2));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        code: code || null,
        name,
        description: description || null,
        status,
        managerId: managerId ? Number(managerId) : null,
        startDate: startDate || null,
        endDate: endDate || null,
        budgetCents: Math.round((Number(budget) || 0) * 100),
      };
      if (project) await api.put(`/projects/${project.id}`, body);
      else await api.post('/projects', body);
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
        <Field label="Code" hint="Leave blank to generate one">
          <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label="Status">
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            {PROJECT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Name">
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Field>
      <Field label="Description">
        <textarea
          className={inputCls}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Start date">
          <input
            className={inputCls}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Field>
        <Field label="End date">
          <input
            className={inputCls}
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </Field>
        <Field label="Budget (R)">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.01"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </Field>
        {users.length > 0 ? (
          <Field label="Manager">
            <select
              className={inputCls}
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.first_name} {user.last_name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : project ? 'Save changes' : 'Create project'}
        </button>
      </div>
    </form>
  );
}

function ProjectDetail({
  projectId,
  canManage,
  employees,
  onClose,
  onChanged,
}: {
  projectId: number;
  canManage: boolean;
  employees: EmployeeOption[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const detail = useFetch<{ project: Project; tasks: ProjectTask[] }>(`/projects/${projectId}`);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState('medium');
  const [dueDate, setDueDate] = useState('');
  const [hours, setHours] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const addTask = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/projects/${projectId}/tasks`, {
        title,
        assignedEmployeeId: assignee ? Number(assignee) : null,
        priority,
        dueDate: dueDate || null,
        estimatedHours: Number(hours) || 0,
      });
      setTitle('');
      setDueDate('');
      setHours('0');
      detail.reload();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (task: ProjectTask, status: string) => {
    setError(null);
    try {
      await api.put(`/projects/tasks/${task.id}`, { status });
      detail.reload();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const removeTask = async (task: ProjectTask) => {
    if (!window.confirm(`Delete task “${task.title}”?`)) return;
    setError(null);
    try {
      await api.del(`/projects/tasks/${task.id}`);
      detail.reload();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const project = detail.data?.project;
  const tasks = detail.data?.tasks ?? [];
  const done = tasks.filter((task) => task.status === 'done').length;

  return (
    <Modal title={project ? `${project.code} — ${project.name}` : 'Project'} onClose={onClose} wide>
      {detail.loading && !detail.data ? (
        <Spinner />
      ) : detail.error ? (
        <ErrorBox message={detail.error} />
      ) : project ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Status</p>
              <div className="mt-1">
                <Badge value={project.status} />
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Tasks</p>
              <p className="mt-1 font-semibold text-slate-900">
                {done}/{tasks.length}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Logged</p>
              <p className="mt-1 font-semibold text-slate-900">{project.logged_hours} h</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Budget</p>
              <p className="mt-1 font-semibold text-slate-900">{money(project.budget_cents)}</p>
            </div>
          </div>

          {project.description ? (
            <p className="text-sm text-slate-600">{project.description}</p>
          ) : null}
          <p className="text-xs text-slate-400">
            {shortDate(project.start_date)} → {shortDate(project.end_date)}
            {project.manager_name ? ` · Manager ${project.manager_name}` : ''}
          </p>

          {error ? <ErrorBox message={error} /> : null}

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Task</th>
                  <th className={thCls}>Assignee</th>
                  <th className={thCls}>Priority</th>
                  <th className={thCls}>Due</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {tasks.length === 0 ? (
                  <EmptyState colSpan={6} message="No tasks yet." />
                ) : (
                  tasks.map((task) => (
                    <tr key={task.id} className="hover:bg-slate-50">
                      <td className={tdCls}>{task.title}</td>
                      <td className={tdCls}>{task.assignee_name ?? '—'}</td>
                      <td className={tdCls}>
                        <Badge value={task.priority} />
                      </td>
                      <td className={tdCls}>{shortDate(task.due_date)}</td>
                      <td className={tdCls}>
                        {canManage ? (
                          <select
                            className={`${inputCls} w-auto py-1`}
                            value={task.status}
                            onChange={(event) => void setStatus(task, event.target.value)}
                          >
                            {TASK_STATUSES.map((value) => (
                              <option key={value} value={value}>
                                {titleCase(value)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Badge value={task.status} />
                        )}
                      </td>
                      <td className={tdCls}>
                        {canManage ? (
                          <div className="flex justify-end">
                            <button
                              type="button"
                              className={`${btnGhost} text-red-600`}
                              onClick={() => void removeTask(task)}
                            >
                              Delete
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {canManage ? (
            <form
              onSubmit={addTask}
              className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-12"
            >
              <input
                className={`${inputCls} sm:col-span-4`}
                placeholder="New task…"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
              <select
                className={`${inputCls} sm:col-span-3`}
                value={assignee}
                onChange={(event) => setAssignee(event.target.value)}
              >
                <option value="">Unassigned</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.first_name} {employee.last_name}
                  </option>
                ))}
              </select>
              <select
                className={`${inputCls} sm:col-span-2`}
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
              >
                {TASK_PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {titleCase(value)}
                  </option>
                ))}
              </select>
              <input
                className={`${inputCls} sm:col-span-2`}
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
              <input
                className={`${inputCls} sm:col-span-1`}
                type="number"
                min={0}
                step="0.5"
                title="Estimated hours"
                value={hours}
                onChange={(event) => setHours(event.target.value)}
              />
              <div className="sm:col-span-12 flex justify-end">
                <button type="submit" className={btnPrimary} disabled={busy}>
                  <Plus className="size-4" /> Add task
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

export default function ProjectsPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<Project | 'new' | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (query) params.set('q', query);

  const projects = useFetch<{ projects: Project[] }>(`/projects?${params}`, [status, query]);
  const employees = useFetch<{ employees: EmployeeOption[] }>('/projects/employees');
  const users = useFetch<{ users: UserOption[] }>(can('users.manage') ? '/users' : null);

  const remove = async (project: Project) => {
    if (!window.confirm(`Delete project “${project.name}” and all its tasks?`)) return;
    setError(null);
    try {
      await api.del(`/projects/${project.id}`);
      projects.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const rows = projects.data?.projects ?? [];

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Plans, tasks, budgets and logged time"
        actions={
          can('projects.manage') ? (
            <button type="button" className={btnPrimary} onClick={() => setModal('new')}>
              <Plus className="size-4" /> New project
            </button>
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          className={`${inputCls} w-auto`}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">All statuses</option>
          {PROJECT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {titleCase(value)}
            </option>
          ))}
        </select>
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
          <input
            className={`${inputCls} pl-9`}
            placeholder="Search name or code…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {projects.loading && !projects.data ? (
        <Spinner />
      ) : projects.error ? (
        <ErrorBox message={projects.error} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr>
                <th className={thCls}>Code</th>
                <th className={thCls}>Project</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>Manager</th>
                <th className={thCls}>Dates</th>
                <th className={thCls}>Tasks</th>
                <th className={`${thCls} text-right`}>Logged</th>
                <th className={`${thCls} text-right`}>Budget</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyState colSpan={9} message="No projects yet." />
              ) : (
                rows.map((project) => (
                  <tr key={project.id} className="hover:bg-slate-50">
                    <td className={`${tdCls} font-mono text-xs`}>{project.code}</td>
                    <td className={tdCls}>
                      <button
                        type="button"
                        className="text-left font-semibold text-emerald-700 hover:underline"
                        onClick={() => setOpenId(project.id)}
                      >
                        {project.name}
                      </button>
                      <p className="max-w-64 truncate text-xs text-slate-400">
                        {project.description ?? '—'}
                      </p>
                    </td>
                    <td className={tdCls}>
                      <Badge value={project.status} />
                    </td>
                    <td className={tdCls}>{project.manager_name ?? '—'}</td>
                    <td className={`${tdCls} whitespace-nowrap text-xs text-slate-500`}>
                      {shortDate(project.start_date)} → {shortDate(project.end_date)}
                    </td>
                    <td className={tdCls}>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
                        <ListChecks className="size-3.5 text-slate-400" />
                        {project.done_task_count}/{project.task_count}
                      </span>
                    </td>
                    <td className={`${tdCls} text-right`}>{project.logged_hours} h</td>
                    <td className={`${tdCls} text-right`}>{money(project.budget_cents)}</td>
                    <td className={tdCls}>
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className={btnGhost}
                          onClick={() => setOpenId(project.id)}
                        >
                          Open
                        </button>
                        {can('projects.manage') ? (
                          <>
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => setModal(project)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className={`${btnGhost} text-red-600`}
                              onClick={() => void remove(project)}
                            >
                              Delete
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
      )}

      {modal ? (
        <Modal
          title={modal === 'new' ? 'New project' : 'Edit project'}
          onClose={() => setModal(null)}
          wide
        >
          <ProjectForm
            project={modal === 'new' ? null : modal}
            users={users.data?.users ?? []}
            onSaved={projects.reload}
            onClose={() => setModal(null)}
          />
        </Modal>
      ) : null}

      {openId !== null ? (
        <ProjectDetail
          projectId={openId}
          canManage={can('projects.manage')}
          employees={employees.data?.employees ?? []}
          onClose={() => setOpenId(null)}
          onChanged={projects.reload}
        />
      ) : null}

      <p className="mt-3 flex items-center gap-1 text-xs text-slate-400">
        <FolderKanban className="size-3.5" /> {rows.length} project{rows.length === 1 ? '' : 's'}
      </p>
    </>
  );
}
