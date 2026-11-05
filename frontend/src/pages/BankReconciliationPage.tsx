import { useState, type FormEvent } from 'react';
import { Plus, Upload } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../lib/useFetch';
import { money, monthEnd, monthStart, shortDate } from '../lib/format';
import {
  Badge,
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
import type { Account, BankAccount, BankCandidate, BankSummary, BankTransaction } from '../types';

function AccountForm({
  accounts,
  onSaved,
  onClose,
}: {
  accounts: Account[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [glAccountId, setGlAccountId] = useState(
    String(accounts.find((account) => account.code === '1000')?.id ?? accounts[0]?.id ?? ''),
  );
  const [opening, setOpening] = useState('0.00');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/banking/accounts', {
        name,
        bankName: bankName || null,
        accountNumber: accountNumber || null,
        glAccountId: glAccountId ? Number(glAccountId) : null,
        openingBalanceCents: Math.round((Number(opening) || 0) * 100),
      });
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
        <Field label="Account name">
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label="Bank">
          <input
            className={inputCls}
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
          />
        </Field>
        <Field label="Account number">
          <input
            className={inputCls}
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
          />
        </Field>
        <Field label="GL account">
          <select
            className={inputCls}
            value={glAccountId}
            onChange={(e) => setGlAccountId(e.target.value)}
          >
            {accounts
              .filter((account) => account.type === 'asset')
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} — {account.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Opening balance (R)">
          <input
            className={inputCls}
            type="number"
            step="0.01"
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : 'Create account'}
        </button>
      </div>
    </form>
  );
}

function TransactionForm({
  bankAccountId,
  onSaved,
  onClose,
}: {
  bankAccountId: number;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('0.00');
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/banking/transactions', {
        bankAccountId,
        transactionDate,
        description,
        reference: reference || null,
        amountCents: Math.round((Number(amount) || 0) * 100),
        direction,
      });
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
        <Field label="Date">
          <input
            className={inputCls}
            type="date"
            value={transactionDate}
            onChange={(e) => setTransactionDate(e.target.value)}
            required
          />
        </Field>
        <Field label="Direction">
          <select
            className={inputCls}
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'in' | 'out')}
          >
            <option value="out">Money out</option>
            <option value="in">Money in</option>
          </select>
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Reference">
          <input
            className={inputCls}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>
        <Field label="Amount (R)">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : 'Add statement line'}
        </button>
      </div>
    </form>
  );
}

