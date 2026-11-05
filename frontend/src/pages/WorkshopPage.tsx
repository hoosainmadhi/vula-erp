import { useState, type FormEvent } from 'react';
import { Check, FileText, Pencil, Plus, Play, Trash2, Upload } from 'lucide-react';
import { api, errorMessage, getToken } from '../api';
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
import type { WorkshopFile, WorkshopJob, WorkshopOperation } from '../types';

const STATUSES = [
  'awaiting_payment',
  'queued',
  'in_progress',
  'ready',
  'collected',
  'cancelled',
] as const;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

interface WorkshopOptions {
  customers: { id: number; name: string }[];
  users: { id: number; first_name: string; last_name: string }[];
  invoices: {
    id: number;
    number: string;
    status: string;
    total_cents: number;
    partner_name: string;
  }[];
  salesOrders: { id: number; number: string; status: string; customer_name: string }[];
}

function JobForm({
  job,
  options,
  onSaved,
  onClose,
}: {
  job: WorkshopJob | null;
  options: WorkshopOptions;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(job?.title ?? '');
  const [customerId, setCustomerId] = useState(String(job?.customer_id ?? ''));
  const [invoiceId, setInvoiceId] = useState(String(job?.invoice_id ?? ''));
  const [salesOrderId, setSalesOrderId] = useState(String(job?.sales_order_id ?? ''));
  const [priority, setPriority] = useState(job?.priority ?? 'medium');
  const [dueDate, setDueDate] = useState(job?.due_date ?? today());
  const [assignedTo, setAssignedTo] = useState(String(job?.assigned_to ?? ''));
  const [paymentRequired, setPaymentRequired] = useState(job ? job.payment_required === 1 : true);
  const [quoted, setQuoted] = useState(((job?.quoted_cents ?? 0) / 100).toFixed(2));
  const [material, setMaterial] = useState(((job?.material_cost_cents ?? 0) / 100).toFixed(2));
  const [labour, setLabour] = useState(((job?.labour_cost_cents ?? 0) / 100).toFixed(2));
  const [expense, setExpense] = useState(((job?.expense_cost_cents ?? 0) / 100).toFixed(2));
  const [cuttingListNotes, setCuttingListNotes] = useState(job?.cutting_list_notes ?? '');
  const [notes, setNotes] = useState(job?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        title,
        customerId: customerId ? Number(customerId) : null,
        invoiceId: invoiceId ? Number(invoiceId) : null,
        salesOrderId: salesOrderId ? Number(salesOrderId) : null,
        priority,
        dueDate: dueDate || null,
        assignedTo: assignedTo ? Number(assignedTo) : null,
        paymentRequired,
        quotedCents: Math.round((Number(quoted) || 0) * 100),
        materialCostCents: Math.round((Number(material) || 0) * 100),
        labourCostCents: Math.round((Number(labour) || 0) * 100),
        expenseCostCents: Math.round((Number(expense) || 0) * 100),
        cuttingListNotes: cuttingListNotes || null,
        notes: notes || null,
      };
      if (job) await api.put(`/workshop/jobs/${job.id}`, body);
      else await api.post('/workshop/jobs', body);
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
      <Field label="Job title">
        <input
          className={inputCls}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Kitchen carcasses — cut and edge"
          required
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer">
          <select
            className={inputCls}
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
          >
            <option value="">No customer</option>
            {options.customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Paid invoice">
          <select
            className={inputCls}
            value={invoiceId}
            onChange={(event) => setInvoiceId(event.target.value)}
          >
            <option value="">No invoice</option>
            {options.invoices.map((invoice) => (
              <option key={invoice.id} value={invoice.id}>
                {invoice.number} — {invoice.partner_name} — {titleCase(invoice.status)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sales order">
          <select
            className={inputCls}
            value={salesOrderId}
            onChange={(event) => setSalesOrderId(event.target.value)}
          >
            <option value="">No sales order</option>
            {options.salesOrders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.number} — {order.customer_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Assignee">
          <select
            className={inputCls}
            value={assignedTo}
            onChange={(event) => setAssignedTo(event.target.value)}
          >
            <option value="">Unassigned</option>
            {options.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.first_name} {user.last_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priority">
          <select
            className={inputCls}
            value={priority}
            onChange={(event) => setPriority(event.target.value as WorkshopJob['priority'])}
          >
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Due date">
          <input
            className={inputCls}
            type="date"
            value={dueDate ?? ''}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={paymentRequired}
          onChange={(event) => setPaymentRequired(event.target.checked)}
          className="size-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
        />
        Require the linked invoice to be paid before production
      </label>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Quoted (R)">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.01"
            value={quoted}
            onChange={(event) => setQuoted(event.target.value)}
          />
        </Field>
        <Field label="Materials (R)">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.01"
            value={material}
            onChange={(event) => setMaterial(event.target.value)}
          />
        </Field>
        <Field label="Labour (R)">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.01"
            value={labour}
            onChange={(event) => setLabour(event.target.value)}
          />
        </Field>
        <Field label="Expenses (R)">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.01"
            value={expense}
            onChange={(event) => setExpense(event.target.value)}
          />
        </Field>
      </div>
      <Field label="Cutting list notes">
        <textarea
          className={inputCls}
          rows={3}
          value={cuttingListNotes}
          onChange={(event) => setCuttingListNotes(event.target.value)}
          placeholder="Board, colour, dimensions, edging, quantities…"
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

function JobDetail({
  jobId,
  options,
  onChanged,
  onClose,
}: {
  jobId: number;
  options: WorkshopOptions;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { can } = useAuth();
  const detail = useFetch<{ job: WorkshopJob }>(`/workshop/jobs/${jobId}`, [jobId]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const job = detail.data?.job;

  const run = async (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      if (body === undefined) await api.post(path);
      else await api.post(path, body);
      detail.reload();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      setError('File must be 8MB or smaller');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('Could not read the file'));
        reader.readAsDataURL(file);
      });
      await api.post(`/workshop/jobs/${jobId}/files`, {
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataBase64,
      });
      detail.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const download = async (file: WorkshopFile) => {
    const token = getToken();
    const response = await fetch(`/api/workshop/jobs/${jobId}/files/${file.id}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      setError('Could not download the file');
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const removeFile = async (file: WorkshopFile) => {
    if (!window.confirm(`Delete ${file.filename}?`)) return;
    setError(null);
    try {
      await api.del(`/workshop/jobs/${jobId}/files/${file.id}`);
      detail.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const margin = job
    ? job.quoted_cents - job.material_cost_cents - job.labour_cost_cents - job.expense_cost_cents
    : 0;

  return (
    <div className="space-y-4">
      {error ? <ErrorBox message={error} /> : null}
      {detail.loading && !job ? (
        <Spinner />
      ) : detail.error ? (
        <ErrorBox message={detail.error} />
      ) : job ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Job</p>
              <p className="font-mono text-sm font-bold text-slate-800">{job.number}</p>
              <p className="font-semibold text-slate-800">{job.title}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Customer / invoice</p>
              <p className="font-semibold text-slate-800">{job.customer_name ?? '—'}</p>
              <p className="text-xs text-slate-400">
                {job.invoice_number
                  ? `${job.invoice_number} · ${titleCase(job.invoice_status ?? '')}`
                  : 'No invoice'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Status</p>
              <Badge value={job.status} />
              <p className="mt-1 text-xs text-slate-400">
                Due {shortDate(job.due_date)} · {job.assignee_name ?? 'Unassigned'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {can('workshop.manage') && job.status === 'awaiting_payment' ? (
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() => void run(`/workshop/jobs/${job.id}/release`)}
              >
                <Play className="size-4" /> Release to workshop
              </button>
            ) : null}
            {can('workshop.manage') && job.status === 'ready' ? (
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() => void run(`/workshop/jobs/${job.id}/collect`)}
              >
                <Check className="size-4" /> Mark collected
              </button>
            ) : null}
            {can('workshop.manage') && job.status !== 'collected' && job.status !== 'cancelled' ? (
              <button type="button" className={btnSecondary} onClick={() => setEditOpen(true)}>
                <Pencil className="size-4" /> Edit
              </button>
            ) : null}
            {can('workshop.manage') && job.status !== 'collected' ? (
              <button
                type="button"
                className={btnSecondary}
                disabled={busy}
                onClick={() => void run(`/workshop/jobs/${job.id}/cancel`)}
              >
                Cancel job
              </button>
            ) : null}
            <button
              type="button"
              className={btnSecondary}
              onClick={() => window.open(`/print/job-card/${job.id}`, '_blank')}
            >
              Print job card
            </button>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-bold text-slate-800">Operations</h3>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className={thCls}>Operation</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Assignee</th>
                    <th className={thCls} />
                  </tr>
                </thead>
                <tbody>
                  {(job.operations ?? []).length === 0 ? (
                    <EmptyState colSpan={4} message="No operations." />
                  ) : (
                    (job.operations ?? []).map((operation: WorkshopOperation) => (
                      <tr key={operation.id}>
                        <td className={`${tdCls} font-semibold text-slate-800`}>
                          {operation.name}
                        </td>
                        <td className={tdCls}>
                          <Badge value={operation.status} />
                        </td>
                        <td className={tdCls}>{operation.assignee_name ?? '—'}</td>
                        <td className={tdCls}>
                          {can('workshop.manage') &&
                          (job.status === 'queued' || job.status === 'in_progress') ? (
                            <div className="flex justify-end gap-1">
                              {operation.status === 'pending' ? (
                                <button
                                  type="button"
                                  className={btnGhost}
                                  disabled={busy}
                                  onClick={() =>
                                    void run(
                                      `/workshop/jobs/${job.id}/operations/${operation.id}/start`,
                                    )
                                  }
                                >
                                  Start
                                </button>
                              ) : null}
                              {operation.status !== 'done' ? (
                                <button
                                  type="button"
                                  className={btnGhost}
                                  disabled={busy}
                                  onClick={() =>
                                    void run(
                                      `/workshop/jobs/${job.id}/operations/${operation.id}/complete`,
                                    )
                                  }
                                >
                                  Complete
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-slate-400">Quoted</p>
              <p className="font-semibold">{money(job.quoted_cents)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-slate-400">Costs</p>
              <p className="font-semibold">
                {money(job.material_cost_cents + job.labour_cost_cents + job.expense_cost_cents)}
              </p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-emerald-700">Margin</p>
              <p className="font-bold text-emerald-800">{money(margin)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-slate-400">Payment gate</p>
              <p className="font-semibold">
                {job.payment_required ? 'Invoice must be paid' : 'Not enforced'}
              </p>
            </div>
          </div>

          {job.cutting_list_notes ? (
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Cutting list notes</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                {job.cutting_list_notes}
              </p>
            </div>
          ) : null}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">Cutting list files</h3>
              {can('workshop.manage') ? (
                <label className={`${btnGhost} cursor-pointer`}>
                  <Upload className="size-3.5" /> Upload
                  <input
                    type="file"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void upload(file);
                      event.target.value = '';
                    }}
                  />
                </label>
              ) : null}
            </div>
            {(job.files ?? []).length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                No cutting list or drawings attached.
              </p>
            ) : (
              <div className="space-y-2">
                {(job.files ?? []).map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <FileText className="size-4 text-slate-400" />
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left font-medium text-emerald-700 hover:underline"
                      onClick={() => void download(file)}
                    >
                      {file.filename}
                    </button>
                    <span className="text-xs text-slate-400">
                      {Math.round(file.size_bytes / 1024)} KB
                    </span>
                    {can('workshop.manage') ? (
                      <button
                        type="button"
                        className={btnGhost}
                        onClick={() => void removeFile(file)}
                      >
                        <Trash2 className="size-3.5 text-red-500" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button type="button" className={btnSecondary} onClick={onClose}>
              Close
            </button>
          </div>

          {editOpen ? (
            <Modal title={`Edit ${job.number}`} onClose={() => setEditOpen(false)} wide>
              <JobForm
                job={job}
                options={options}
                onSaved={() => {
                  detail.reload();
                  onChanged();
                }}
                onClose={() => setEditOpen(false)}
              />
            </Modal>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default function WorkshopPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [jobModal, setJobModal] = useState<WorkshopJob | 'new' | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (query) params.set('q', query);

  const jobs = useFetch<{ jobs: WorkshopJob[] }>(`/workshop/jobs?${params}`, [status, query]);
  const options = useFetch<WorkshopOptions>('/workshop/options');
  const summary = useFetch<{
    byStatus: { status: string; count: number }[];
    open: { count: number; quoted_cents: number };
  }>('/workshop/summary');

  const remove = async (job: WorkshopJob) => {
    if (!window.confirm(`Delete ${job.number}?`)) return;
    setError(null);
    try {
      await api.del(`/workshop/jobs/${job.id}`);
      jobs.reload();
      summary.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const rows = jobs.data?.jobs ?? [];
  const awaiting =
    summary.data?.byStatus.find((row) => row.status === 'awaiting_payment')?.count ?? 0;
  const ready = summary.data?.byStatus.find((row) => row.status === 'ready')?.count ?? 0;

  return (
    <>
      <PageHeader
        title="Workshop"
        subtitle="Cutting and edging job cards, cutting lists and production"
        actions={
          can('workshop.manage') ? (
            <button type="button" className={btnPrimary} onClick={() => setJobModal('new')}>
              <Plus className="size-4" /> New job
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
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {titleCase(value)}
            </option>
          ))}
        </select>
        <input
          className={`${inputCls} w-auto min-w-56`}
          placeholder="Search job, title or customer…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {awaiting} awaiting payment
        </span>
        <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {ready} ready for collection
        </span>
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {jobs.loading && !jobs.data ? (
        <Spinner />
      ) : jobs.error ? (
        <ErrorBox message={jobs.error} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead>
              <tr>
                <th className={thCls}>Job</th>
                <th className={thCls}>Customer</th>
                <th className={thCls}>Invoice</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>Priority</th>
                <th className={thCls}>Due</th>
                <th className={thCls}>Assignee</th>
                <th className={`${thCls} text-right`}>Progress</th>
                <th className={`${thCls} text-right`}>Quoted</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyState colSpan={10} message="No workshop jobs yet." />
              ) : (
                rows.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-50">
                    <td className={tdCls}>
                      <p className="font-mono text-xs font-semibold text-slate-700">{job.number}</p>
                      <p className="font-semibold text-slate-800">{job.title}</p>
                    </td>
                    <td className={tdCls}>{job.customer_name ?? '—'}</td>
                    <td className={tdCls}>
                      {job.invoice_number ?? '—'}
                      {job.invoice_status ? (
                        <p className="text-xs text-slate-400">{titleCase(job.invoice_status)}</p>
                      ) : null}
                    </td>
                    <td className={tdCls}>
                      <Badge value={job.status} />
                    </td>
                    <td className={tdCls}>
                      <Badge value={job.priority} />
                    </td>
                    <td className={tdCls}>{shortDate(job.due_date)}</td>
                    <td className={tdCls}>{job.assignee_name ?? '—'}</td>
                    <td className={`${tdCls} text-right`}>
                      {job.done_operation_count ?? 0}/{job.operation_count ?? 0}
                    </td>
                    <td className={`${tdCls} text-right`}>{money(job.quoted_cents)}</td>
                    <td className={tdCls}>
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className={btnGhost}
                          onClick={() => setDetailId(job.id)}
                        >
                          Open
                        </button>
                        {can('workshop.manage') && job.status === 'awaiting_payment' ? (
                          <button
                            type="button"
                            className={btnGhost}
                            onClick={() => setJobModal(job)}
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        ) : null}
                        {can('workshop.manage') && job.status !== 'collected' ? (
                          <button
                            type="button"
                            className={btnGhost}
                            onClick={() => void remove(job)}
                          >
                            <Trash2 className="size-3.5 text-red-500" />
                          </button>
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

      {jobModal ? (
        <Modal
          title={jobModal === 'new' ? 'New workshop job' : `Edit ${jobModal.number}`}
          onClose={() => setJobModal(null)}
          wide
        >
          <JobForm
            job={jobModal === 'new' ? null : jobModal}
            options={options.data ?? { customers: [], users: [], invoices: [], salesOrders: [] }}
            onSaved={() => {
              jobs.reload();
              summary.reload();
            }}
            onClose={() => setJobModal(null)}
          />
        </Modal>
      ) : null}

      {detailId ? (
        <Modal title="Workshop job" onClose={() => setDetailId(null)} wide>
          <JobDetail
            jobId={detailId}
            options={options.data ?? { customers: [], users: [], invoices: [], salesOrders: [] }}
            onChanged={() => {
              jobs.reload();
              summary.reload();
            }}
            onClose={() => setDetailId(null)}
          />
        </Modal>
      ) : null}
    </>
  );
}
