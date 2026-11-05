import { useParams } from 'react-router-dom';
import { useFetch } from '../lib/useFetch';
import { money, shortDate } from '../lib/format';
import { ErrorBox, Spinner } from '../components/ui';
import { BrandedDocument } from '../components/BrandedDocument';
import type { Invoice, Payment } from '../types';

interface InvoiceDetail {
  invoice: Invoice;
  payments: Payment[];
}

export default function PrintInvoicePage() {
  const { id } = useParams();
  const invoice = useFetch<InvoiceDetail>(id ? `/invoices/${id}` : null, [id]);
  const settings = useFetch<{ settings: Record<string, string> }>('/settings');

  if (invoice.loading && !invoice.data) return <Spinner />;
  if (invoice.error) return <ErrorBox message={invoice.error} />;
  if (!invoice.data?.invoice) return null;

  const inv = invoice.data.invoice;
  const s = settings.data?.settings ?? {};
  const title = inv.direction === 'sale' ? 'Tax Invoice' : 'Supplier Bill';
  const outstanding = inv.total_cents - inv.amount_paid_cents - (inv.credited_cents ?? 0);

  return (
    <BrandedDocument
      settings={s}
      title={title}
      number={inv.number}
      date={inv.issue_date}
      meta={[
        { label: 'Due', value: shortDate(inv.due_date) },
        ...(inv.warehouse_name ? [{ label: 'Branch', value: inv.warehouse_name }] : []),
      ]}
      footer={
        <p className="text-center text-xs text-slate-400">
          {inv.direction === 'sale'
            ? 'Thank you for your business. Please quote the invoice number with payment.'
            : 'Supplier bill captured in vula-erp.'}
        </p>
      }
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
            {inv.direction === 'sale' ? 'Bill to' : 'Supplier'}
          </p>
          <p className="font-semibold text-slate-900">{inv.partner_name}</p>
        </div>
        <div className="sm:text-right">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Status</p>
          <p className="font-semibold capitalize text-slate-800">{inv.status}</p>
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
          {(inv.lines ?? []).map((line) => (
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
          <span>{money(inv.subtotal_cents)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">VAT</span>
          <span>{money(inv.tax_cents)}</span>
        </div>
        <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold">
          <span>Total</span>
          <span>{money(inv.total_cents)}</span>
        </div>
        {inv.amount_paid_cents > 0 ? (
          <div className="flex justify-between text-slate-600">
            <span>Paid</span>
            <span>− {money(inv.amount_paid_cents)}</span>
          </div>
        ) : null}
        {(inv.credited_cents ?? 0) > 0 ? (
          <div className="flex justify-between text-slate-600">
            <span>Credited</span>
            <span>− {money(inv.credited_cents ?? 0)}</span>
          </div>
        ) : null}
        <div className="flex justify-between border-t border-slate-200 pt-2 font-bold text-emerald-700">
          <span>Outstanding</span>
          <span>{money(outstanding)}</span>
        </div>
      </div>

      {invoice.data.payments.length > 0 ? (
        <div className="mt-6 border-t border-slate-200 pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Payments</p>
          <table className="mt-2 w-full text-left text-sm">
            <tbody>
              {invoice.data.payments.map((payment) => (
                <tr key={payment.id} className="border-b border-slate-100">
                  <td className="py-1 font-mono text-xs">{payment.number}</td>
                  <td className="py-1">{shortDate(payment.payment_date)}</td>
                  <td className="py-1">{payment.method ?? '—'}</td>
                  <td className="py-1 text-right">{money(payment.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {inv.notes ? (
        <div className="mt-6 border-t border-slate-200 pt-4 text-sm text-slate-600">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Notes</p>
          <p className="whitespace-pre-wrap">{inv.notes}</p>
        </div>
      ) : null}
    </BrandedDocument>
  );
}