function ImportForm({
  bankAccountId,
  onSaved,
  onClose,
}: {
  bankAccountId: number;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [csv, setCsv] = useState('date,description,reference,amount\n');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<{ imported: number; errors: string[] }>(
        '/banking/transactions/import',
        { bankAccountId, csv },
      );
      setResult(response);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {error ? <ErrorBox message={error} /> : null}
      {result ? (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          Imported {result.imported} statement line(s).
          {result.errors.length ? ` ${result.errors.length} row(s) skipped.` : ''}
          {result.errors.length ? (
            <ul className="mt-1 list-disc pl-5 text-xs text-red-600">
              {result.errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <Field label="CSV — date,description,reference,amount (negative for money out)">
        <textarea
          className={`${inputCls} font-mono text-xs`}
          rows={10}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Close
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Importing…' : 'Import lines'}
        </button>
      </div>
    </form>
  );
}

export default function BankReconciliationPage() {
  const { can } = useAuth();
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const [modal, setModal] = useState<'account' | 'transaction' | 'import' | null>(null);
  const [matching, setMatching] = useState<BankTransaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const accounts = useFetch<{ accounts: BankAccount[] }>('/banking/accounts');
  const glAccounts = useFetch<{ accounts: Account[] }>('/accounting/accounts');
  const selectedId = accountId || String(accounts.data?.accounts[0]?.id ?? '');
  const selected = accounts.data?.accounts.find((account) => account.id === Number(selectedId));

  const summary = useFetch<BankSummary>(
    selectedId ? `/banking/summary?bankAccountId=${selectedId}` : null,
    [selectedId],
  );
  const transactions = useFetch<{ transactions: BankTransaction[] }>(
    selectedId ? `/banking/transactions?bankAccountId=${selectedId}&from=${from}&to=${to}` : null,
    [selectedId, from, to],
  );
  const candidates = useFetch<{ candidates: BankCandidate[] }>(
    matching ? `/banking/candidates?bankAccountId=${matching.bank_account_id}` : null,
    [matching],
  );

  const refresh = () => {
    summary.reload();
    transactions.reload();
  };

  const match = async (candidate: BankCandidate) => {
    if (!matching) return;
    setBusyId(matching.id);
    setError(null);
    try {
      await api.post(`/banking/transactions/${matching.id}/match`, {
        journalEntryId: candidate.journal_entry_id,
      });
      setMatching(null);
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const action = async (transaction: BankTransaction, kind: 'unmatch' | 'ignore') => {
    setBusyId(transaction.id);
    setError(null);
    try {
      await api.post(`/banking/transactions/${transaction.id}/${kind}`);
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const rows = transactions.data?.transactions ?? [];
  const targetAmount = matching ? Math.abs(matching.amount_cents) : 0;
  const candidateRows = [...(candidates.data?.candidates ?? [])].sort(
    (a, b) =>
      Math.abs(Math.abs(a.debit_cents - a.credit_cents) - targetAmount) -
      Math.abs(Math.abs(b.debit_cents - b.credit_cents) - targetAmount),
  );

  return (
    <>
      <PageHeader
        title="Bank reconciliation"
        subtitle="Match statement lines to posted ledger entries"
        actions={
          can('accounting.manage') ? (
            <div className="flex gap-2">
              <button type="button" className={btnSecondary} onClick={() => setModal('account')}>
                <Plus className="size-4" /> Bank account
              </button>
              {selectedId ? (
                <>
                  <button type="button" className={btnSecondary} onClick={() => setModal('import')}>
                    <Upload className="size-4" /> Import CSV
                  </button>
                  <button
                    type="button"
                    className={btnPrimary}
                    onClick={() => setModal('transaction')}
                  >
                    <Plus className="size-4" /> Statement line
                  </button>
                </>
              ) : null}
            </div>
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="Bank account" className="w-56">
          <select
            className={inputCls}
            value={selectedId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {(accounts.data?.accounts ?? []).length === 0 ? (
              <option value="">No accounts yet</option>
            ) : null}
            {(accounts.data?.accounts ?? []).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </Field>
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
        <button type="button" className={btnSecondary} onClick={refresh}>
          Refresh
        </button>
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {!selected ? (
        <Card className="p-6 text-sm text-slate-500">
          Create a bank account to start reconciling. The default GL account is 1000 Bank.
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <Card className="p-4">
              <p className="text-xs uppercase text-slate-500">Statement balance</p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {money(summary.data?.statementBalanceCents ?? 0)}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs uppercase text-slate-500">Reconciled</p>
              <p className="mt-1 text-lg font-bold text-emerald-700">
                {money(summary.data?.reconciledBalanceCents ?? 0)}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs uppercase text-slate-500">Ledger balance</p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {money(summary.data?.ledgerBalanceCents ?? 0)}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs uppercase text-slate-500">Difference</p>
              <p
                className={`mt-1 text-lg font-bold ${
                  (summary.data?.differenceCents ?? 0) === 0 ? 'text-emerald-700' : 'text-red-600'
                }`}
              >
                {money(summary.data?.differenceCents ?? 0)}
              </p>
            </Card>
          </div>

          {transactions.loading && !transactions.data ? (
            <Spinner />
          ) : transactions.error ? (
            <ErrorBox message={transactions.error} />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr>
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Description</th>
                    <th className={thCls}>Reference</th>
                    <th className={`${thCls} text-right`}>Amount</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Matched entry</th>
                    <th className={thCls} />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <EmptyState colSpan={7} message="No statement lines in this period." />
                  ) : (
                    rows.map((transaction) => (
                      <tr key={transaction.id} className="hover:bg-slate-50">
                        <td className={tdCls}>{shortDate(transaction.transaction_date)}</td>
                        <td className={tdCls}>{transaction.description}</td>
                        <td className={tdCls}>{transaction.reference ?? '—'}</td>
                        <td
                          className={`${tdCls} text-right font-semibold ${
                            transaction.amount_cents < 0 ? 'text-red-600' : 'text-emerald-700'
                          }`}
                        >
                          {money(transaction.amount_cents)}
                        </td>
                        <td className={tdCls}>
                          <Badge value={transaction.status} />
                        </td>
                        <td className={tdCls}>
                          {transaction.journal_number ? (
                            <span className="font-mono text-xs">{transaction.journal_number}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className={tdCls}>
                          {can('accounting.manage') ? (
                            <div className="flex justify-end gap-1">
                              {transaction.status === 'unreconciled' ? (
                                <>
                                  <button
                                    type="button"
                                    className={btnGhost}
                                    disabled={busyId === transaction.id}
                                    onClick={() => setMatching(transaction)}
                                  >
                                    Match
                                  </button>
                                  <button
                                    type="button"
                                    className={`${btnGhost} text-slate-400`}
                                    disabled={busyId === transaction.id}
                                    onClick={() => void action(transaction, 'ignore')}
                                  >
                                    Ignore
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  className={btnGhost}
                                  disabled={busyId === transaction.id}
                                  onClick={() => void action(transaction, 'unmatch')}
                                >
                                  Unmatch
                                </button>
                              )}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {modal === 'account' ? (
        <Modal title="New bank account" onClose={() => setModal(null)}>
          <AccountForm
            accounts={glAccounts.data?.accounts ?? []}
            onSaved={() => accounts.reload()}
            onClose={() => setModal(null)}
          />
        </Modal>
      ) : null}

      {modal === 'transaction' && selectedId ? (
        <Modal title="Add statement line" onClose={() => setModal(null)}>
          <TransactionForm
            bankAccountId={Number(selectedId)}
            onSaved={refresh}
            onClose={() => setModal(null)}
          />
        </Modal>
      ) : null}

      {modal === 'import' && selectedId ? (
        <Modal title="Import bank statement CSV" onClose={() => setModal(null)} wide>
          <ImportForm
            bankAccountId={Number(selectedId)}
            onSaved={refresh}
            onClose={() => setModal(null)}
          />
        </Modal>
      ) : null}

      {matching ? (
        <Modal title="Match to ledger entry" onClose={() => setMatching(null)} wide>
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-slate-900">{matching.description}</p>
              <p className="text-xs text-slate-500">
                {shortDate(matching.transaction_date)} · {money(matching.amount_cents)}
              </p>
            </div>
            {candidates.loading && !candidates.data ? (
              <Spinner />
            ) : candidates.error ? (
              <ErrorBox message={candidates.error} />
            ) : (
              <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th className={thCls}>Entry</th>
                      <th className={thCls}>Date</th>
                      <th className={thCls}>Description</th>
                      <th className={`${thCls} text-right`}>Amount</th>
                      <th className={thCls} />
                    </tr>
                  </thead>
                  <tbody>
                    {candidateRows.length === 0 ? (
                      <EmptyState
                        colSpan={5}
                        message="No unmatched ledger entries on this account."
                      />
                    ) : (
                      candidateRows.map((candidate) => (
                        <tr key={`${candidate.journal_entry_id}-${candidate.debit_cents}`}>
                          <td className={`${tdCls} font-mono text-xs`}>
                            {candidate.number}
                            {Math.abs(candidate.debit_cents - candidate.credit_cents) ===
                            targetAmount ? (
                              <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
                                Suggested
                              </span>
                            ) : null}
                          </td>
                          <td className={tdCls}>{shortDate(candidate.entry_date)}</td>
                          <td className={tdCls}>
                            {candidate.line_description ?? candidate.description}
                          </td>
                          <td className={`${tdCls} text-right`}>
                            {money(candidate.debit_cents - candidate.credit_cents)}
                          </td>
                          <td className={tdCls}>
                            <div className="flex justify-end">
                              <button
                                type="button"
                                className={btnPrimary}
                                disabled={busyId === matching.id}
                                onClick={() => void match(candidate)}
                              >
                                Match
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
