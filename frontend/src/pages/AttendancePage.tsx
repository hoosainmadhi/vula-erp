import { useState, type FormEvent } from 'react';
import { Plus, Search } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../lib/useFetch';
import { monthEnd, monthStart, shortDate, titleCase, today } from '../lib/format';
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
import type { AttendanceRecord, EmployeeOption } from '../types';

const STATUSES = ['present', 'late', 'absent', 'leave', 'holiday'] as const;

function RecordForm({
  record,
  employees,
  onSaved,
  onClose,
}: {
  record: AttendanceRecord | null;
  employees: EmployeeOption[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [employeeId, setEmployeeId] = useState(
    String(record?.employee_id ?? employees[0]?.id ?? ''),
  );
  const [workDate, setWorkDate] = useState(record?.work_date ?? today());
  const [clockIn, setClockIn] = useState(record?.clock_in ?? '');
  const [clockOut, setClockOut] = useState(record?.clock_out ?? '');
  const [status, setStatus] = useState<AttendanceRecord['status']>(record?.status ?? 'present');
  const [hours, setHours] = useState(record ? String(record.hours) : '');
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        employeeId: Number(employeeId),
        workDate,
        clockIn: clockIn || null,
        clockOut: clockOut || null,
        status,
        hours: hours === '' ? undefined : Number(hours),
        notes: notes || null,
      };
      if (record) await api.put(`/attendance/${record.id}`, body);
      else await api.post('/attendance', body);
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
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Employee">
          <select
            className={inputCls}
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            required
          >
            <option value="">Select employee…</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.first_name} {employee.last_name} ({employee.employee_number})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input
            className={inputCls}
            type="date"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
            required
          />
        </Field>
        <Field label="Status">
          <select
            className={inputCls}
            value={status}
            onChange={(e) => setStatus(e.target.value as AttendanceRecord['status'])}
          >
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Clock in">
          <input
            className={inputCls}
            type="time"
            value={clockIn}
            onChange={(e) => setClockIn(e.target.value)}
          />
        </Field>
        <Field label="Clock out">
          <input
            className={inputCls}
            type="time"
            value={clockOut}
            onChange={(e) => setClockOut(e.target.value)}
          />
        </Field>
        <Field label="Hours (optional)">
          <input
            className={inputCls}
            type="number"
            min={0}
            max={24}
            step="0.25"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="Calculated from clock times"
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
          {busy ? 'Saving…' : record ? 'Save changes' : 'Record attendance'}
        </button>
      </div>
    </form>
  );
}

export default function AttendancePage() {
  const { can } = useAuth();
  const [employeeId, setEmployeeId] = useState('');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<AttendanceRecord | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams({ from, to });
  if (employeeId) params.set('employeeId', employeeId);
  if (status !== 'all') params.set('status', status);

  const attendance = useFetch<{
    records: AttendanceRecord[];
    summary: {
      records: number;
      present: number;
      late: number;
      absent: number;
      on_leave: number;
      hours: number;
    };
  }>(`/attendance?${params.toString()}`, [employeeId, status, from, to]);
  const employees = useFetch<{ employees: EmployeeOption[] }>('/attendance/employees');

  const remove = async (record: AttendanceRecord) => {
    if (!window.confirm(`Delete ${record.employee_name} on ${shortDate(record.work_date)}?`)) {
      return;
    }
    setError(null);
    try {
      await api.del(`/attendance/${record.id}`);
      attendance.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const rows = (attendance.data?.records ?? []).filter((record) =>
    query
      ? `${record.employee_name} ${record.employee_number}`
          .toLowerCase()
          .includes(query.toLowerCase())
      : true,
  );
  const summary = attendance.data?.summary;

  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle="Daily clock-in, clock-out and attendance register"
        actions={
          can('attendance.manage') ? (
            <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
              <Plus className="size-4" /> Record attendance
            </button>
          ) : null
        }
      />

      <div className="mb-3 grid gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Present</p>
          <p className="mt-1 text-xl font-bold text-emerald-700">{summary?.present ?? 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Late</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{summary?.late ?? 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Absent</p>
          <p className="mt-1 text-xl font-bold text-red-600">{summary?.absent ?? 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Hours logged
          </p>
          <p className="mt-1 text-xl font-bold text-slate-900">{summary?.hours ?? 0}</p>
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          className={`${inputCls} w-auto`}
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
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
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {titleCase(value)}
            </option>
          ))}
        </select>
        <input
          className={`${inputCls} w-40`}
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          className={`${inputCls} w-40`}
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
          <input
            className={`${inputCls} pl-9`}
            placeholder="Search employee…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {attendance.loading && !attendance.data ? (
        <Spinner />
      ) : attendance.error ? (
        <ErrorBox message={attendance.error} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr>
                <th className={thCls}>Date</th>
                <th className={thCls}>Employee</th>
                <th className={thCls}>Clock in</th>
                <th className={thCls}>Clock out</th>
                <th className={thCls}>Hours</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>Notes</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyState colSpan={8} message="No attendance records in this period." />
              ) : (
                rows.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-50">
                    <td className={tdCls}>{shortDate(record.work_date)}</td>
                    <td className={tdCls}>
                      <p className="font-medium text-slate-800">{record.employee_name}</p>
                      <p className="text-xs text-slate-400">{record.employee_number}</p>
                    </td>
                    <td className={tdCls}>{record.clock_in ?? '—'}</td>
                    <td className={tdCls}>{record.clock_out ?? '—'}</td>
                    <td className={tdCls}>{record.hours}</td>
                    <td className={tdCls}>
                      <Badge value={record.status} />
                    </td>
                    <td className={tdCls}>{record.notes ?? '—'}</td>
                    <td className={tdCls}>
                      {can('attendance.manage') ? (
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className={btnGhost}
                            onClick={() => setEditing(record)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={`${btnGhost} text-red-600`}
                            onClick={() => void remove(record)}
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
      )}

      {editing ? (
        <Modal
          title={editing === 'new' ? 'Record attendance' : 'Edit attendance'}
          onClose={() => setEditing(null)}
          wide
        >
          <RecordForm
            record={editing === 'new' ? null : editing}
            employees={employees.data?.employees ?? []}
            onSaved={() => attendance.reload()}
            onClose={() => setEditing(null)}
          />
        </Modal>
      ) : null}
    </>
  );
}
