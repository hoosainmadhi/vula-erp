import { useState, type FormEvent } from 'react';
import { CalendarDays, Plus } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../lib/useFetch';
import { shortDate, today } from '../lib/format';
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
import type { EmployeeOption, LeaveBalance, LeaveRequest, LeaveType } from '../types';

type Tab = 'requests' | 'balances';

function RequestForm({
  employees,
  leaveTypes,
  onSaved,
  onClose,
}: {
  employees: EmployeeOption[];
  leaveTypes: LeaveType[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [employeeId, setEmployeeId] = useState(String(employees[0]?.id ?? ''));
  const [leaveTypeId, setLeaveTypeId] = useState(String(leaveTypes[0]?.id ?? ''));
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/leave/requests', {
        employeeId: Number(employeeId),
        leaveTypeId: Number(leaveTypeId),
        startDate,
        endDate,
        reason: reason || null,
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
      <Field label="Leave type">
        <select
          className={inputCls}
          value={leaveTypeId}
          onChange={(event) => setLeaveTypeId(event.target.value)}
          required
        >
          <option value="">Select a leave type…</option>
          {leaveTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From">
          <input
            className={inputCls}
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            required
          />
        </Field>
        <Field label="To">
          <input
            className={inputCls}
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            required
          />
        </Field>
      </div>
      <Field label="Reason">
        <textarea
          className={inputCls}
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : 'Submit request'}
        </button>
      </div>
    </form>
  );
}

export default function TimeOffPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('requests');
  const [status, setStatus] = useState('pending');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);

  const requests = useFetch<{ leaveRequests: LeaveRequest[] }>(`/leave/requests?${params}`, [
    status,
  ]);
  const employees = useFetch<{ employees: EmployeeOption[] }>('/leave/employees');
  const leaveTypes = useFetch<{ leaveTypes: LeaveType[] }>('/leave/types');
  const balances = useFetch<{ year: number; balances: LeaveBalance[] }>(
    `/leave/summary?year=${year}`,
    [year],
  );

  const act = async (request: LeaveRequest, action: 'approve' | 'reject' | 'cancel') => {
    setError(null);
    try {
      await api.post(`/leave/requests/${request.id}/${action}`);
      requests.reload();
      balances.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const pending =
    requests.data?.leaveRequests.filter((row) => row.status === 'pending').length ?? 0;

  return (
    <>
      <PageHeader
        title="Time Off"
        subtitle="Leave requests, approvals and yearly balances"
        actions={
          can('hr.manage') ? (
            <button type="button" className={btnPrimary} onClick={() => setFormOpen(true)}>
              <Plus className="size-4" /> New request
            </button>
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {(
            [
              ['requests', 'Requests'],
              ['balances', 'Balances'],
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
        {tab === 'requests' ? (
          <select
            className={`${inputCls} w-auto`}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">All requests</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        ) : (
          <select
            className={`${inputCls} w-auto`}
            value={year}
            onChange={(event) => setYear(event.target.value)}
          >
            {[0, 1, 2].map((offset) => {
              const value = String(new Date().getFullYear() - offset);
              return (
                <option key={value} value={value}>
                  {value}
                </option>
              );
            })}
          </select>
        )}
        {tab === 'requests' ? (
          <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            <CalendarDays className="size-4 text-amber-600" />
            <span className="font-semibold text-slate-900">{pending}</span>
            <span>awaiting approval</span>
          </span>
        ) : null}
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {tab === 'requests' ? (
        requests.loading && !requests.data ? (
          <Spinner />
        ) : requests.error ? (
          <ErrorBox message={requests.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Employee</th>
                  <th className={thCls}>Type</th>
                  <th className={thCls}>From</th>
                  <th className={thCls}>To</th>
                  <th className={`${thCls} text-right`}>Days</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Reason</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {!requests.data || requests.data.leaveRequests.length === 0 ? (
                  <EmptyState colSpan={8} message="No leave requests found." />
                ) : (
                  requests.data.leaveRequests.map((request) => (
                    <tr key={request.id} className="hover:bg-slate-50">
                      <td className={tdCls}>
                        <p className="font-semibold text-slate-800">{request.employee_name}</p>
                        <p className="font-mono text-xs text-slate-400">
                          {request.employee_number}
                        </p>
                      </td>
                      <td className={tdCls}>{request.leave_type_name}</td>
                      <td className={tdCls}>{shortDate(request.start_date)}</td>
                      <td className={tdCls}>{shortDate(request.end_date)}</td>
                      <td className={`${tdCls} text-right font-semibold`}>{request.days}</td>
                      <td className={tdCls}>
                        <Badge value={request.status} />
                      </td>
                      <td className={`${tdCls} max-w-56 truncate text-slate-500`}>
                        {request.reason ?? '—'}
                      </td>
                      <td className={tdCls}>
                        {can('hr.manage') && request.status === 'pending' ? (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => void act(request, 'approve')}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className={`${btnGhost} text-red-600`}
                              onClick={() => void act(request, 'reject')}
                            >
                              Reject
                            </button>
                          </div>
                        ) : can('hr.manage') && request.status === 'approved' ? (
                          <div className="flex justify-end">
                            <button
                              type="button"
                              className={`${btnGhost} text-red-600`}
                              onClick={() => void act(request, 'cancel')}
                            >
                              Cancel
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

      {tab === 'balances' ? (
        balances.loading && !balances.data ? (
          <Spinner />
        ) : balances.error ? (
          <ErrorBox message={balances.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Employee</th>
                  <th className={thCls}>Leave type</th>
                  <th className={`${thCls} text-right`}>Entitled</th>
                  <th className={`${thCls} text-right`}>Approved</th>
                  <th className={`${thCls} text-right`}>Pending</th>
                  <th className={`${thCls} text-right`}>Remaining</th>
                </tr>
              </thead>
              <tbody>
                {!balances.data || balances.data.balances.length === 0 ? (
                  <EmptyState colSpan={6} message="No employees or leave types yet." />
                ) : (
                  balances.data.balances.map((row) => {
                    const remaining = row.days_per_year - row.approved_days - row.pending_days;
                    return (
                      <tr
                        key={`${row.employee_id}-${row.leave_type_id}`}
                        className="hover:bg-slate-50"
                      >
                        <td className={tdCls}>
                          <p className="font-semibold text-slate-800">{row.employee_name}</p>
                          <p className="font-mono text-xs text-slate-400">{row.employee_number}</p>
                        </td>
                        <td className={tdCls}>{row.leave_type_name}</td>
                        <td className={`${tdCls} text-right`}>{row.days_per_year}</td>
                        <td className={`${tdCls} text-right`}>{row.approved_days}</td>
                        <td className={`${tdCls} text-right text-amber-600`}>{row.pending_days}</td>
                        <td
                          className={`${tdCls} text-right font-semibold ${
                            remaining < 0 ? 'text-red-600' : 'text-emerald-700'
                          }`}
                        >
                          {remaining}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {formOpen ? (
        <Modal title="New leave request" onClose={() => setFormOpen(false)}>
          <RequestForm
            employees={employees.data?.employees ?? []}
            leaveTypes={leaveTypes.data?.leaveTypes ?? []}
            onSaved={() => {
              requests.reload();
              balances.reload();
            }}
            onClose={() => setFormOpen(false)}
          />
        </Modal>
      ) : null}
    </>
  );
}
