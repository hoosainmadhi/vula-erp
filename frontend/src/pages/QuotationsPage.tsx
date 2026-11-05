import { useState, type FormEvent } from 'react';
import { FileText, Pencil, Plus, Printer, Search, Trash2 } from 'lucide-react';
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
import {
  blankLine,
  draftFromLines,
  draftTotals,
  LineItemsEditor,
  payloadLines,
  type DraftLine,
} from '../components/LineItemsEditor';
import type { OrderLine, Partner, Product, Quotation, QuotationLine, Warehouse } from '../types';

const STATUSES = ['draft', 'sent', 'accepted', 'expired', 'converted', 'cancelled'] as const;

function QuoteForm({
  quote,
  initialLines,
  customers,
  products,
  warehouses,
  onSaved,
  onClose,
}: {
  quote: Quotation | null;
  initialLines: QuotationLine[];
  customers: Partner[];
  products: Product[];
  warehouses: Warehouse[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [customerId, setCustomerId] = useState(
    String(quote?.customer_id ?? customers[0]?.id ?? ''),
  );
  const [warehouseId, setWarehouseId] = useState(
    String(quote?.warehouse_id ?? warehouses[0]?.id ?? ''),
  );
  const [quoteDate, setQuoteDate] = useState(quote?.quote_date ?? today());
  const [validUntil, setValidUntil] = useState(quote?.valid_until ?? '');
  const [notes, setNotes] = useState(quote?.notes ?? '');
  const [lines, setLines] = useState<DraftLine[]>(() =>
    quote ? draftFromLines(initialLines as unknown as OrderLine[], 'price') : [blankLine()],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const totals = draftTotals(lines);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        customerId: Number(customerId),
        warehouseId: warehouseId ? Number(warehouseId) : null,
        quoteDate,
        validUntil: validUntil || null,
        notes: notes || null,
        lines: payloadLines(lines, 'price'),
      };
      if (quote) await api.put(`/quotations/${quote.id}`, body);
      else await api.post('/quotations', body);
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
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Customer">
          <select
            className={inputCls}
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
            required
          >
            <option value="">Select customer…</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Branch">
          <select
            className={inputCls}
            value={warehouseId}
            onChange={(event) => setWarehouseId(event.target.value)}
          >
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quote date">
          <input
            className={inputCls}
            type="date"
            value={quoteDate}
            onChange={(event) => setQuoteDate(event.target.value)}
            required
          />
        </Field>
        <Field label="Valid until">
          <input
            className={inputCls}
            type="date"
            value={validUntil}
            onChange={(event) => setValidUntil(event.target.value)}
          />
        </Field>
      </div>
      <LineItemsEditor lines={lines} products={products} priceKind="price" onChange={setLines} />
      <div className="rounded-lg bg-slate-50 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Subtotal</span>
          <span className="font-semibold">{money(totals.subtotalCents)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">VAT</span>
          <span className="font-semibold">{money(totals.taxCents)}</span>
        </div>
        <div className="flex justify-between text-base">
          <span className="font-bold text-slate-900">Total</span>
          <span className="font-bold text-emerald-700">{money(totals.totalCents)}</span>
        </div>
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
          {busy ? 'Saving…' : quote ? 'Save changes' : 'Create quotation'}
        </button>
      </div>
    </form>
  );
}

function QuoteDetail({
  quoteId,
  onChanged,
  onClose,
}: {
  quoteId: number;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { can } = useAuth();
  const detail = useFetch<{ quotation: Quotation }>(`/quotations/${quoteId}`, [quoteId]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const quote = detail.data?.quotation;

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

  return (
    <div className="space-y-4">
      {error ? <ErrorBox message={error} /> : null}
      {detail.loading && !quote ? (
        <Spinner />
      ) : detail.error ? (
        <ErrorBox message={detail.error} />
      ) : quote ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Quotation</p>
              <p className="font-mono text-sm font-bold">{quote.number}</p>
              <p className="text-xs text-slate-400">{shortDate(quote.quote_date)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Customer</p>
              <p className="font-semibold">{quote.customer_name}</p>
              <p className="text-xs text-slate-400">{quote.warehouse_name ?? 'No branch'}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Status</p>
              <Badge value={quote.status} />
              <p className="mt-1 text-xs text-slate-400">
                Valid until {shortDate(quote.valid_until)}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Item</th>
                  <th className={`${thCls} text-right`}>Qty</th>
                  <th className={`${thCls} text-right`}>Price</th>
                  <th className={`${thCls} text-right`}>VAT</th>
                  <th className={`${thCls} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {(quote.lines ?? []).map((line) => (
                  <tr key={line.id}>
                    <td className={tdCls}>{line.description}</td>
                    <td className={`${tdCls} text-right`}>{line.quantity}</td>
                    <td className={`${tdCls} text-right`}>{money(line.unit_price_cents)}</td>
                    <td className={`${tdCls} text-right`}>{money(line.line_tax_cents)}</td>
                    <td className={`${tdCls} text-right font-semibold`}>
                      {money(line.line_total_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {can('sales.manage') && quote.status === 'draft' ? (
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={busy}
                  onClick={() => void run(`/quotations/${quote.id}/status`, { status: 'sent' })}
                >
                  Mark sent
                </button>
              ) : null}
              {can('sales.manage') &&
              quote.status !== 'converted' &&
              quote.status !== 'cancelled' ? (
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={busy}
                  onClick={() => void run(`/quotations/${quote.id}/convert`)}
                >
                  Convert to sales order
                </button>
              ) : null}
              {can('sales.manage') && quote.status !== 'converted' ? (
                <button
                  type="button"
                  className={btnSecondary}
                  disabled={busy}
                  onClick={() =>
                    void run(`/quotations/${quote.id}/status`, { status: 'cancelled' })
                  }
                >
                  Cancel
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className={btnSecondary}
              onClick={() => window.open(`/print/quotation/${quote.id}`, '_blank')}
            >
              <Printer className="size-4" /> Print / PDF
            </button>
          </div>

          <div className="flex justify-end">
            <button type="button" className={btnSecondary} onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function QuotationsPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<
    { quote: Quotation; lines: QuotationLine[] } | 'new' | null
  >(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (query) params.set('q', query);

  const quotes = useFetch<{ quotations: Quotation[] }>(`/quotations?${params}`, [status, query]);
  const customers = useFetch<{ partners: Partner[] }>('/partners?type=customer&limit=500');
  const products = useFetch<{ products: Product[] }>('/products?limit=1000');
  const warehouses = useFetch<{ warehouses: Warehouse[] }>('/inventory/warehouses');

  const openEdit = async (quote: Quotation) => {
    setError(null);
    try {
      const detail = await api.get<{ quotation: Quotation }>(`/quotations/${quote.id}`);
      setEditing({ quote: detail.quotation, lines: detail.quotation.lines ?? [] });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = async (quote: Quotation) => {
    if (!window.confirm(`Delete ${quote.number}?`)) return;
    setError(null);
    try {
      await api.del(`/quotations/${quote.id}`);
      quotes.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const rows = quotes.data?.quotations ?? [];

  return (
    <>
      <PageHeader
        title="Quotations"
        subtitle="Branded quotes that convert into sales orders"
        actions={
          can('sales.manage') ? (
            <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
              <Plus className="size-4" /> New quotation
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
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
          <input
            className={`${inputCls} pl-9`}
            placeholder="Search number or customer…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {quotes.loading && !quotes.data ? (
        <Spinner />
      ) : quotes.error ? (
        <ErrorBox message={quotes.error} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr>
                <th className={thCls}>Number</th>
                <th className={thCls}>Customer</th>
                <th className={thCls}>Branch</th>
                <th className={thCls}>Quoted</th>
                <th className={thCls}>Valid until</th>
                <th className={thCls}>Status</th>
                <th className={`${thCls} text-right`}>Total</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyState colSpan={8} message="No quotations yet." />
              ) : (
                rows.map((quote) => (
                  <tr key={quote.id} className="hover:bg-slate-50">
                    <td className={`${tdCls} font-mono text-xs font-semibold`}>{quote.number}</td>
                    <td className={tdCls}>
                      <p className="font-semibold text-slate-800">{quote.customer_name}</p>
                      <p className="text-xs text-slate-400">{quote.line_count ?? 0} line(s)</p>
                    </td>
                    <td className={tdCls}>{quote.warehouse_name ?? '—'}</td>
                    <td className={tdCls}>{shortDate(quote.quote_date)}</td>
                    <td className={tdCls}>{shortDate(quote.valid_until)}</td>
                    <td className={tdCls}>
                      <Badge value={quote.status} />
                    </td>
                    <td className={`${tdCls} text-right font-semibold`}>
                      {money(quote.total_cents)}
                    </td>
                    <td className={tdCls}>
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className={btnGhost}
                          onClick={() => setDetailId(quote.id)}
                        >
                          <FileText className="size-3.5" /> Open
                        </button>
                        {can('sales.manage') && quote.status === 'draft' ? (
                          <button
                            type="button"
                            className={btnGhost}
                            onClick={() => void openEdit(quote)}
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        ) : null}
                        {can('sales.manage') &&
                        (quote.status === 'draft' || quote.status === 'cancelled') ? (
                          <button
                            type="button"
                            className={btnGhost}
                            onClick={() => void remove(quote)}
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

      {editing ? (
        <Modal
          title={editing === 'new' ? 'New quotation' : `Edit ${editing.quote.number}`}
          onClose={() => setEditing(null)}
          wide
        >
          <QuoteForm
            quote={editing === 'new' ? null : editing.quote}
            initialLines={editing === 'new' ? [] : editing.lines}
            customers={customers.data?.partners ?? []}
            products={products.data?.products ?? []}
            warehouses={warehouses.data?.warehouses ?? []}
            onSaved={() => quotes.reload()}
            onClose={() => setEditing(null)}
          />
        </Modal>
      ) : null}

      {detailId ? (
        <Modal title="Quotation" onClose={() => setDetailId(null)} wide>
          <QuoteDetail
            quoteId={detailId}
            onChanged={() => quotes.reload()}
            onClose={() => setDetailId(null)}
          />
        </Modal>
      ) : null}
    </>
  );
}
