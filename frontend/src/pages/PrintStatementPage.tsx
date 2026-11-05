import { useParams, useSearchParams } from 'react-router-dom';
import { useFetch } from '../lib/useFetch';
import { money, shortDate } from '../lib/format';
import { ErrorBox, Spinner } from '../components/ui';
import { BrandedDocument } from '../components/BrandedDocument';
import type { Partner } from '../types';

interface StatementInvoice {
  id: number;
  number: string;
  issue_date: string;
  due_date: string;
  total_cents: number;
  amount_paid_cents: number;
  credited_cents: number;
  outstanding_cents: number;
  status: string;
}

interface StatementPayment {
  id: number;
  number: string;
  payment_date: string;
  amount_cents: number;
  method: string;
  reference: string | null;
}

interface StatementCreditNote {
  id: number;
  number: string;
  issue_date: string;
  total_cents: number;
  reason: string | null;
  invoice_number: string;
}

interface StatementResponse {
  partner: Partner;
  direction: 'sale' | 'purchase';
  from: string;
  to: string;
  invoices: StatementInvoice[];
  payments: StatementPayment[];
  creditNotes: StatementCreditNote[];
}

type Line = {
  date: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
};

export default function PrintStatementPage() {
  const { partnerId } = useParams();
  const [params] = useSearchParams();
  const direction = params.get('direction') === 'purchase' ? 'purchase' : 'sale';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const query = new URLSearchParams({ direction });
  if (from) query.set('from', from);
  if (to) query.set('to', to);

  const statement = useFetch<StatementResponse>(
    partnerId ? `/partners/${partnerId}/statement?${query.toString()}` : null,
    [partnerId, direction, from, to],
  );
  const settings = useFetch<{ settings: Record<string, string> }>('/settings');

  if (statement.loading && !statement.data) return <Spinner />;
  if (statement.error) return <ErrorBox message={statement.error} />;
  if (!statement.data) return null;

  const data = statement.data;
  const s = settings.data?.settings ?? {};
  const lines: Line[] = [
    ...data.invoices.map((invoice) => ({
      date: invoice.issue_date,
      reference: invoice.number,
      description: `Invoice ${invoice.number}${invoice.due_date ? ` (due ${shortDate(invoice.due_date)})` : ''}`,
      debit: invoice.total_cents,
      credit: 0,
    })),
    ...data.payments.map((payment) => ({
      date: payment.payment_date,
      reference: payment.number,
      description: `Payment ${payment.method}${payment.reference ? ` — ${payment.reference}` : ''}`,
      debit: 0,
      credit: payment.amount_cents,
    })),
    ...data.creditNotes.map((note) => ({
      date: note.issue_date,
      reference: note.number,
      description: `Credit note against ${note.invoice_number}${note.reason ? ` — ${note.reason}` : ''}`,
      debit: 0,
      credit: note.total_cents,
    })),
  ].sort((a, b) =>
    a.date === b.date ? a.reference.localeCompare(b.reference) : a.date.localeCompare(b.date),
  );

  let balance = 0;
  const rows = lines.map((line) => {
    balance += line.debit - line.credit;
    return { ...line, balance };
  });

  return (
    <BrandedDocument
      settings={s}
      title={direction === 'sale' ? 'Customer Statement' : 'Supplier Statement'}
      number={data.partner.name}
      date={to || data.to}
      meta={[
        { label: 'From', value: from ? shortDate(from) : 'Opening' },
        { label: 'To', value: shortDate(to || data.to) },
      ]}
      footer={
        <p className="text-center text-xs text-slate-400">
          Please settle the closing balance or contact us with any queries.
        </p>
      }
    >
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
          {direction === 'sale' ? 'Customer' : 'Supplier'}
        </p>
        <p className="font-semibold text-slate-900">{data.partner.name}</p>
        {data.partner.email ? <p className="text-sm text-slate-600">{data.partner.email}</p> : null}
        {data.partner.phone ? <p className="text-sm text-slate-600">{data.partner.phone}</p> : null}
        {data.partner.vat_number ? (
          <p className="text-xs text-slate-400">VAT {data.partner.vat_number}</p>
        ) : null}
      </div>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
            <th className="py-2">Date</th>
            <th className="py-2">Reference</th>
            <th className="py-2">Description</th>
            <th className="py-2 text-right">Debit</th>
            <th className="py-2 text-right">Credit</th>
            <th className="py-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-4 text-center text-slate-400">
                No transactions in this period.
              </td>
            </tr>
          ) : (
            rows.map((line) => (
              <tr key={`${line.reference}-${line.date}`} className="border-b border-slate-100">
                <td className="py-1.5">{shortDate(line.date)}</td>
                <td className="py-1.5 font-mono text-xs">{line.reference}</td>
                <td className="py-1.5 text-slate-700">{line.description}</td>
                <td className="py-1.5 text-right">{line.debit ? money(line.debit) : '—'}</td>
                <td className="py-1.5 text-right">{line.credit ? money(line.credit) : '—'}</td>
                <td className="py-1.5 text-right font-semibold">{money(line.balance)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="mt-5 ml-auto w-full max-w-xs space-y-1 text-sm">
        <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold">
          <span>Closing balance</span>
          <span className={balance > 0 ? 'text-red-600' : 'text-emerald-700'}>
            {money(balance)}
          </span>
        </div>
      </div>
    </BrandedDocument>
  );
}
