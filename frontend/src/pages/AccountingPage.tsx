import { useState, type FormEvent } from 'react';
import { BookOpen, Plus, Search } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../lib/useFetch';
import { money, monthEnd, monthStart, shortDate, titleCase, today } from '../lib/format';
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
import type {
  Account,
  BalanceSheet,
  Journal,
  JournalEntry,
  JournalItem,
  LedgerLine,
  ProfitAndLoss,
  TrialBalanceRow,
} from '../types';

type Tab = 'accounts' | 'journal' | 'reports';
type ReportTab = 'trial' | 'pl' | 'balance' | 'vat';

interface AccountLedgerResponse {
  account: { id: number; code: string; name: string; type: string };
  openingBalanceCents: number;
  lines: LedgerLine[];
  closingBalanceCents: number;
}

interface JournalDetail {
  journalEntry: JournalEntry;
  items: JournalItem[];
}

interface VatReport {
  from: string;
  to: string;
  outputVatCents: number;
  inputVatCents: number;
  netVatCents: number;
  rows: { code: string; name: string; debit_cents: number; credit_cents: number }[];
}

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;

function AccountForm({
  account,
  onSaved,
  onClose,
}: {
  account: Account | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState(account?.code ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<Account['type']>(account?.type ?? 'expense');
  const [description, setDescription] = useState(account?.description ?? '');
  const [isActive, setIsActive] = useState(account ? account.is_active === 1 : true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { code, name, type, description: description || null, isActive };
      if (account) await api.put(`/accounting/accounts/${account.id}`, body);
      else await api.post('/accounting/accounts', body);
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {error ? <ErrorBox message={error} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code">
          <input
            className={inputCls}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={Boolean(account)}
            required
          />
        </Field>
        <Field label="Type">
          <select
            className={inputCls}
            value={type}
            onChange={(e) => setType(e.target.value as Account['type'])}
          >
            {ACCOUNT_TYPES.map((option) => (
              <option key={option} value={option}>
                {titleCase(option)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Name">
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Field>
      <Field label="Description">
        <input
          className={inputCls}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />{' '}
        Active
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : account ? 'Save changes' : 'Create account'}
        </button>
      </div>
    </form>
  );
}

interface DraftJournalLine {
  key: string;
  accountId: string;
  description: string;
  debit: string;
  credit: string;
}

let journalSeq = 0;

function blankJournalLine(): DraftJournalLine {
  journalSeq += 1;
  return {
    key: `jl-${Date.now()}-${journalSeq}`,
    accountId: '',
    description: '',
    debit: '',
    credit: '',
  };
}

function JournalForm({
  journals,
  accounts,
  onSaved,
  onClose,
}: {
  journals: Journal[];
  accounts: Account[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [journalCode, setJournalCode] = useState(journals[0]?.code ?? 'GEN');
  const [entryDate, setEntryDate] = useState(today());
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<DraftJournalLine[]>([blankJournalLine(), blankJournalLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const debitTotal = lines.reduce(
    (total, line) => total + Math.round((Number(line.debit) || 0) * 100),
    0,
  );
  const creditTotal = lines.reduce(
    (total, line) => total + Math.round((Number(line.credit) || 0) * 100),
    0,
  );

  const update = (key: string, patch: Partial<DraftJournalLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/accounting/journal-entries', {
        journalCode,
        entryDate,
        description,
        reference: reference || null,
        items: lines.map((line) => ({
          accountId: Number(line.accountId),
          description: line.description || null,
          debitCents: Math.round((Number(line.debit) || 0) * 100),
          creditCents: Math.round((Number(line.credit) || 0) * 100),
        })),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const cell = `${inputCls} px-2 py-1.5 text-sm`;

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? <ErrorBox message={error} /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Journal">
          <select
            className={inputCls}
            value={journalCode}
            onChange={(e) => setJournalCode(e.target.value)}
          >
            {journals.map((journal) => (
              <option key={journal.id} value={journal.code}>
                {journal.code} — {journal.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Entry date">
          <input
            className={inputCls}
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            required
          />
        </Field>
        <Field label="Reference">
          <input
            className={inputCls}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Description">
        <input
          className={inputCls}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </Field>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
              <th className="px-2 py-2">Account</th>
              <th className="px-2 py-2">Description</th>
              <th className="w-28 px-2 py-2">Debit</th>
              <th className="w-28 px-2 py-2">Credit</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key} className="border-t border-slate-100">
                <td className="px-2 py-1.5">
                  <select
                    className={cell}
                    value={line.accountId}
                    onChange={(e) => update(line.key, { accountId: e.target.value })}
                    required
                  >
                    <option value="">Select account…</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} — {account.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    className={cell}
                    value={line.description}
                    onChange={(e) => update(line.key, { description: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    className={cell}
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.debit}
                    onChange={(e) => update(line.key, { debit: e.target.value, credit: '' })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    className={cell}
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.credit}
                    onChange={(e) => update(line.key, { credit: e.target.value, debit: '' })}
                  />
                </td>
                <td className="px-1 py-1.5">
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-red-500 hover:bg-red-50"
                    onClick={() =>
                      setLines((current) => current.filter((row) => row.key !== line.key))
                    }
                    disabled={lines.length <= 2}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className={btnSecondary}
          onClick={() => setLines((current) => [...current, blankJournalLine()])}
        >
          <Plus className="size-4" /> Add line
        </button>
        <div className="flex gap-4 text-sm">
          <span className={debitTotal === creditTotal ? 'text-slate-600' : 'text-red-600'}>
            Debits <strong>{money(debitTotal)}</strong>
          </span>
          <span className={debitTotal === creditTotal ? 'text-slate-600' : 'text-red-600'}>
            Credits <strong>{money(creditTotal)}</strong>
          </span>
        </div>
      </div>

      {debitTotal !== creditTotal ? (
        <p className="text-sm text-red-600">Debits and credits must balance before posting.</p>
      ) : null}

      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          className={btnPrimary}
          disabled={busy || debitTotal !== creditTotal || debitTotal === 0}
        >
          {busy ? 'Posting…' : 'Post journal entry'}
        </button>
      </div>
    </form>
  );
}

function JournalDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, loading, error } = useFetch<JournalDetail>(`/accounting/journal-entries/${id}`);
  return (
    <Modal
      title={data ? `Journal ${data.journalEntry.number}` : 'Journal entry'}
      onClose={onClose}
      wide
    >
      {loading ? <Spinner /> : error ? <ErrorBox message={error} /> : null}
      {data ? (
        <div className="space-y-4">
          <div className="grid gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-slate-500">Journal</p>
              <p className="font-semibold text-slate-800">
                {data.journalEntry.journal_code} — {data.journalEntry.journal_name}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Date</p>
              <p className="font-semibold text-slate-800">
                {shortDate(data.journalEntry.entry_date)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Reference</p>
              <p className="font-semibold text-slate-800">{data.journalEntry.reference ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Status</p>
              <p className="font-semibold text-slate-800">{titleCase(data.journalEntry.status)}</p>
            </div>
          </div>
          <p className="text-sm text-slate-700">{data.journalEntry.description}</p>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Partner</th>
                  <th className="px-3 py-2 text-right">Debit</th>
                  <th className="px-3 py-2 text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono text-xs">
                      {item.account_code} — {item.account_name}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{item.description ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{item.partner_name ?? '—'}</td>
                    <td className="px-3 py-2 text-right">
                      {item.debit_cents ? money(item.debit_cents) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {item.credit_cents ? money(item.credit_cents) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function LedgerModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const { data, loading, error } = useFetch<AccountLedgerResponse>(
    `/accounting/reports/ledger/${account.id}?from=${from}&to=${to}`,
    [from, to],
  );
  return (
    <Modal title={`Ledger — ${account.code} ${account.name}`} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="From" className="w-40">
            <input
              className={inputCls}
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="To" className="w-40">
            <input
              className={inputCls}
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
        </div>
        {loading ? <Spinner /> : error ? <ErrorBox message={error} /> : null}
        {data ? (
          <>
            <div className="flex flex-wrap gap-4 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-500">
                Opening{' '}
                <strong className="text-slate-800">{money(data.openingBalanceCents)}</strong>
              </span>
              <span className="text-slate-500">
                Closing{' '}
                <strong className="text-slate-800">{money(data.closingBalanceCents)}</strong>
              </span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Entry</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right">Debit</th>
                    <th className="px-3 py-2 text-right">Credit</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.length === 0 ? (
                    <EmptyState colSpan={6} message="No movements in this period." />
                  ) : (
                    data.lines.map((line) => (
                      <tr
                        key={`${line.journal_entry_id}-${line.number}-${line.debit_cents}-${line.credit_cents}`}
                        className="border-t border-slate-100"
                      >
                        <td className="px-3 py-2">{shortDate(line.entry_date)}</td>
                        <td className="px-3 py-2 font-mono text-xs">{line.number}</td>
                        <td className="px-3 py-2 text-slate-600">
                          {line.line_description ?? line.description}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {line.debit_cents ? money(line.debit_cents) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {line.credit_cents ? money(line.credit_cents) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">
                          {money(line.balanceCents)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function ReportsPanel() {
  const [report, setReport] = useState<ReportTab>('trial');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const [asOf, setAsOf] = useState(today());

  const trial = useFetch<{
    asOf: string;
    rows: TrialBalanceRow[];
    totalDebitCents: number;
    totalCreditCents: number;
  }>(report === 'trial' ? `/accounting/reports/trial-balance?asOf=${asOf}` : null, [asOf]);
  const pl = useFetch<ProfitAndLoss>(
    report === 'pl' ? `/accounting/reports/profit-and-loss?from=${from}&to=${to}` : null,
    [from, to],
  );
  const balance = useFetch<BalanceSheet>(
    report === 'balance' ? `/accounting/reports/balance-sheet?asOf=${asOf}` : null,
    [asOf],
  );
  const vat = useFetch<VatReport>(
    report === 'vat' ? `/accounting/reports/vat?from=${from}&to=${to}` : null,
    [from, to],
  );

  const dateRange = (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="From" className="w-40">
        <input
          className={inputCls}
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </Field>
      <Field label="To" className="w-40">
        <input
          className={inputCls}
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </Field>
    </div>
  );

  const asOfField = (
    <Field label="As at" className="w-40">
      <input
        className={inputCls}
        type="date"
        value={asOf}
        onChange={(e) => setAsOf(e.target.value)}
      />
    </Field>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-lg border border-slate-200 bg-white p-1">
          {(
            [
              ['trial', 'Trial balance'],
              ['pl', 'Profit & loss'],
              ['balance', 'Balance sheet'],
              ['vat', 'VAT'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setReport(value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                report === value ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {report === 'pl' || report === 'vat' ? dateRange : null}
        {report === 'trial' || report === 'balance' ? asOfField : null}
        <button
          type="button"
          className={btnSecondary}
          onClick={() => {
            trial.reload();
            pl.reload();
            balance.reload();
            vat.reload();
          }}
        >
          Refresh
        </button>
      </div>

      {report === 'trial' ? (
        trial.loading && !trial.data ? (
          <Spinner />
        ) : trial.error ? (
          <ErrorBox message={trial.error} />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Code</th>
                  <th className={thCls}>Account</th>
                  <th className={thCls}>Type</th>
                  <th className={`${thCls} text-right`}>Debit</th>
                  <th className={`${thCls} text-right`}>Credit</th>
                  <th className={`${thCls} text-right`}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {(trial.data?.rows ?? []).map((row) => (
                  <tr key={row.code} className="border-t border-slate-100">
                    <td className={`${tdCls} font-mono text-xs`}>{row.code}</td>
                    <td className={`${tdCls} font-medium text-slate-800`}>{row.name}</td>
                    <td className={tdCls}>{titleCase(row.type)}</td>
                    <td className={`${tdCls} text-right`}>
                      {row.debit_cents ? money(row.debit_cents) : '—'}
                    </td>
                    <td className={`${tdCls} text-right`}>
                      {row.credit_cents ? money(row.credit_cents) : '—'}
                    </td>
                    <td className={`${tdCls} text-right font-semibold`}>
                      {money(row.balanceCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                  <td className="px-3 py-2" colSpan={3}>
                    Totals
                  </td>
                  <td className="px-3 py-2 text-right">
                    {money(trial.data?.totalDebitCents ?? 0)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {money(trial.data?.totalCreditCents ?? 0)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </Card>
        )
      ) : null}

      {report === 'pl' ? (
        pl.loading && !pl.data ? (
          <Spinner />
        ) : pl.error ? (
          <ErrorBox message={pl.error} />
        ) : pl.data ? (
          <div className="grid gap-3 lg:grid-cols-3">
            <Card className="overflow-x-auto lg:col-span-2">
              <table className="w-full min-w-[420px] text-left text-sm">
                <thead>
                  <tr>
                    <th className={thCls}>Code</th>
                    <th className={thCls}>Account</th>
                    <th className={thCls}>Type</th>
                    <th className={`${thCls} text-right`}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {pl.data.lines.length === 0 ? (
                    <EmptyState colSpan={4} message="No income or expenses in this period." />
                  ) : (
                    pl.data.lines.map((line) => (
                      <tr key={line.code} className="border-t border-slate-100">
                        <td className={`${tdCls} font-mono text-xs`}>{line.code}</td>
                        <td className={`${tdCls} font-medium text-slate-800`}>{line.name}</td>
                        <td className={tdCls}>{titleCase(line.type)}</td>
                        <td
                          className={`${tdCls} text-right font-semibold ${
                            line.type === 'income' ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {money(line.amountCents)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
            <div className="space-y-3">
              <Card className="p-4">
                <p className="text-xs uppercase text-slate-500">Income</p>
                <p className="text-xl font-bold text-emerald-700">{money(pl.data.incomeCents)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs uppercase text-slate-500">Expenses</p>
                <p className="text-xl font-bold text-red-700">{money(pl.data.expenseCents)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs uppercase text-slate-500">Net profit</p>
                <p
                  className={`text-2xl font-bold ${
                    pl.data.netProfitCents >= 0 ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  {money(pl.data.netProfitCents)}
                </p>
              </Card>
            </div>
          </div>
        ) : null
      ) : null}

      {report === 'balance' ? (
        balance.loading && !balance.data ? (
          <Spinner />
        ) : balance.error ? (
          <ErrorBox message={balance.error} />
        ) : balance.data ? (
          <div className="grid gap-3 lg:grid-cols-3">
            {(
              [
                ['Assets', balance.data.assets, balance.data.assetTotalCents],
                ['Liabilities', balance.data.liabilities, balance.data.liabilityTotalCents],
                ['Equity', balance.data.equity, balance.data.equityTotalCents],
              ] as const
            ).map(([label, rows, total]) => (
              <Card key={label} className="overflow-hidden">
                <div className="border-b border-slate-100 px-3 py-2">
                  <h3 className="text-sm font-bold text-slate-900">{label}</h3>
                </div>
                <table className="w-full text-left text-sm">
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-slate-400">No balance</td>
                      </tr>
                    ) : (
                      rows.map((row) => (
                        <tr key={row.code} className="border-t border-slate-100">
                          <td className="px-3 py-2">
                            <p className="font-medium text-slate-800">{row.name}</p>
                            <p className="font-mono text-xs text-slate-400">{row.code}</p>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold">
                            {money(row.amountCents)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2 text-right">{money(total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </Card>
            ))}
            <Card className="p-4 lg:col-span-3">
              <p className="text-xs uppercase text-slate-500">Retained earnings to date</p>
              <p className="text-xl font-bold text-slate-900">
                {money(balance.data.retainedEarningsCents)}
              </p>
            </Card>
          </div>
        ) : null
      ) : null}

      {report === 'vat' ? (
        vat.loading && !vat.data ? (
          <Spinner />
        ) : vat.error ? (
          <ErrorBox message={vat.error} />
        ) : vat.data ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Card className="p-4">
                <p className="text-xs uppercase text-slate-500">Output VAT</p>
                <p className="text-xl font-bold text-slate-900">{money(vat.data.outputVatCents)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs uppercase text-slate-500">Input VAT</p>
                <p className="text-xl font-bold text-slate-900">{money(vat.data.inputVatCents)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs uppercase text-slate-500">Net VAT due</p>
                <p className="text-xl font-bold text-emerald-700">{money(vat.data.netVatCents)}</p>
              </Card>
            </div>
            <Card className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className={thCls}>Code</th>
                    <th className={thCls}>Account</th>
                    <th className={`${thCls} text-right`}>Debit</th>
                    <th className={`${thCls} text-right`}>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {vat.data.rows.length === 0 ? (
                    <EmptyState colSpan={4} message="No VAT activity in this period." />
                  ) : (
                    vat.data.rows.map((row) => (
                      <tr key={row.code} className="border-t border-slate-100">
                        <td className={`${tdCls} font-mono text-xs`}>{row.code}</td>
                        <td className={`${tdCls} font-medium text-slate-800`}>{row.name}</td>
                        <td className={`${tdCls} text-right`}>{money(row.debit_cents)}</td>
                        <td className={`${tdCls} text-right`}>{money(row.credit_cents)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
          </div>
        ) : null
      ) : null}
    </div>
  );
}

export default function AccountingPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('accounts');
  const [query, setQuery] = useState('');
  const [accountModal, setAccountModal] = useState<Account | 'new' | null>(null);
  const [ledgerFor, setLedgerFor] = useState<Account | null>(null);
  const [journalModal, setJournalModal] = useState(false);
  const [journalDetail, setJournalDetail] = useState<number | null>(null);
  const [journalQuery, setJournalQuery] = useState('');
  const [journalFrom, setJournalFrom] = useState(monthStart());
  const [journalTo, setJournalTo] = useState(monthEnd());
  const [error, setError] = useState<string | null>(null);

  const accounts = useFetch<{ accounts: Account[] }>('/accounting/accounts');
  const journals = useFetch<{ journals: Journal[] }>('/accounting/journals');
  const journalParams = new URLSearchParams({ from: journalFrom, to: journalTo });
  if (journalQuery) journalParams.set('q', journalQuery);
  const entries = useFetch<{ journalEntries: JournalEntry[] }>(
    `/accounting/journal-entries?${journalParams.toString()}`,
    [journalFrom, journalTo, journalQuery],
  );

  const filteredAccounts = (accounts.data?.accounts ?? []).filter((account) =>
    query
      ? `${account.code} ${account.name} ${account.type}`
          .toLowerCase()
          .includes(query.toLowerCase())
      : true,
  );

  const removeAccount = async (account: Account) => {
    if (!window.confirm(`Delete account ${account.code} ${account.name}?`)) return;
    setError(null);
    try {
      await api.del(`/accounting/accounts/${account.id}`);
      accounts.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Accounting"
        subtitle="Chart of accounts, journal entries and financial reports"
        actions={
          can('accounting.manage') ? (
            tab === 'accounts' ? (
              <button type="button" className={btnPrimary} onClick={() => setAccountModal('new')}>
                <Plus className="size-4" /> New account
              </button>
            ) : tab === 'journal' ? (
              <button type="button" className={btnPrimary} onClick={() => setJournalModal(true)}>
                <Plus className="size-4" /> New journal entry
              </button>
            ) : null
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {(
            [
              ['accounts', 'Chart of accounts'],
              ['journal', 'Journal'],
              ['reports', 'Reports'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === value ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'accounts' ? (
          <div className="relative min-w-56 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
            <input
              className={`${inputCls} pl-9`}
              placeholder="Search code, name or type…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        ) : null}
        {tab === 'journal' ? (
          <>
            <input
              className={`${inputCls} w-40`}
              type="date"
              value={journalFrom}
              onChange={(e) => setJournalFrom(e.target.value)}
            />
            <input
              className={`${inputCls} w-40`}
              type="date"
              value={journalTo}
              onChange={(e) => setJournalTo(e.target.value)}
            />
            <div className="relative min-w-56 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
              <input
                className={`${inputCls} pl-9`}
                placeholder="Search number, description…"
                value={journalQuery}
                onChange={(event) => setJournalQuery(event.target.value)}
              />
            </div>
          </>
        ) : null}
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {tab === 'accounts' ? (
        accounts.loading && !accounts.data ? (
          <Spinner />
        ) : accounts.error ? (
          <ErrorBox message={accounts.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Code</th>
                  <th className={thCls}>Account</th>
                  <th className={thCls}>Type</th>
                  <th className={thCls}>Status</th>
                  <th className={`${thCls} text-right`}>Entries</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.length === 0 ? (
                  <EmptyState colSpan={6} message="No accounts found." />
                ) : (
                  filteredAccounts.map((account) => (
                    <tr key={account.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-mono text-xs font-semibold`}>{account.code}</td>
                      <td className={tdCls}>
                        <p className="font-semibold text-slate-800">{account.name}</p>
                        {account.description ? (
                          <p className="text-xs text-slate-400">{account.description}</p>
                        ) : null}
                      </td>
                      <td className={tdCls}>{titleCase(account.type)}</td>
                      <td className={tdCls}>
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                            account.is_active === 1
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {account.is_active === 1 ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className={`${tdCls} text-right`}>{account.entry_count ?? 0}</td>
                      <td className={tdCls}>
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className={btnGhost}
                            onClick={() => setLedgerFor(account)}
                          >
                            <BookOpen className="size-3.5" /> Ledger
                          </button>
                          {can('accounting.manage') ? (
                            <>
                              <button
                                type="button"
                                className={btnGhost}
                                onClick={() => setAccountModal(account)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className={`${btnGhost} text-red-600`}
                                onClick={() => removeAccount(account)}
                              >
                                Delete
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
        )
      ) : null}

      {tab === 'journal' ? (
        entries.loading && !entries.data ? (
          <Spinner />
        ) : entries.error ? (
          <ErrorBox message={entries.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Number</th>
                  <th className={thCls}>Date</th>
                  <th className={thCls}>Journal</th>
                  <th className={thCls}>Description</th>
                  <th className={thCls}>Reference</th>
                  <th className={`${thCls} text-right`}>Amount</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {!entries.data || entries.data.journalEntries.length === 0 ? (
                  <EmptyState colSpan={7} message="No journal entries in this period." />
                ) : (
                  entries.data.journalEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-mono text-xs font-semibold`}>{entry.number}</td>
                      <td className={tdCls}>{shortDate(entry.entry_date)}</td>
                      <td className={`${tdCls} font-mono text-xs`}>{entry.journal_code}</td>
                      <td className={tdCls}>{entry.description}</td>
                      <td className={`${tdCls} text-xs text-slate-500`}>
                        {entry.reference ?? '—'}
                      </td>
                      <td className={`${tdCls} text-right font-semibold`}>
                        {money(entry.total_cents)}
                      </td>
                      <td className={tdCls}>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            className={btnGhost}
                            onClick={() => setJournalDetail(entry.id)}
                          >
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === 'reports' ? <ReportsPanel /> : null}

      {accountModal ? (
        <Modal
          title={accountModal === 'new' ? 'New account' : `Edit ${accountModal.code}`}
          onClose={() => setAccountModal(null)}
        >
          <AccountForm
            account={accountModal === 'new' ? null : accountModal}
            onSaved={accounts.reload}
            onClose={() => setAccountModal(null)}
          />
        </Modal>
      ) : null}

      {ledgerFor ? <LedgerModal account={ledgerFor} onClose={() => setLedgerFor(null)} /> : null}

      {journalModal ? (
        <Modal title="New journal entry" onClose={() => setJournalModal(false)} wide>
          <JournalForm
            journals={journals.data?.journals ?? []}
            accounts={(accounts.data?.accounts ?? []).filter((account) => account.is_active === 1)}
            onSaved={() => entries.reload()}
            onClose={() => setJournalModal(false)}
          />
        </Modal>
      ) : null}

      {journalDetail ? (
        <JournalDetailModal id={journalDetail} onClose={() => setJournalDetail(null)} />
      ) : null}
    </>
  );
}
