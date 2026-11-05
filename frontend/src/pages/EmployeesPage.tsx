import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../lib/useFetch';
import { money, shortDate, titleCase, today } from '../lib/format';
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
import type { Department, Employee } from '../types';

type Tab = 'employees' | 'departments';

const EMPLOYMENT_TYPES = ['permanent', 'contract', 'part_time', 'intern'] as const;
const EMPLOYEE_STATUSES = ['active', 'on_leave', 'terminated'] as const;

function EmployeeForm({
  employee,
  departments,
  onSaved,
  onClose,
}: {
  employee: Employee | null;
  departments: Department[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [firstName, setFirstName] = useState(employee?.first_name ?? '');
  const [lastName, setLastName] = useState(employee?.last_name ?? '');
  const [email, setEmail] = useState(employee?.email ?? '');
  const [phone, setPhone] = useState(employee?.phone ?? '');
  const [idNumber, setIdNumber] = useState(employee?.id_number ?? '');
  const [departmentId, setDepartmentId] = useState(
    String(employee?.department_id ?? departments[0]?.id ?? ''),
  );
  const [jobTitle, setJobTitle] = useState(employee?.job_title ?? '');
  const [employmentType, setEmploymentType] = useState(employee?.employment_type ?? 'permanent');
  const [status, setStatus] = useState(employee?.status ?? 'active');
  const [startDate, setStartDate] = useState(employee?.start_date ?? today());
  const [endDate, setEndDate] = useState(employee?.end_date ?? '');
  const [salary, setSalary] = useState(((employee?.salary_cents ?? 0) / 100).toFixed(2));
  const [notes, setNotes] = useState(employee?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        firstName,
        lastName,
        email: email || null,
        phone: phone || null,
        idNumber: idNumber || null,
        departmentId: departmentId ? Number(departmentId) : null,
        jobTitle: jobTitle || null,
        employmentType,
        status,
        startDate,
        endDate: endDate || null,
        salaryCents: Math.round((Number(salary) || 0) * 100),
        notes: notes || null,
      };
      if (employee) await api.put(`/employees/${employee.id}`, body);
      else await api.post('/employees', body);
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
        <Field label="First name">
          <input
            className={inputCls}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </Field>
        <Field label="Last name">
          <input
            className={inputCls}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </Field>
        <Field label="Email">
          <input
            className={inputCls}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Phone">
          <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="ID number">
          <input
            className={inputCls}
            value={idNumber}
            onChange={(e) => setIdNumber(e.target.value)}
          />
        </Field>
        <Field label="Department">
          <select
            className={inputCls}
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            <option value="">Unassigned</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Job title">
          <input
            className={inputCls}
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
          />
        </Field>
        <Field label="Employment type">
          <select
            className={inputCls}
            value={employmentType}
            onChange={(e) => setEmploymentType(e.target.value)}
          >
            {EMPLOYMENT_TYPES.map((option) => (
              <option key={option} value={option}>
                {titleCase(option)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            {EMPLOYEE_STATUSES.map((option) => (
              <option key={option} value={option}>
                {titleCase(option)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Monthly salary (R)">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.01"
            value={salary}
            onChange={(e) => setSalary(e.target.value)}
          />
        </Field>
        <Field label="Start date">
          <input
            className={inputCls}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
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
      </div>
      <Field label="Notes">
        <textarea
          className={inputCls}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : employee ? 'Save changes' : 'Create employee'}
        </button>
      </div>
    </form>
  );
}

function DepartmentForm({
  department,
  onSaved,
  onClose,
}: {
  department: Department | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(department?.name ?? '');
  const [description, setDescription] = useState(department?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name, description: description || null };
      if (department) await api.put(`/departments/${department.id}`, body);
      else await api.post('/departments', body);
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
      <Field label="Name">
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Field>
      <Field label="Description">
        <input
          className={inputCls}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

export default function EmployeesPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('employees');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [employeeModal, setEmployeeModal] = useState<Employee | 'new' | null>(null);
  const [departmentModal, setDepartmentModal] = useState<Department | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const employeeParams = new URLSearchParams();
  if (query) employeeParams.set('q', query);
  if (statusFilter !== 'all') employeeParams.set('status', statusFilter);

  const employees = useFetch<{ employees: Employee[] }>(`/employees?${employeeParams.toString()}`, [
    query,
    statusFilter,
  ]);
  const departments = useFetch<{ departments: Department[] }>('/departments');

  const removeEmployee = async (employee: Employee) => {
    if (!window.confirm(`Delete ${employee.first_name} ${employee.last_name}?`)) return;
    setError(null);
    try {
      await api.del(`/employees/${employee.id}`);
      employees.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle="Staff records and departments"
        actions={
          can('hr.manage') ? (
            tab === 'employees' ? (
              <button type="button" className={btnPrimary} onClick={() => setEmployeeModal('new')}>
                <Plus className="size-4" /> New employee
              </button>
            ) : (
              <button
                type="button"
                className={btnPrimary}
                onClick={() => setDepartmentModal('new')}
              >
                <Plus className="size-4" /> New department
              </button>
            )
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {(
            [
              ['employees', 'Employees'],
              ['departments', 'Departments'],
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
        {tab === 'employees' ? (
          <>
            <select
              className={`${inputCls} w-auto`}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All statuses</option>
              {EMPLOYEE_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {titleCase(option)}
                </option>
              ))}
            </select>
            <div className="relative min-w-56 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
              <input
                className={`${inputCls} pl-9`}
                placeholder="Search name, number or email…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </>
        ) : null}
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {tab === 'employees' ? (
        employees.loading && !employees.data ? (
          <Spinner />
        ) : employees.error ? (
          <ErrorBox message={employees.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Number</th>
                  <th className={thCls}>Employee</th>
                  <th className={thCls}>Department</th>
                  <th className={thCls}>Job title</th>
                  <th className={thCls}>Type</th>
                  <th className={thCls}>Status</th>
                  <th className={`${thCls} text-right`}>Salary</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {!employees.data || employees.data.employees.length === 0 ? (
                  <EmptyState colSpan={8} message="No employees found." />
                ) : (
                  employees.data.employees.map((employee) => (
                    <tr key={employee.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-mono text-xs`}>{employee.employee_number}</td>
                      <td className={tdCls}>
                        <p className="font-semibold text-slate-800">
                          {employee.first_name} {employee.last_name}
                        </p>
                        <p className="text-xs text-slate-400">
                          {employee.email ?? employee.phone ?? '—'}
                        </p>
                      </td>
                      <td className={tdCls}>{employee.department_name ?? '—'}</td>
                      <td className={tdCls}>{employee.job_title ?? '—'}</td>
                      <td className={tdCls}>{titleCase(employee.employment_type)}</td>
                      <td className={tdCls}>
                        <Badge value={employee.status} />
                      </td>
                      <td className={`${tdCls} text-right`}>{money(employee.salary_cents)}</td>
                      <td className={tdCls}>
                        <div className="flex justify-end gap-1">
                          <span className="whitespace-nowrap px-1 text-xs text-slate-400">
                            {shortDate(employee.start_date)}
                          </span>
                          {can('hr.manage') ? (
                            <>
                              <button
                                type="button"
                                className={btnGhost}
                                onClick={() => setEmployeeModal(employee)}
                              >
                                <Pencil className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                className={btnGhost}
                                onClick={() => removeEmployee(employee)}
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

      {tab === 'departments' ? (
        departments.loading && !departments.data ? (
          <Spinner />
        ) : departments.error ? (
          <ErrorBox message={departments.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Department</th>
                  <th className={thCls}>Description</th>
                  <th className={`${thCls} text-right`}>Active staff</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {!departments.data || departments.data.departments.length === 0 ? (
                  <EmptyState colSpan={4} message="No departments yet." />
                ) : (
                  departments.data.departments.map((department) => (
                    <tr key={department.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-semibold text-slate-800`}>{department.name}</td>
                      <td className={tdCls}>{department.description ?? '—'}</td>
                      <td className={`${tdCls} text-right`}>{department.employee_count ?? 0}</td>
                      <td className={tdCls}>
                        {can('hr.manage') ? (
                          <div className="flex justify-end">
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => setDepartmentModal(department)}
                            >
                              <Pencil className="size-3.5" />
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
        )
      ) : null}

      {employeeModal ? (
        <Modal
          title={employeeModal === 'new' ? 'New employee' : 'Edit employee'}
          onClose={() => setEmployeeModal(null)}
          wide
        >
          <EmployeeForm
            employee={employeeModal === 'new' ? null : employeeModal}
            departments={departments.data?.departments ?? []}
            onSaved={employees.reload}
            onClose={() => setEmployeeModal(null)}
          />
        </Modal>
      ) : null}

      {departmentModal ? (
        <Modal
          title={departmentModal === 'new' ? 'New department' : 'Edit department'}
          onClose={() => setDepartmentModal(null)}
        >
          <DepartmentForm
            department={departmentModal === 'new' ? null : departmentModal}
            onSaved={departments.reload}
            onClose={() => setDepartmentModal(null)}
          />
        </Modal>
      ) : null}
    </>
  );
}
