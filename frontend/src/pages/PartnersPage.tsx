import { useState, type FormEvent } from 'react';
import { FileText, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../lib/useFetch';
import { money, shortDate, titleCase } from '../lib/format';
import {
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
import type { Invoice, Partner, Payment } from '../types';

interface PartnerFormState {
  name: string;
  isCustomer: boolean;
  isSupplier: boolean;
  contactName: string;
  email: string;
  phone: string;
  vatNumber: string;
  registrationNumber: string;
  addressLine1: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  creditLimit: string;
  paymentTermsDays: string;
  isActive: boolean;
  notes: string;
}

function formFrom(partner: Partner | null): PartnerFormState {
  return {
    name: partner?.name ?? '',
    isCustomer: partner ? partner.is_customer === 1 : true,
    isSupplier: partner ? partner.is_supplier === 1 : false,
    contactName: partner?.contact_name ?? '',
    email: partner?.email ?? '',
    phone: partner?.phone ?? '',
    vatNumber: partner?.vat_number ?? '',
    registrationNumber: partner?.registration_number ?? '',
    addressLine1: partner?.address_line1 ?? '',
    city: partner?.city ?? '',
    province: partner?.province ?? '',
    postalCode: partner?.postal_code ?? '',
    country: partner?.country ?? 'South Africa',
    creditLimit: ((partner?.credit_limit_cents ?? 0) / 100).toFixed(2),
    paymentTermsDays: String(partner?.payment_terms_days ?? 30),
    isActive: partner ? partner.is_active === 1 : true,
    notes: partner?.notes ?? '',
  };
}

function PartnerForm({
  partner,
  onSaved,
  onClose,
}: {
  partner: Partner | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState(() => formFrom(partner));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof PartnerFormState>(key: K, value: PartnerFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      ...form,
      creditLimitCents: Math.round(Number(form.creditLimit || 0) * 100),
      paymentTermsDays: Number(form.paymentTermsDays || 0),
    };
    try {
      if (partner) await api.put(`/partners/${partner.id}`, payload);
      else await api.post('/partners', payload);
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
      <Field label="Name">
        <input
          className={inputCls}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          required
        />
      </Field>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.isCustomer}
            onChange={(e) => set('isCustomer', e.target.checked)}
          />{' '}
          Customer
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.isSupplier}
            onChange={(e) => set('isSupplier', e.target.checked)}
          />{' '}
          Supplier
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
          />{' '}
          Active
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Contact name">
          <input
            className={inputCls}
            value={form.contactName}
            onChange={(e) => set('contactName', e.target.value)}
          />
        </Field>
        <Field label="Email">
          <input
            className={inputCls}
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
          />
        </Field>
        <Field label="Phone">
          <input
            className={inputCls}
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
        </Field>
        <Field label="VAT number">
          <input
            className={inputCls}
            value={form.vatNumber}
            onChange={(e) => set('vatNumber', e.target.value)}
          />
        </Field>
        <Field label="Registration number">
          <input
            className={inputCls}
            value={form.registrationNumber}
            onChange={(e) => set('registrationNumber', e.target.value)}
          />
        </Field>
        <Field label="Payment terms (days)">
          <input
            className={inputCls}
            type="number"
            min={0}
            max={365}
            value={form.paymentTermsDays}
            onChange={(e) => set('paymentTermsDays', e.target.value)}
          />
        </Field>
        <Field label="Credit limit (R)">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.01"
            value={form.creditLimit}
            onChange={(e) => set('creditLimit', e.target.value)}
          />
        </Field>
        <Field label="Country">
          <input
            className={inputCls}
            value={form.country}
            onChange={(e) => set('country', e.target.value)}
          />
        </Field>
      </div>
      <Field label="Address">
        <input
          className={inputCls}
          value={form.addressLine1}
          onChange={(e) => set('addressLine1', e.target.value)}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="City">
          <input
            className={inputCls}
            value={form.city}
            onChange={(e) => set('city', e.target.value)}
          />
        </Field>
        <Field label="Province">
          <input
            className={inputCls}
            value={form.province}
            onChange={(e) => set('province', e.target.value)}
          />
        </Field>
        <Field label="Postal code">
          <input
            className={inputCls}
            value={form.postalCode}
            onChange={(e) => set('postalCode', e.target.value)}
          />
        </Field>
      </div>
      <Field label="Notes">
        <textarea
          className={inputCls}
          rows={3}
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : partner ? 'Save changes' : 'Create partner'}
        </button>
      </div>
    </form>
  );
}

