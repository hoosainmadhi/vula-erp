import { useState, type FormEvent } from 'react';
import { Plus, Search } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../lib/useFetch';
import { money, monthEnd, monthStart, shortDate, titleCase, today } from '../lib/format';
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
import type { Account, Expense, Partner } from '../types';

const STATUSES = ['draft', 'posted', 'void'] as const;
const METHODS = ['bank', 'cash', 'card', 'credit'] as const;

function ExpenseForm({
  expense,
  categories,
  suppliers,
  accounts,
  onSaved,
  onClose,
}: {
  expense: Expense | null;
  categories: string[];
  suppliers: Partner[];
  accounts: Account[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [expenseDate, setExpenseDate] = useState(expense?.expense_date ?? today());
  const [category, setCategory] = useState(expense?.category ?? categories[0] ?? 'General');
  const [description, setDescription] = useState(expense?.description ?? '');
  const [supplierId, setSupplierId] = useState(String(expense?.supplier_id ?? ''));
  const [accountId, setAccountId] = useState(
    String(
      expense?.account_id ?? accounts.find((a) => a.code === '6300')?.id ?? accounts[0]?.id ?? '',
    ),
  );
  const [amount, setAmount] = useState(((expense?.amount_cents ?? 0) / 100).toFixed(2));
  const [tax, setTax] = useState(((expense?.tax_cents ?? 0) / 100).toFixed(2));
  const [paymentMethod, setPaymentMethod] = useState(expense?.payment_method ?? 'bank');
  const [postNow, setPostNow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        expenseDate,
        category,
        description,
        supplierId: supplierId ? Number(supplierId) : null,
        accountId: accountId ? Number(accountId) : null,
        amountCents: Math.round((Number(amount) || 0) * 100),
        taxCents: Math.round((Number(tax) || 0) * 100),
        paymentMethod,
        post: expense ? undefined : postNow,
      };
      if (expense) await api.put(`/expenses/${expense.id}`, body);
      else await api.post('/expenses', body);
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const total = Math.round(((Number(amount) || 0) + (Number(tax) || 0)) * 100);

  return (
    <form onSubmit={submit} className="space-y-3">
      {error ? <ErrorBox message={error} /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date">
          <input
            className={inputCls}
            type="date"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
            required
          />
        </Field>
        <Field label="Category">
          <input
            className={inputCls}
            list="expense-categories"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
          />
          <datalist id="expense-categories">
            {categories.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </Field>
        <Field label="Payment method">
          <select
            className={inputCls}
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as Expense['payment_method'])}
          >
            {METHODS.map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
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
        <Field label="Supplier (optional)">
          <select
            className={inputCls}
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">No supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Expense account">
          <select
            className={inputCls}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Net amount (R)">
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
        <Field label="VAT (R)">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.01"
            value={tax}
            onChange={(e) => setTax(e.target.value)}
          />
        </Field>
        <div className="flex items-end pb-2">
          <p className="text-sm text-slate-500">
            Total <span className="text-base font-bold text-slate-900">{money(total)}</span>
          </p>
        </div>
      </div>
      {!expense ? (
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={postNow} onChange={(e) => setPostNow(e.target.checked)} />
          Post to the ledger immediately
        </label>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : expense ? 'Save changes' : 'Capture expense'}
        </button>
      </div>
    </form>
  );
}

export default function ExpensesPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const params = new URLSearchParams({ from, to });
  if (status !== 'all') params.set('status', status);
  if (category) params.set('category', category);
  if (query) params.set('q', query);

  const expenses = useFetch<{
    expenses: Expense[];
    totals: { total_cents: number; posted_cents: number };
  }>(`/expenses?${params.toString()}`, [status, category, from, to, query]);
  const categories = useFetch<{ categories: string[] }>('/expenses/categories');
  const suppliers = useFetch<{ partners: Partner[] }>('/partners?type=supplier&limit=500');
  const accounts = useFetch<{ accounts: Account[] }>('/accounting/accounts');

  const expenseAccounts = (accounts.data?.accounts ?? []).filter(
    (account) => account.type === 'expense',
  );

  const act = async (expense: Expense, action: 'post' | 'void' | 'delete') => {
    if (action === 'delete' && !window.confirm(`Delete draft ${expense.number}?`)) return;
    if (
      action === 'void' &&
      !window.confirm(`Void ${expense.number}? A reversing entry will be posted.`)
    ) {
      return;
    }
    setBusyId(expense.id);
    setError(null);
    try {
      if (action === 'post') await api.post(`/expenses/${expense.id}/post`);
      else if (action === 'void') await api.post(`/expenses/${expense.id}/void`);
      else await api.del(`/expenses/${expense.id}`);
      expenses.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const rows = expenses.data?.expenses ?? [];

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle="Capture operating costs and post them to the ledger"
        actions={
          can('expenses.manage') ? (
            <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
              <Plus className="size-4" /> Capture expense
            </button>
          ) : null
        }
      />

      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Total in period
          </p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            {money(expenses.data?.totals.total_cents ?? 0)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Posted</p>
          <p className="mt-1 text-xl font-bold text-emerald-700">
            {money(expenses.data?.totals.posted_cents ?? 0)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Records</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{rows.length}</p>
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          className={`${inputCls} w-auto`}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {titleCase(value)}
            </option>
          ))}
        </select>
        <select
          className={`${inputCls} w-auto`}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {(categories.data?.categories ?? []).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <input
          className={`${inputCls} w-40`}
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          className={`${inputCls} w-40`}
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
          <input
            className={`${inputCls} pl-9`}
            placeholder="Search number, description, supplier…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {expenses.loading && !expenses.data ? (
        <Spinner />
      ) : expenses.error ? (
        <ErrorBox message={expenses.error} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead>
              <tr>
                <th className={thCls}>Number</th>
                <th className={thCls}>Date</th>
                <th className={thCls}>Category</th>
                <th className={thCls}>Description</th>
                <th className={thCls}>Supplier</th>
                <th className={thCls}>Method</th>
                <th className={thCls}>Status</th>
                <th className={`${thCls} text-right`}>Net</th>
                <th className={`${thCls} text-right`}>VAT</th>
                <th className={`${thCls} text-right`}>Total</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyState colSpan={11} message="No expenses in this period." />
              ) : (
                rows.map((expense) => (
                  <tr key={expense.id} className="hover:bg-slate-50">
                    <td className={`${tdCls} font-mono text-xs font-semibold`}>{expense.number}</td>
                    <td className={tdCls}>{shortDate(expense.expense_date)}</td>
                    <td className={tdCls}>{expense.category}</td>
                    <td className={tdCls}>
                      <p className="font-medium text-slate-800">{expense.description}</p>
                      <p className="text-xs text-slate-400">
                        {expense.account_code
                          ? `${expense.account_code} ${expense.account_name}`
                          : '—'}
                      </p>
                    </td>
                    <td className={tdCls}>{expense.supplier_name ?? '—'}</td>
                    <td className={tdCls}>{titleCase(expense.payment_method)}</td>
                    <td className={tdCls}>
                      <Badge value={expense.status} />
                    </td>
                    <td className={`${tdCls} text-right`}>{money(expense.amount_cents)}</td>
                    <td className={`${tdCls} text-right`}>{money(expense.tax_cents)}</td>
                    <td className={`${tdCls} text-right font-semibold`}>
                      {money(expense.total_cents)}
                    </td>
                    <td className={tdCls}>
                      <div className="flex justify-end gap-1">
                        {can('expenses.manage') && expense.status === 'draft' ? (
                          <>
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => setEditing(expense)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className={btnGhost}
                              disabled={busyId === expense.id}
                              onClick={() => void act(expense, 'post')}
                            >
                              Post
                            </button>
                            <button
                              type="button"
                              className={`${btnGhost} text-red-600`}
                              disabled={busyId === expense.id}
                              onClick={() => void act(expense, 'delete')}
                            >
                              Delete
                            </button>
                          </>
                        ) : null}
                        {can('expenses.manage') && expense.status === 'posted' ? (
                          <button
                            type="button"
                            className={`${btnGhost} text-red-600`}
                            disabled={busyId === expense.id}
                            onClick={() => void act(expense, 'void')}
                          >
                            Void
                          </button>
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
          title={editing === 'new' ? 'Capture expense' : `Edit ${editing.number}`}
          onClose={() => setEditing(null)}
          wide
        >
          <ExpenseForm
            expense={editing === 'new' ? null : editing}
            categories={categories.data?.categories ?? []}
            suppliers={suppliers.data?.partners ?? []}
            accounts={expenseAccounts}
            onSaved={() => expenses.reload()}
            onClose={() => setEditing(null)}
          />
        </Modal>
      ) : null}
    </>
  );
}
