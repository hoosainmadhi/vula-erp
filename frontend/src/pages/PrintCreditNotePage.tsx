import { useParams } from 'react-router-dom';
import { useFetch } from '../lib/useFetch';
import { money, shortDate } from '../lib/format';
import { ErrorBox, Spinner } from '../components/ui';
import { BrandedDocument } from '../components/BrandedDocument';
import type { CreditNote } from '../types';

export default function PrintCreditNotePage() {
  const { id } = useParams();
  const creditNote = useFetch<{ creditNote: CreditNote }>(id ? `/credit-notes/${id}` : null, [id]);
  const settings = useFetch<{ settings: Record<string, string> }>('/settings');

  if (creditNote.loading && !creditNote.data) return <Spinner />;
  if (creditNote.error) return <ErrorBox message={creditNote.error} />;
  if (!creditNote.data?.creditNote) return null;

  const note = creditNote.data.creditNote;
  const s = settings.data?.settings ?? {};

  return (
    <BrandedDocument
      settings={s}
      title="Credit Note"
      number={note.number}
      date={note.issue_date}
      meta={[
        { label: 'Invoice', value: note.invoice_number },
        { label: 'Status', value: note.status },
      ]}
      footer={
        <p className="text-center text-xs text-slate-400">
          This credit note reduces the balance of invoice {note.invoice_number}.
        </p>
      }
    >
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Credit to</p>
        <p className="font-semibold text-slate-900">{note.partner_name}</p>
        {note.reason ? <p className="mt-1 text-sm text-slate-600">Reason: {note.reason}</p> : null}
      </div>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
            <th className="py-2">Description</th>
            <th className="py-2 text-right">Net</th>
            <th className="py-2 text-right">VAT</th>
            <th className="py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-100">
            <td className="py-2 text-slate-800">
              Credit against invoice {note.invoice_number}
              {note.reason ? ` — ${note.reason}` : ''}
            </td>
            <td className="py-2 text-right">{money(note.subtotal_cents)}</td>
            <td className="py-2 text-right">{money(note.tax_cents)}</td>
            <td className="py-2 text-right font-semibold">{money(note.total_cents)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-5 ml-auto w-full max-w-xs space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Net credit</span>
          <span>{money(note.subtotal_cents)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">VAT</span>
          <span>{money(note.tax_cents)}</span>
        </div>
        <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-emerald-700">
          <span>Total credit</span>
          <span>{money(note.total_cents)}</span>
        </div>
      </div>

      <p className="mt-6 text-xs text-slate-400">Issued {shortDate(note.issue_date)}</p>
    </BrandedDocument>
  );
}