function StatementModal({ partner, onClose }: { partner: Partner; onClose: () => void }) {
  const [direction, setDirection] = useState<'sale' | 'purchase'>(
    partner.is_customer === 1 ? 'sale' : 'purchase',
  );
  const { data, loading, error } = useFetch<{
    invoices: (Invoice & { outstanding_cents: number })[];
    payments: Payment[];
  }>(`/partners/${partner.id}/statement?direction=${direction}`, [direction]);

  const invoiceTotal = data?.invoices.reduce((total, row) => total + row.total_cents, 0) ?? 0;
  const paidTotal = data?.payments.reduce((total, row) => total + row.amount_cents, 0) ?? 0;

  return (
    <Modal title={`Statement — ${partner.name}`} onClose={onClose} wide>
      <div className="mb-3 flex items-center gap-2">
        {partner.is_customer === 1 ? (
          <button
            type="button"
            className={direction === 'sale' ? btnPrimary : btnSecondary}
            onClick={() => setDirection('sale')}
          >
            Customer invoices
          </button>
        ) : null}
        {partner.is_supplier === 1 ? (
          <button
            type="button"
            className={direction === 'purchase' ? btnPrimary : btnSecondary}
            onClick={() => setDirection('purchase')}
          >
            Supplier bills
          </button>
        ) : null}
      </div>
      {loading ? <Spinner /> : error ? <ErrorBox message={error} /> : null}
      {data ? (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-2">
            <Card className="p-3">
              <p className="text-xs text-slate-500">Invoiced</p>
              <p className="text-lg font-bold text-slate-900">{money(invoiceTotal)}</p>
            </Card>
            <Card className="p-3">
              <p className="text-xs text-slate-500">Paid</p>
              <p className="text-lg font-bold text-emerald-700">{money(paidTotal)}</p>
            </Card>
            <Card className="p-3">
              <p className="text-xs text-slate-500">Outstanding</p>
              <p className="text-lg font-bold text-amber-700">{money(invoiceTotal - paidTotal)}</p>
            </Card>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-bold text-slate-900">Documents</h3>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="px-2 py-2">Number</th>
                  <th className="px-2 py-2">Issued</th>
                  <th className="px-2 py-2">Due</th>
                  <th className="px-2 py-2 text-right">Total</th>
                  <th className="px-2 py-2 text-right">Outstanding</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-400">
                      No documents in this period.
                    </td>
                  </tr>
                ) : (
                  data.invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-t border-slate-100">
                      <td className="px-2 py-2 font-mono text-xs">{invoice.number}</td>
                      <td className="px-2 py-2">{shortDate(invoice.issue_date)}</td>
                      <td className="px-2 py-2">{shortDate(invoice.due_date)}</td>
                      <td className="px-2 py-2 text-right">{money(invoice.total_cents)}</td>
                      <td className="px-2 py-2 text-right">{money(invoice.outstanding_cents)}</td>
                      <td className="px-2 py-2">{titleCase(invoice.status)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
                {data.payments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-400">
                      No payments recorded.
                    </td>
                  </tr>
                ) : (
                  data.payments.map((payment) => (
                    <tr key={payment.id} className="border-t border-slate-100">
                      <td className="px-2 py-2 font-mono text-xs">{payment.number}</td>
                      <td className="px-2 py-2">{shortDate(payment.payment_date)}</td>
                      <td className="px-2 py-2">{titleCase(payment.method)}</td>
                      <td className="px-2 py-2">{payment.reference ?? '—'}</td>
                      <td className="px-2 py-2 text-right">{money(payment.amount_cents)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export default function PartnersPage() {
  const { can } = useAuth();
  const [type, setType] = useState<'all' | 'customer' | 'supplier'>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Partner | null | 'new'>(null);
  const [statement, setStatement] = useState<Partner | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (type !== 'all') params.set('type', type);
  if (query) params.set('q', query);
  const {
    data,
    loading,
    error: loadError,
    reload,
  } = useFetch<{ partners: Partner[]; total: number }>(`/partners?${params.toString()}`, [
    type,
    query,
  ]);

  const remove = async (partner: Partner) => {
    if (!window.confirm(`Delete ${partner.name}? This cannot be undone.`)) return;
    setError(null);
    try {
      await api.del(`/partners/${partner.id}`);
      reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Customers & Suppliers"
        subtitle="Shared partner records for sales and purchasing"
        actions={
          can('partners.manage') ? (
            <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
              <Plus className="size-4" /> New partner
            </button>
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {(['all', 'customer', 'supplier'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setType(option)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                type === option ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {option === 'all' ? 'All' : option === 'customer' ? 'Customers' : 'Suppliers'}
            </button>
          ))}
        </div>
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
          <input
            className={`${inputCls} pl-9`}
            placeholder="Search name, email, VAT number…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <span className="text-sm text-slate-500">{data?.total ?? 0} partner(s)</span>
      </div>

      {error ? <ErrorBox message={error} /> : null}
      {loadError ? <ErrorBox message={loadError} /> : null}

      {loading && !data ? (
        <Spinner />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr>
                <th className={thCls}>Name</th>
                <th className={thCls}>Type</th>
                <th className={thCls}>Contact</th>
                <th className={thCls}>VAT no.</th>
                <th className={thCls} />
                <th className={`${thCls} text-right`}>Receivable</th>
                <th className={`${thCls} text-right`}>Payable</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {!data || data.partners.length === 0 ? (
                <EmptyState colSpan={8} message="No partners found." />
              ) : (
                data.partners.map((partner) => (
                  <tr key={partner.id} className="hover:bg-slate-50">
                    <td className={tdCls}>
                      <p className="font-semibold text-slate-800">{partner.name}</p>
                      <p className="text-xs text-slate-400">
                        {partner.city ?? '—'} {partner.is_active === 0 ? '· inactive' : ''}
                      </p>
                    </td>
                    <td className={tdCls}>
                      <div className="flex flex-wrap gap-1">
                        {partner.is_customer === 1 ? (
                          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-semibold text-blue-700">
                            Customer
                          </span>
                        ) : null}
                        {partner.is_supplier === 1 ? (
                          <span className="rounded bg-purple-50 px-1.5 py-0.5 text-xs font-semibold text-purple-700">
                            Supplier
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className={tdCls}>
                      <p className="text-slate-700">{partner.contact_name ?? '—'}</p>
                      <p className="text-xs text-slate-400">
                        {partner.email ?? partner.phone ?? ''}
                      </p>
                    </td>
                    <td className={`${tdCls} font-mono text-xs`}>{partner.vat_number || '—'}</td>
                    <td className={tdCls} />
                    <td
                      className={`${tdCls} text-right font-semibold ${partner.receivable_cents > 0 ? 'text-amber-700' : 'text-slate-400'}`}
                    >
                      {money(partner.receivable_cents)}
                    </td>
                    <td
                      className={`${tdCls} text-right font-semibold ${partner.payable_cents > 0 ? 'text-red-700' : 'text-slate-400'}`}
                    >
                      {money(partner.payable_cents)}
                    </td>
                    <td className={tdCls}>
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className={btnGhost}
                          onClick={() => setStatement(partner)}
                          title="Statement"
                        >
                          <FileText className="size-4" />
                        </button>
                        {can('partners.manage') ? (
                          <>
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => setEditing(partner)}
                              title="Edit"
                            >
                              <Pencil className="size-4" />
                            </button>
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => remove(partner)}
                              title="Delete"
                            >
                              <Trash2 className="size-4 text-red-500" />
                            </button>
                          </>
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
          title={editing === 'new' ? 'New partner' : `Edit ${editing.name}`}
          onClose={() => setEditing(null)}
          wide
        >
          <PartnerForm
            partner={editing === 'new' ? null : editing}
            onSaved={reload}
            onClose={() => setEditing(null)}
          />
        </Modal>
      ) : null}
      {statement ? <StatementModal partner={statement} onClose={() => setStatement(null)} /> : null}
    </>
  );
}
