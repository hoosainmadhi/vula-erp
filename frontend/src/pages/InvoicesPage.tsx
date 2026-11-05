import { useState, type FormEvent } from 'react';
import { Plus, Receipt, Search } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../lib/useFetch';
import { addDays, money, shortDate, titleCase, today } from '../lib/format';
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
import {
  blankLine,
  draftTotals,
  LineItemsEditor,
  payloadLines,
  type DraftLine,
} from '../components/LineItemsEditor';
import type { Invoice, InvoiceLine, Partner, Payment, Product, Warehouse } from '../types';

interface InvoiceDetail {
  invoice: Invoice;
  payments: Payment[];
}

interface InvoiceListResponse {
  invoices: Invoice[];
  total: number;
  summary: { receivable_cents: number; payable_cents: number };
}

const METHOD_OPTIONS = ['eft', 'bank', 'cash', 'card', 'other'] as const;

function InvoiceForm({
  partners,
  products,
  onSaved,
  onClose,
}: {
  partners: Partner[];
  products: Product[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [direction, setDirection] = useState<'sale' | 'purchase'>('sale');
  const eligible = partners.filter((partner) =>
    direction === 'sale' ? partner.is_customer === 1 : partner.is_supplier === 1,
  );
  const [partnerId, setPartnerId] = useState(() =>
    String((partners.find((p) => p.is_customer === 1) ?? partners[0])?.id ?? ''),
  );
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState(addDays(today(), 30));
  const [notes, setNotes] = useState('');
  const [post, setPost] = useState(true);
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const totals = draftTotals(lines);

  const switchDirection = (next: 'sale' | 'purchase') => {
    setDirection(next);
    const first = partners.find((p) =>
      next === 'sale' ? p.is_customer === 1 : p.is_supplier === 1,
    );
    if (first) setPartnerId(String(first.id));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/invoices', {
        direction,
        partnerId: Number(partnerId),
        issueDate,
        dueDate,
        notes: notes || null,
        post,
        lines: payloadLines(lines, 'price'),
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
    <form onSubmit={submit} className="space-y-4">
      {error ? <ErrorBox message={error} /> : null}
      <div className="flex rounded-lg border border-slate-200 bg-white p-1">
        {(
          [
            ['sale', 'Customer invoice'],
            ['purchase', 'Supplier bill'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => switchDirection(value)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${
              direction === value
                ? 'bg-emerald-600 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={direction === 'sale' ? 'Customer' : 'Supplier'}>
          <select
            className={inputCls}
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            required
          >
            <option value="">Select…</option>
            {eligible.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Issue date">
          <input
            className={inputCls}
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            required
          />
        </Field>
        <Field label="Due date">
          <input
            className={inputCls}
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            required
          />
        </Field>
      </div>

      <LineItemsEditor
        lines={lines}
        products={products}
        priceKind={direction === 'sale' ? 'price' : 'cost'}
        onChange={setLines}
      />

      <Field label="Notes">
        <textarea
          className={inputCls}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={post} onChange={(e) => setPost(e.target.checked)} />
        Post to the ledger immediately (uncheck to save as a draft)
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <p className="text-sm text-slate-500">
          Total <strong className="text-slate-900">{money(totals.totalCents)}</strong> incl. VAT
        </p>
        <div className="flex gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy}>
            {busy ? 'Saving…' : post ? 'Create & post' : 'Save draft'}
          </button>
        </div>
      </div>
    </form>
  );
}

function PaymentModal({
  invoice,
  partners,
  onClose,
  onSaved,
}: {
  invoice: Invoice | null;
  partners: Partner[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const direction = invoice ? (invoice.direction === 'sale' ? 'in' : 'out') : 'in';
  const [paymentDirection, setPaymentDirection] = useState<'in' | 'out'>(direction);
  const eligible = partners.filter((partner) =>
    paymentDirection === 'in' ? partner.is_customer === 1 : partner.is_supplier === 1,
  );
  const [partnerId, setPartnerId] = useState(String(invoice?.partner_id ?? eligible[0]?.id ?? ''));
  const outstanding = invoice ? invoice.total_cents - invoice.amount_paid_cents : 0;
  const [amount, setAmount] = useState(((outstanding || 0) / 100).toFixed(2));
  const [paymentDate, setPaymentDate] = useState(today());
  const [method, setMethod] = useState<(typeof METHOD_OPTIONS)[number]>('eft');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectDirection = (next: 'in' | 'out') => {
    setPaymentDirection(next);
    const first = partners.find((p) => (next === 'in' ? p.is_customer === 1 : p.is_supplier === 1));
    if (first) setPartnerId(String(first.id));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/invoices/payments', {
        direction: paymentDirection,
        partnerId: Number(partnerId),
        invoiceId: invoice?.id ?? null,
        paymentDate,
        amountCents: Math.round((Number(amount) || 0) * 100),
        method,
        reference: reference || null,
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
    <Modal title={invoice ? `Payment — ${invoice.number}` : 'Record payment'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error ? <ErrorBox message={error} /> : null}
        {invoice ? (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <p className="font-semibold text-slate-800">{invoice.partner_name}</p>
            <p className="text-slate-500">
              Outstanding {money(outstanding)} of {money(invoice.total_cents)}
            </p>
          </div>
        ) : (
          <>
            <div className="flex rounded-lg border border-slate-200 bg-white p-1">
              {(
                [
                  ['in', 'Money in'],
                  ['out', 'Money out'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => selectDirection(value)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${
                    paymentDirection === value
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <Field label={paymentDirection === 'in' ? 'Customer' : 'Supplier'}>
              <select
                className={inputCls}
                value={partnerId}
                onChange={(e) => setPartnerId(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {eligible.map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.name}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount (R)">
            <input
              className={inputCls}
              type="number"
              min={0.01}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </Field>
          <Field label="Payment date">
            <input
              className={inputCls}
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              required
            />
          </Field>
          <Field label="Method">
            <select
              className={inputCls}
              value={method}
              onChange={(e) => setMethod(e.target.value as (typeof METHOD_OPTIONS)[number])}
            >
              {METHOD_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {titleCase(option)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reference">
            <input
              className={inputCls}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Notes">
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy}>
            {busy ? 'Saving…' : 'Record payment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DetailModal({
  detail,
  canManage,
  onClose,
  onPay,
  onChanged,
}: {
  detail: InvoiceDetail;
  canManage: boolean;
  onClose: () => void;
  onPay: () => void;
  onChanged: (message: string) => void;
}) {
  const invoice = detail.invoice;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (path: string, method: 'post' | 'delete', message: string) => {
    setBusy(true);
    setError(null);
    try {
      if (method === 'post') await api.post(path);
      else await api.del(path);
      onChanged(message);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`${titleCase(invoice.direction)} ${invoice.number}`} onClose={onClose} wide>
      <div className="space-y-4">
        {error ? <ErrorBox message={error} /> : null}
        <div className="grid gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs uppercase text-slate-500">Partner</p>
            <p className="font-semibold text-slate-800">{invoice.partner_name}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Issued</p>
            <p className="font-semibold text-slate-800">{shortDate(invoice.issue_date)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Due</p>
            <p className="font-semibold text-slate-800">{shortDate(invoice.due_date)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Status</p>
            <Badge value={invoice.status} />
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit price</th>
                <th className="px-3 py-2 text-right">VAT</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {(invoice.lines ?? []).map((line: InvoiceLine) => (
                <tr key={line.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-800">{line.description}</td>
                  <td className="px-3 py-2 text-right">{line.quantity}</td>
                  <td className="px-3 py-2 text-right">{money(line.unit_price_cents)}</td>
                  <td className="px-3 py-2 text-right">{money(line.line_tax_cents)}</td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {money(line.line_total_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Subtotal</p>
            <p className="font-semibold">{money(invoice.subtotal_cents)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">VAT</p>
            <p className="font-semibold">{money(invoice.tax_cents)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Paid / total</p>
            <p className="font-semibold">
              {money(invoice.amount_paid_cents)} / {money(invoice.total_cents)}
            </p>
          </div>
        </div>

        {detail.payments.length > 0 ? (
          <div>
            <h3 className="mb-1 text-sm font-bold text-slate-900">Payments</h3>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="px-2 py-2">Number</th>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Method</th>
                  <th className="px-2 py-2">Reference</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {detail.payments.map((payment) => (
                  <tr key={payment.id} className="border-t border-slate-100">
                    <td className="px-2 py-2 font-mono text-xs">{payment.number}</td>
                    <td className="px-2 py-2">{shortDate(payment.payment_date)}</td>
                    <td className="px-2 py-2">{titleCase(payment.method)}</td>
                    <td className="px-2 py-2">{payment.reference ?? '—'}</td>
                    <td className="px-2 py-2 text-right">{money(payment.amount_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {invoice.notes ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{invoice.notes}</p>
        ) : null}

        {canManage ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
            {invoice.status === 'draft' ? (
              <>
                <button
                  type="button"
                  className={btnSecondary}
                  disabled={busy}
                  onClick={() => act(`/invoices/${invoice.id}`, 'delete', 'Draft invoice deleted.')}
                >
                  Delete draft
                </button>
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={busy}
                  onClick={() =>
                    act(`/invoices/${invoice.id}/post`, 'post', 'Invoice posted to the ledger.')
                  }
                >
                  Post invoice
                </button>
              </>
            ) : null}
            {invoice.status === 'open' ? (
              <>
                <button type="button" className={btnSecondary} disabled={busy} onClick={onPay}>
                  Record payment
                </button>
                <button
                  type="button"
                  className={btnSecondary}
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(`Void ${invoice.number}? A reversing entry will be posted.`)
                    ) {
                      void act(
                        `/invoices/${invoice.id}/void`,
                        'post',
                        'Invoice voided with a reversing entry.',
                      );
                    }
                  }}
                >
                  Void
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export default function InvoicesPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'invoices' | 'payments'>('invoices');
  const [direction, setDirection] = useState('all');
  const [status, setStatus] = useState('all');
  const [overdue, setOverdue] = useState(false);
  const [query, setQuery] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<Invoice | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const invoiceParams = new URLSearchParams();
  if (direction !== 'all') invoiceParams.set('direction', direction);
  if (status !== 'all') invoiceParams.set('status', status);
  if (overdue) invoiceParams.set('overdue', 'true');
  if (query) invoiceParams.set('q', query);
  if (warehouseId) invoiceParams.set('warehouseId', warehouseId);

  const invoices = useFetch<InvoiceListResponse>(`/invoices?${invoiceParams.toString()}`, [
    direction,
    status,
    overdue,
    query,
    warehouseId,
  ]);
  const paymentParams = new URLSearchParams();
  if (direction !== 'all') paymentParams.set('direction', direction === 'sale' ? 'in' : 'out');
  const payments = useFetch<{ payments: Payment[] }>(
    `/invoices/payments?${paymentParams.toString()}`,
    [direction],
  );
  const partners = useFetch<{ partners: Partner[] }>('/partners?limit=500');
  const products = useFetch<{ products: Product[] }>('/products?limit=1000');
  const warehouses = useFetch<{ warehouses: Warehouse[] }>('/inventory/warehouses');

  const openDetail = async (invoice: Invoice) => {
    setError(null);
    try {
      setDetail(await api.get<InvoiceDetail>(`/invoices/${invoice.id}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const refreshAll = (message: string) => {
    setNotice(message);
    invoices.reload();
    payments.reload();
  };

  return (
    <>
      <PageHeader
        title="Invoices & payments"
        subtitle="Customer invoices, supplier bills and settlement"
        actions={
          can('invoices.manage') ? (
            <>
              <button
                type="button"
                className={btnSecondary}
                onClick={() => setPaymentTarget('new')}
              >
                Record payment
              </button>
              <button type="button" className={btnPrimary} onClick={() => setCreating(true)}>
                <Plus className="size-4" /> New invoice
              </button>
            </>
          ) : null
        }
      />

      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Receivables
          </p>
          <p className="mt-1 text-xl font-bold text-amber-700">
            {money(invoices.data?.summary.receivable_cents ?? 0)}
          </p>
          <p className="text-xs text-slate-400">Outstanding customer invoices</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payables</p>
          <p className="mt-1 text-xl font-bold text-red-700">
            {money(invoices.data?.summary.payable_cents ?? 0)}
          </p>
          <p className="text-xs text-slate-400">Outstanding supplier bills</p>
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {(
            [
              ['invoices', 'Invoices'],
              ['payments', 'Payments'],
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
        <select
          className={`${inputCls} w-auto`}
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
        >
          <option value="all">All directions</option>
          <option value="sale">Customer invoices</option>
          <option value="purchase">Supplier bills</option>
        </select>
        {tab === 'invoices' ? (
          <>
            <select
              className={`${inputCls} w-auto`}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="open">Open</option>
              <option value="paid">Paid</option>
              <option value="void">Void</option>
            </select>
            <select
              className={`${inputCls} w-auto`}
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              <option value="">All branches</option>
              {(warehouses.data?.warehouses ?? []).map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={overdue}
                onChange={(e) => setOverdue(e.target.checked)}
              />{' '}
              Overdue only
            </label>
            <div className="relative min-w-56 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
              <input
                className={`${inputCls} pl-9`}
                placeholder="Search number or partner…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </>
        ) : null}
      </div>

      {error ? <ErrorBox message={error} /> : null}
      {notice ? (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}

      {tab === 'invoices' ? (
        invoices.loading && !invoices.data ? (
          <Spinner />
        ) : invoices.error ? (
          <ErrorBox message={invoices.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Number</th>
                  <th className={thCls}>Partner</th>
                  <th className={thCls}>Branch</th>
                  <th className={thCls}>Issued</th>
                  <th className={thCls}>Due</th>
                  <th className={thCls}>Status</th>
                  <th className={`${thCls} text-right`}>Total</th>
                  <th className={`${thCls} text-right`}>Outstanding</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {!invoices.data || invoices.data.invoices.length === 0 ? (
                  <EmptyState colSpan={9} message="No invoices found." />
                ) : (
                  invoices.data.invoices.map((invoice) => {
                    const outstanding =
                      invoice.outstanding_cents ?? invoice.total_cents - invoice.amount_paid_cents;
                    return (
                      <tr key={invoice.id} className="hover:bg-slate-50">
                        <td className={`${tdCls} font-mono text-xs font-semibold text-slate-700`}>
                          {invoice.number}
                          <p className="mt-0.5 text-[10px] uppercase text-slate-400">
                            {invoice.direction === 'sale' ? 'Sale' : 'Purchase'}
                          </p>
                        </td>
                        <td className={`${tdCls} font-semibold text-slate-800`}>
                          {invoice.partner_name}
                        </td>
                        <td className={tdCls}>{invoice.warehouse_name ?? '—'}</td>
                        <td className={tdCls}>{shortDate(invoice.issue_date)}</td>
                        <td className={tdCls}>
                          {shortDate(invoice.due_date)}
                          {invoice.overdue ? (
                            <span className="ml-1 rounded bg-red-50 px-1 text-[10px] font-bold text-red-600">
                              OVERDUE
                            </span>
                          ) : null}
                        </td>
                        <td className={tdCls}>
                          <Badge value={invoice.status} />
                        </td>
                        <td className={`${tdCls} text-right font-semibold`}>
                          {money(invoice.total_cents)}
                        </td>
                        <td
                          className={`${tdCls} text-right font-semibold ${
                            outstanding > 0 ? 'text-amber-700' : 'text-slate-400'
                          }`}
                        >
                          {money(outstanding)}
                        </td>
                        <td className={tdCls}>
                          <div className="flex flex-wrap justify-end gap-1">
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => openDetail(invoice)}
                            >
                              <Receipt className="size-3.5" /> View
                            </button>
                            {can('invoices.manage') && invoice.status === 'open' ? (
                              <button
                                type="button"
                                className={btnGhost}
                                onClick={() => setPaymentTarget(invoice)}
                              >
                                Pay
                              </button>
                            ) : null}
                            {can('invoices.manage') && invoice.status === 'draft' ? (
                              <button
                                type="button"
                                className={btnGhost}
                                onClick={async () => {
                                  try {
                                    await api.post(`/invoices/${invoice.id}/post`);
                                    refreshAll('Draft invoice posted.');
                                  } catch (err) {
                                    setError(errorMessage(err));
                                  }
                                }}
                              >
                                Post
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )
      ) : payments.loading && !payments.data ? (
        <Spinner />
      ) : payments.error ? (
        <ErrorBox message={payments.error} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr>
                <th className={thCls}>Number</th>
                <th className={thCls}>Date</th>
                <th className={thCls}>Direction</th>
                <th className={thCls}>Partner</th>
                <th className={thCls}>Invoice</th>
                <th className={thCls}>Method</th>
                <th className={`${thCls} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {!payments.data || payments.data.payments.length === 0 ? (
                <EmptyState colSpan={7} message="No payments recorded." />
              ) : (
                payments.data.payments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-slate-50">
                    <td className={`${tdCls} font-mono text-xs`}>{payment.number}</td>
                    <td className={tdCls}>{shortDate(payment.payment_date)}</td>
                    <td className={tdCls}>
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                          payment.direction === 'in'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {payment.direction === 'in' ? 'Money in' : 'Money out'}
                      </span>
                    </td>
                    <td className={`${tdCls} font-medium text-slate-800`}>
                      {payment.partner_name}
                    </td>
                    <td className={`${tdCls} font-mono text-xs text-slate-500`}>
                      {payment.invoice_number ?? '—'}
                    </td>
                    <td className={tdCls}>{titleCase(payment.method)}</td>
                    <td className={`${tdCls} text-right font-semibold`}>
                      {money(payment.amount_cents)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {creating ? (
        <Modal title="New invoice" onClose={() => setCreating(false)} wide>
          <InvoiceForm
            partners={partners.data?.partners ?? []}
            products={products.data?.products ?? []}
            onSaved={() => refreshAll('Invoice created.')}
            onClose={() => setCreating(false)}
          />
        </Modal>
      ) : null}

      {detail ? (
        <DetailModal
          detail={detail}
          canManage={can('invoices.manage')}
          onClose={() => setDetail(null)}
          onPay={() => {
            setPaymentTarget(detail.invoice);
            setDetail(null);
          }}
          onChanged={refreshAll}
        />
      ) : null}

      {paymentTarget ? (
        <PaymentModal
          invoice={paymentTarget === 'new' ? null : paymentTarget}
          partners={partners.data?.partners ?? []}
          onClose={() => setPaymentTarget(null)}
          onSaved={() => refreshAll('Payment recorded and posted.')}
        />
      ) : null}
    </>
  );
}
