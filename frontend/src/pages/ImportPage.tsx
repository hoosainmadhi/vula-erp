import { useRef, useState, type FormEvent } from 'react';
import { Upload } from 'lucide-react';
import { api, errorMessage } from '../api';
import {
  btnPrimary,
  btnSecondary,
  Card,
  ErrorBox,
  Field,
  inputCls,
  PageHeader,
} from '../components/ui';
import type { ImportResult } from '../types';

const PRODUCT_SAMPLE = `sku,name,category,sale_price,cost,barcode,brand,colour,size,thickness
JB-MDF-16-WH,White melamine 16mm,Boards,899.00,620.00,6001234567890,Jabulani,White,2440x1220,16`;

const PARTNER_SAMPLE = `name,email,phone,vat_number,address_line1,city,province,postal_code,is_customer,is_supplier
Acme Kitchens,orders@acme.co.za,0115550100,4123456789,12 Main Road,Johannesburg,Gauteng,2001,true,false`;

export default function ImportPage() {
  const [kind, setKind] = useState<'products' | 'partners'>('products');
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const sample = kind === 'products' ? PRODUCT_SAMPLE : PARTNER_SAMPLE;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await api.post<ImportResult>(`/imports/${kind}`, { csv });
      setResult(response);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setCsv(await file.text());
  };

  return (
    <>
      <PageHeader
        title="Data import"
        subtitle="Load products or partners from CSV, including Odoo exports"
      />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="p-4">
          <form onSubmit={submit} className="space-y-3">
            {error ? <ErrorBox message={error} /> : null}
            <div className="flex flex-wrap items-end gap-2">
              <Field label="What are you importing?" className="w-56">
                <select
                  className={inputCls}
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as 'products' | 'partners');
                    setResult(null);
                  }}
                >
                  <option value="products">Products</option>
                  <option value="partners">Customers & suppliers</option>
                </select>
              </Field>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => void readFile(e.target.files?.[0])}
              />
              <button
                type="button"
                className={btnSecondary}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="size-4" /> Choose CSV
              </button>
              <button type="button" className={btnSecondary} onClick={() => setCsv(sample)}>
                Use sample
              </button>
            </div>
            <Field label="CSV contents">
              <textarea
                className={`${inputCls} font-mono text-xs`}
                rows={14}
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                placeholder={sample}
                required
              />
            </Field>
            <div className="flex justify-end">
              <button type="submit" className={btnPrimary} disabled={busy || !csv.trim()}>
                {busy ? 'Importing…' : `Import ${kind}`}
              </button>
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          {result ? (
            <Card className="p-4">
              <p className="text-sm font-bold text-slate-900">Import complete</p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-emerald-50 p-2">
                  <p className="text-xs text-emerald-700">Created</p>
                  <p className="text-lg font-bold text-emerald-800">{result.created}</p>
                </div>
                <div className="rounded-lg bg-sky-50 p-2">
                  <p className="text-xs text-sky-700">Updated</p>
                  <p className="text-lg font-bold text-sky-800">{result.updated}</p>
                </div>
                <div className="rounded-lg bg-slate-100 p-2">
                  <p className="text-xs text-slate-600">Rows</p>
                  <p className="text-lg font-bold text-slate-800">{result.total}</p>
                </div>
              </div>
              {result.errors.length ? (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-red-600">
                    {result.errors.length} row(s) skipped
                  </p>
                  <ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-5 text-xs text-red-600">
                    {result.errors.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>
          ) : null}

          <Card className="p-4 text-sm text-slate-600">
            <p className="font-bold text-slate-900">Column reference</p>
            {kind === 'products' ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                <li>
                  <span className="font-mono">sku</span> or Odoo{' '}
                  <span className="font-mono">default_code</span> (required)
                </li>
                <li>
                  <span className="font-mono">name</span> (required)
                </li>
                <li>
                  <span className="font-mono">sale_price</span> or Odoo{' '}
                  <span className="font-mono">list_price</span>
                </li>
                <li>
                  <span className="font-mono">cost</span> or Odoo{' '}
                  <span className="font-mono">standard_price</span>
                </li>
                <li>
                  <span className="font-mono">barcode</span>,{' '}
                  <span className="font-mono">category</span>,{' '}
                  <span className="font-mono">brand</span>,{' '}
                  <span className="font-mono">colour</span>, <span className="font-mono">size</span>
                  , <span className="font-mono">thickness</span>,{' '}
                  <span className="font-mono">tax_rate_bp</span>
                </li>
              </ul>
            ) : (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                <li>
                  <span className="font-mono">name</span> (required)
                </li>
                <li>
                  <span className="font-mono">email</span>, <span className="font-mono">phone</span>
                  , <span className="font-mono">vat_number</span>,{' '}
                  <span className="font-mono">contact_name</span>
                </li>
                <li>
                  <span className="font-mono">address_line1</span>,{' '}
                  <span className="font-mono">city</span>,{' '}
                  <span className="font-mono">province</span>,{' '}
                  <span className="font-mono">postal_code</span>,{' '}
                  <span className="font-mono">country</span>
                </li>
                <li>
                  <span className="font-mono">is_customer</span>,{' '}
                  <span className="font-mono">is_supplier</span>
                </li>
              </ul>
            )}
            <p className="mt-3 text-xs text-slate-400">
              Existing products are matched by SKU and partners by name, so re-importing updates
              rather than duplicates.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
