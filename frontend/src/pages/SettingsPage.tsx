import { useEffect, useState, type FormEvent } from 'react';
import { Building2, Save } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useFetch } from '../lib/useFetch';
import {
  btnPrimary,
  btnSecondary,
  Card,
  ErrorBox,
  Field,
  inputCls,
  PageHeader,
  Spinner,
} from '../components/ui';
import type { Warehouse } from '../types';

interface SettingsResponse {
  settings: Record<string, string>;
}

interface FormState {
  company_name: string;
  company_registration: string;
  company_vat_number: string;
  company_email: string;
  company_phone: string;
  company_address: string;
  currency: string;
  vatRatePercent: string;
  invoice_due_days: string;
  fiscal_year_start: string;
  default_warehouse_id: string;
}

const EMPTY_FORM: FormState = {
  company_name: '',
  company_registration: '',
  company_vat_number: '',
  company_email: '',
  company_phone: '',
  company_address: '',
  currency: 'ZAR',
  vatRatePercent: '15',
  invoice_due_days: '30',
  fiscal_year_start: '03-01',
  default_warehouse_id: '',
};

function formFromSettings(settings: Record<string, string>): FormState {
  const rateBp = Number(settings.vat_rate_bp ?? '1500');
  return {
    company_name: settings.company_name ?? '',
    company_registration: settings.company_registration ?? '',
    company_vat_number: settings.company_vat_number ?? '',
    company_email: settings.company_email ?? '',
    company_phone: settings.company_phone ?? '',
    company_address: settings.company_address ?? '',
    currency: settings.currency ?? 'ZAR',
    vatRatePercent: String((Number.isFinite(rateBp) ? rateBp : 1500) / 100),
    invoice_due_days: settings.invoice_due_days ?? '30',
    fiscal_year_start: settings.fiscal_year_start ?? '03-01',
    default_warehouse_id: settings.default_warehouse_id ?? '',
  };
}

export default function SettingsPage() {
  const settings = useFetch<SettingsResponse>('/settings');
  const warehouses = useFetch<{ warehouses: Warehouse[] }>('/inventory/warehouses');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings.data) setForm(formFromSettings(settings.data.settings));
  }, [settings.data]);

  const update = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload: Record<string, string> = {
        company_name: form.company_name,
        company_registration: form.company_registration,
        company_vat_number: form.company_vat_number,
        company_email: form.company_email,
        company_phone: form.company_phone,
        company_address: form.company_address,
        currency: form.currency || 'ZAR',
        vat_rate_bp: String(Math.round((Number(form.vatRatePercent) || 0) * 100)),
        invoice_due_days: String(Math.max(0, Math.round(Number(form.invoice_due_days) || 0))),
        fiscal_year_start: form.fiscal_year_start,
      };
      if (form.default_warehouse_id) payload.default_warehouse_id = form.default_warehouse_id;
      await api.put<SettingsResponse>('/settings', { settings: payload });
      settings.reload();
      setNotice('Settings saved.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (settings.loading && !settings.data) return <Spinner />;
  if (settings.error) return <ErrorBox message={settings.error} />;

  return (
    <form onSubmit={submit}>
      <PageHeader
        title="Settings"
        subtitle="Company profile, VAT and accounting defaults"
        actions={
          <>
            <button type="button" className={btnSecondary} onClick={() => settings.reload()}>
              Discard changes
            </button>
            <button type="submit" className={btnPrimary} disabled={busy}>
              <Save className="size-4" /> {busy ? 'Saving…' : 'Save settings'}
            </button>
          </>
        }
      />

      {error ? <ErrorBox message={error} /> : null}
      {notice ? (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <Building2 className="size-4 text-emerald-600" />
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
              Company profile
            </h2>
          </div>
          <div className="space-y-3">
            <Field label="Company name">
              <input
                className={inputCls}
                value={form.company_name}
                onChange={(e) => update({ company_name: e.target.value })}
                required
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Registration number">
                <input
                  className={inputCls}
                  value={form.company_registration}
                  onChange={(e) => update({ company_registration: e.target.value })}
                />
              </Field>
              <Field label="VAT number">
                <input
                  className={inputCls}
                  value={form.company_vat_number}
                  onChange={(e) => update({ company_vat_number: e.target.value })}
                />
              </Field>
              <Field label="Email">
                <input
                  className={inputCls}
                  type="email"
                  value={form.company_email}
                  onChange={(e) => update({ company_email: e.target.value })}
                />
              </Field>
              <Field label="Phone">
                <input
                  className={inputCls}
                  value={form.company_phone}
                  onChange={(e) => update({ company_phone: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Address">
              <textarea
                className={inputCls}
                rows={3}
                value={form.company_address}
                onChange={(e) => update({ company_address: e.target.value })}
              />
            </Field>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <Building2 className="size-4 text-emerald-600" />
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
              Accounting defaults
            </h2>
          </div>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Currency">
                <input
                  className={inputCls}
                  value={form.currency}
                  onChange={(e) => update({ currency: e.target.value.toUpperCase() })}
                  maxLength={3}
                  required
                />
              </Field>
              <Field label="VAT rate (%)" hint="Applied to new document lines by default.">
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={form.vatRatePercent}
                  onChange={(e) => update({ vatRatePercent: e.target.value })}
                  required
                />
              </Field>
              <Field label="Invoice due days" hint="Default payment term for new invoices.">
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  max={365}
                  step="1"
                  value={form.invoice_due_days}
                  onChange={(e) => update({ invoice_due_days: e.target.value })}
                  required
                />
              </Field>
              <Field label="Fiscal year start" hint="MM-DD (South African default: 03-01).">
                <input
                  className={inputCls}
                  value={form.fiscal_year_start}
                  onChange={(e) => update({ fiscal_year_start: e.target.value })}
                  pattern="\d{2}-\d{2}"
                  placeholder="03-01"
                  required
                />
              </Field>
            </div>
            <Field
              label="Default warehouse"
              hint="Used for receiving and fulfilment when none is chosen."
            >
              <select
                className={inputCls}
                value={form.default_warehouse_id}
                onChange={(e) => update({ default_warehouse_id: e.target.value })}
              >
                <option value="">No default</option>
                {(warehouses.data?.warehouses ?? []).map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.code} — {warehouse.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              Prices on purchase orders, sales orders and invoices are captured excluding VAT. The
              VAT rate above is only a default — each document line stores its own rate.
            </div>
          </div>
        </Card>
      </div>
    </form>
  );
}
