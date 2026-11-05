import { useParams } from 'react-router-dom';
import { useFetch } from '../lib/useFetch';
import { money, shortDate } from '../lib/format';
import { ErrorBox, Spinner } from '../components/ui';
import type { Quotation } from '../types';

export default function PrintQuotationPage() {
  const { id } = useParams();
  const quote = useFetch<{ quotation: Quotation }>(id ? `/quotations/${id}` : null, [id]);
  const settings = useFetch<{ settings: Record<string, string> }>('/settings');

  if (quote.loading && !quote.data) return <Spinner />;
  if (quote.error) return <ErrorBox message={quote.error} />;
  if (!quote.data?.quotation) return null;

  const q = quote.data.quotation;
  const s = settings.data?.settings ?? {};
  const company = s.company_name ?? 'vula-erp';

  return (
    <div className="min-h-full bg-slate-100 p-4 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl rounded-xl bg-white p-8 shadow print:max-w-none print:rounded-none print:p-0 print:shadow-none">
        <div className="mb-6 flex items-start justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <h1 className="text-2xl font-black text-slate-900">{company}</h1>
            <p className="text-sm text-slate-500">{s.company_address ?? ''}</p>
            <p className="text-sm text-slate-500">
              {s.company_email ?? ''} {s.company_phone ? `· ${s.company_phone}` : ''}
            </p>
            {s.company_vat_number ? (
              <p className="text-xs text-slate-400">VAT {s.company_vat_number}</p>
            ) : null}
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">
              Quotation
            </p>
            <p className="font-mono text-lg font-bold">{q.number}</p>
            <p className="text-xs text-slate-500">{shortDate(q.quote_date)}</p>
            {q.valid_until ? (
              <p className="text-xs text-slate-500">Valid until {shortDate(q.valid_until)}</p>
            ) : null}
          </div>
        </div>

        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Quote for</p>
            <p className="font-semibold text-slate-900">{q.customer_name}</p>
            {q.customer_address ? (
              <p className="text-sm text-slate-600">{q.customer_address}</p>
            ) : null}
            {q.customer_email ? <p className="text-sm text-slate-600">{q.customer_email}</p> : null}
            {q.customer_vat_number ? (
              <p className="text-xs text-slate-400">VAT {q.customer_vat_number}</p>
            ) : null}
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Branch</p>
            <p className="text-sm text-slate-700">{q.warehouse_name ?? '—'}</p>
          </div>
        </div>

        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
              <th className="py-2">Description</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit price</th>
              <th className="py-2 text-right">VAT</th>
              <th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {(q.lines ?? []).map((line) => (
              <tr key={line.id} className="border-b border-slate-100">
                <td className="py-2 text-slate-800">{line.description}</td>
                <td className="py-2 text-right">{line.quantity}</td>
                <td className="py-2 text-right">{money(line.unit_price_cents)}</td>
                <td className="py-2 text-right">{money(line.line_tax_cents)}</td>
                <td className="py-2 text-right font-semibold">{money(line.line_total_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-5 ml-auto w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Subtotal</span>
            <span>{money(q.subtotal_cents)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">VAT</span>
            <span>{money(q.tax_cents)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold">
            <span>Total</span>
            <span>{money(q.total_cents)}</span>
          </div>
        </div>

        {q.notes ? (
          <div className="mt-6 border-t border-slate-200 pt-4 text-sm text-slate-600">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Notes</p>
            <p className="whitespace-pre-wrap">{q.notes}</p>
          </div>
        ) : null}

        <p className="mt-8 text-center text-xs text-slate-400">
          This quotation is valid until the date shown above. Prices are exclusive of VAT unless
          stated otherwise.
        </p>

        <div className="mt-8 flex justify-end print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Print / Save as PDF
          </button>
        </div>
      </div>
    </div>
  );
}
