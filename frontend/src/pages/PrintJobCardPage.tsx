import { useParams } from 'react-router-dom';
import { useFetch } from '../lib/useFetch';
import { money, shortDate, titleCase } from '../lib/format';
import { ErrorBox, Spinner } from '../components/ui';
import { BrandedDocument } from '../components/BrandedDocument';
import type { WorkshopJob } from '../types';

export default function PrintJobCardPage() {
  const { id } = useParams();
  const job = useFetch<{ job: WorkshopJob }>(id ? `/workshop/jobs/${id}` : null, [id]);
  const settings = useFetch<{ settings: Record<string, string> }>('/settings');

  if (job.loading && !job.data) return <Spinner />;
  if (job.error) return <ErrorBox message={job.error} />;
  if (!job.data?.job) return null;

  const data = job.data.job;
  const s = settings.data?.settings ?? {};
  const totalCost = data.material_cost_cents + data.labour_cost_cents + data.expense_cost_cents;

  return (
    <BrandedDocument
      settings={s}
      title="Workshop Job Card"
      number={data.number}
      date={data.due_date ?? new Date().toISOString().slice(0, 10)}
      meta={[
        { label: 'Status', value: titleCase(data.status) },
        { label: 'Priority', value: titleCase(data.priority) },
        ...(data.invoice_number ? [{ label: 'Invoice', value: data.invoice_number }] : []),
      ]}
      footer={
        <p className="text-center text-xs text-slate-400">
          Workshop copy — keep with the job until collection.
        </p>
      }
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Customer</p>
          <p className="font-semibold text-slate-900">{data.customer_name ?? 'Walk-in'}</p>
          {data.assignee_name ? (
            <p className="text-sm text-slate-600">Assigned to {data.assignee_name}</p>
          ) : null}
        </div>
        <div className="sm:text-right">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Due</p>
          <p className="font-semibold text-slate-900">{shortDate(data.due_date)}</p>
          <p className="text-xs text-slate-500">
            Payment required: {data.payment_required ? 'Yes' : 'No'}
          </p>
        </div>
      </div>

      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Job</p>
        <p className="text-lg font-bold text-slate-900">{data.title}</p>
        {data.notes ? <p className="mt-1 text-sm text-slate-600">{data.notes}</p> : null}
      </div>

      <div className="mb-6">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Operations</p>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
              <th className="py-2">#</th>
              <th className="py-2">Operation</th>
              <th className="py-2">Assignee</th>
              <th className="py-2">Status</th>
              <th className="py-2">Started</th>
              <th className="py-2">Finished</th>
            </tr>
          </thead>
          <tbody>
            {(data.operations ?? []).length === 0 ? (
              <tr>
                <td colSpan={6} className="py-3 text-center text-slate-400">
                  No operations captured.
                </td>
              </tr>
            ) : (
              (data.operations ?? []).map((operation) => (
                <tr key={operation.id} className="border-b border-slate-100">
                  <td className="py-1.5">{operation.sequence}</td>
                  <td className="py-1.5 font-medium text-slate-800">{operation.name}</td>
                  <td className="py-1.5">{operation.assignee_name ?? '—'}</td>
                  <td className="py-1.5 capitalize">{titleCase(operation.status)}</td>
                  <td className="py-1.5">{shortDate(operation.started_at)}</td>
                  <td className="py-1.5">{shortDate(operation.finished_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Cutting list</p>
        {data.cutting_list_notes ? (
          <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            {data.cutting_list_notes}
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-400">No cutting list notes.</p>
        )}
        {(data.files ?? []).length > 0 ? (
          <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">
            {(data.files ?? []).map((file) => (
              <li key={file.id}>
                {file.filename} ({(file.size_bytes / 1024).toFixed(1)} KB)
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Quoted</span>
          <span>{money(data.quoted_cents)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Materials</span>
          <span>{money(data.material_cost_cents)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Labour</span>
          <span>{money(data.labour_cost_cents)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Expenses</span>
          <span>{money(data.expense_cost_cents)}</span>
        </div>
        <div className="flex justify-between border-t border-slate-200 pt-2 font-bold">
          <span>Total cost</span>
          <span>{money(totalCost)}</span>
        </div>
        <div className="flex justify-between font-bold text-emerald-700">
          <span>Margin</span>
          <span>{money(data.quoted_cents - totalCost)}</span>
        </div>
      </div>
    </BrandedDocument>
  );
}
