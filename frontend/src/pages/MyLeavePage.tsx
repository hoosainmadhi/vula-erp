import { useState, type FormEvent } from 'react';
import { CalendarDays, Plus } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useFetch } from '../lib/useFetch';
import { shortDate, today } from '../lib/format';
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
import type { LeaveType, MyLeaveResponse } from '../types';

function RequestForm({
  leaveTypes,
  onSaved,
  onClose,
}: {
  leaveTypes: LeaveType[];
  onSaved: () => void;
  onClose: () => void;
}) {
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
      await api.post('/leave/me/requests', {
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
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Optional — e.g. family holiday"
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Submitting…' : 'Submit request'}
        </button>
      </div>
    </form>
  );
}

export default function MyLeavePage() {
  const [modal, setModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = useFetch<MyLeaveResponse>('/leave/me');

  const cancel = async (id: number) => {
    if (!window.confirm('Cancel this leave request?')) return;
    setError(null);
    try {
      await api.post(`/leave/me/requests/${id}/cancel`);
      mine.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const data = mine.data;
  const requests = data?.requests ?? [];
  const balances = data?.balances ?? [];

  return (
    <>
      <PageHeader
        title="My Leave"
        subtitle="Apply for leave and track your balances"
        actions={
          <button
            type="button"
            className={btnPrimary}
            onClick={() => setModal(true)}
            disabled={!data}
          >
            <Plus className="size-4" /> New request
          </button>
        }
      />

      {error ? <ErrorBox message={error} /> : null}

      {mine.loading && !data ? (
        <Spinner />
      ) : mine.error ? (
        <ErrorBox message={mine.error} />
      ) : data ? (
        <>
          <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Employee</p>
              <p className="text-lg font-bold text-slate-900">
                {data.employee.first_name} {data.employee.last_name}
              </p>
              <p className="text-sm text-slate-500">
                {data.employee.employee_number}
                {data.employee.job_title ? ` · ${data.employee.job_title}` : ''}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate-400">Leave year</p>
              <p className="text-lg font-bold text-slate-900">{data.year}</p>
            </div>
          </Card>

          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {balances.map((balance) => {
              const remaining =
                balance.days_per_year - balance.approved_days - balance.pending_days;
              return (
                <Card key={balance.leave_type_id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{balance.leave_type_name}</p>
                      <p className="text-xs text-slate-400">
                        {balance.days_per_year} days per year
                      </p>
                    </div>
                    <CalendarDays className="size-4 text-emerald-600" />
                  </div>
                  <p className="mt-3 text-2xl font-black text-slate-900">{remaining}</p>
                  <p className="text-xs text-slate-400">days available</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {balance.approved_days} approved · {balance.pending_days} pending
                  </p>
                </Card>
              );
            })}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr>
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
                {requests.length === 0 ? (
                  <EmptyState colSpan={7} message="You have not applied for leave yet." />
                ) : (
                  requests.map((request) => (
                    <tr key={request.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-semibold text-slate-800`}>
                        {request.leave_type_name}
                      </td>
                      <td className={tdCls}>{shortDate(request.start_date)}</td>
                      <td className={tdCls}>{shortDate(request.end_date)}</td>
                      <td className={`${tdCls} text-right`}>{request.days}</td>
                      <td className={tdCls}>
                        <Badge value={request.status} />
                      </td>
                      <td className={tdCls}>{request.reason ?? '—'}</td>
                      <td className={tdCls}>
                        {request.status === 'pending' ? (
                          <div className="flex justify-end">
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => void cancel(request.id)}
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
        </>
      ) : null}

      {modal && data ? (
        <Modal title="New leave request" onClose={() => setModal(false)}>
          <RequestForm
            leaveTypes={data.leaveTypes}
            onSaved={() => mine.reload()}
            onClose={() => setModal(false)}
          />
        </Modal>
      ) : null}
    </>
  );
}
