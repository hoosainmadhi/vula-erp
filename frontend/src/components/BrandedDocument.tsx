import type { ReactNode } from 'react';
import { shortDate } from '../lib/format';

export interface DocumentMeta {
  label: string;
  value: string;
}

export function BrandedDocument({
  settings,
  title,
  number,
  date,
  meta = [],
  children,
  footer,
}: {
  settings: Record<string, string>;
  title: string;
  number: string;
  date: string;
  meta?: DocumentMeta[];
  children: ReactNode;
  footer?: ReactNode;
}) {
  const company = settings.company_name ?? 'vula-erp';
  return (
    <div className="min-h-full bg-slate-100 p-4 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl rounded-xl bg-white p-8 shadow print:max-w-none print:rounded-none print:p-0 print:shadow-none">
        <div className="mb-6 flex items-start justify-between gap-6 border-b border-slate-200 pb-5">
          <div className="flex items-start gap-4">
            {settings.company_logo ? (
              <img
                src={settings.company_logo}
                alt={company}
                className="h-16 w-auto max-w-40 object-contain"
              />
            ) : null}
            <div>
              <h1 className="text-2xl font-black text-slate-900">{company}</h1>
              {settings.company_address ? (
                <p className="max-w-xs text-sm text-slate-500">{settings.company_address}</p>
              ) : null}
              <p className="text-sm text-slate-500">
                {settings.company_email ?? ''}
                {settings.company_phone ? ` · ${settings.company_phone}` : ''}
              </p>
              {settings.company_vat_number ? (
                <p className="text-xs text-slate-400">VAT {settings.company_vat_number}</p>
              ) : null}
              {settings.company_registration ? (
                <p className="text-xs text-slate-400">Reg {settings.company_registration}</p>
              ) : null}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">{title}</p>
            <p className="font-mono text-lg font-bold">{number}</p>
            <p className="text-xs text-slate-500">{shortDate(date)}</p>
            {meta.map((item) => (
              <p key={item.label} className="text-xs text-slate-500">
                {item.label}: <span className="font-medium text-slate-700">{item.value}</span>
              </p>
            ))}
          </div>
        </div>

        {children}

        {footer ? <div className="mt-8 border-t border-slate-200 pt-4">{footer}</div> : null}

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
