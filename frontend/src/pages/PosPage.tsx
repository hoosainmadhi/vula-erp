import { useMemo, useState, type FormEvent } from 'react';
import { Minus, Plus, Receipt, Search, ShoppingCart, Trash2, Wallet } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../lib/useFetch';
import { money, shortDate, titleCase } from '../lib/format';
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
import type { PosCustomer, PosOrder, PosProduct, PosRegister, PosSession } from '../types';

type Tab = 'register' | 'sessions';

interface CartLine {
  product: PosProduct;
  quantity: number;
}

const PAYMENT_METHODS = ['cash', 'card', 'eft'] as const;

function lineTotals(quantity: number, unitPriceCents: number, rateBp: number) {
  const subtotal = Math.round(quantity * unitPriceCents);
  const tax = Math.round((subtotal * rateBp) / 10_000);
  return { subtotal, tax, total: subtotal + tax };
}

function CloseSessionForm({
  session,
  onSaved,
  onClose,
}: {
  session: PosSession;
  onSaved: () => void;
  onClose: () => void;
}) {
  const expected = session.live_expected_cash_cents ?? session.expected_cash_cents;
  const [closing, setClosing] = useState(((expected || 0) / 100).toFixed(2));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/pos/sessions/${session.id}/close`, {
        closingCashCents: Math.round((Number(closing) || 0) * 100),
        notes: notes || null,
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
      <div className="rounded-lg bg-slate-50 p-3 text-sm">
        <p className="text-slate-500">Expected cash in drawer</p>
        <p className="text-xl font-bold text-slate-900">{money(expected)}</p>
      </div>
      <Field label="Counted cash (R)">
        <input
          className={inputCls}
          type="number"
          min={0}
          step="0.01"
          value={closing}
          onChange={(event) => setClosing(event.target.value)}
        />
      </Field>
      <Field label="Notes">
        <textarea
          className={inputCls}
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Closing…' : 'Close session'}
        </button>
      </div>
    </form>
  );
}

export default function PosPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('register');
  const [registerId, setRegisterId] = useState('');
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'eft'>('cash');
  const [tendered, setTendered] = useState('');
  const [receipt, setReceipt] = useState<PosOrder | null>(null);
  const [openingFloat, setOpeningFloat] = useState('0.00');
  const [closingSession, setClosingSession] = useState<PosSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const registers = useFetch<{ registers: PosRegister[] }>('/pos/registers');
  const sessions = useFetch<{ sessions: PosSession[] }>('/pos/sessions?status=open');
  const customers = useFetch<{ customers: PosCustomer[] }>('/pos/customers');
  const summary = useFetch<{
    today: { order_count: number; sales_cents: number };
    openSessions: PosSession[];
  }>('/pos/summary');

  const activeRegister =
    registers.data?.registers.find((register) => String(register.id) === registerId) ??
    registers.data?.registers.find((register) => register.open_session_id) ??
    registers.data?.registers[0];

  const products = useFetch<{ products: PosProduct[] }>(
    activeRegister
      ? `/pos/products?registerId=${activeRegister.id}&${new URLSearchParams(query ? { q: query } : {})}`
      : null,
    [activeRegister?.id, query],
  );

  const openSession = sessions.data?.sessions.find(
    (session) => session.register_id === activeRegister?.id,
  );

  const totals = useMemo(() => {
    return cart.reduce(
      (total, line) => {
        const lineTotal = lineTotals(
          line.quantity,
          line.product.sale_price_cents,
          line.product.tax_rate_bp,
        );
        return {
          subtotal: total.subtotal + lineTotal.subtotal,
          tax: total.tax + lineTotal.tax,
          total: total.total + lineTotal.total,
        };
      },
      { subtotal: 0, tax: 0, total: 0 },
    );
  }, [cart]);

  const tenderedCents = Math.round((Number(tendered) || 0) * 100);
  const effectiveTendered =
    paymentMethod === 'cash' && tenderedCents > 0 ? tenderedCents : totals.total;
  const change = paymentMethod === 'cash' ? Math.max(0, effectiveTendered - totals.total) : 0;

  const addProduct = (product: PosProduct) => {
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [...current, { product, quantity: 1 }];
    });
  };

  const setQuantity = (productId: number, quantity: number) => {
    if (quantity <= 0) {
      setCart((current) => current.filter((line) => line.product.id !== productId));
      return;
    }
    setCart((current) =>
      current.map((line) => (line.product.id === productId ? { ...line, quantity } : line)),
    );
  };

  const openSessionNow = async () => {
    if (!activeRegister) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/pos/sessions', {
        registerId: activeRegister.id,
        openingFloatCents: Math.round((Number(openingFloat) || 0) * 100),
      });
      sessions.reload();
      summary.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const checkout = async () => {
    if (!activeRegister || !openSession) return;
    if (cart.length === 0) {
      setError('Add at least one product to the sale.');
      return;
    }
    if (paymentMethod === 'cash' && effectiveTendered < totals.total) {
      setError('Cash tendered is less than the sale total.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ order: PosOrder }>('/pos/orders', {
        registerId: activeRegister.id,
        sessionId: openSession.id,
        customerId: customerId ? Number(customerId) : null,
        paymentMethod,
        amountTenderedCents: paymentMethod === 'cash' ? effectiveTendered : totals.total,
        lines: cart.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
        })),
      });
      setReceipt(result.order);
      setCart([]);
      setTendered('');
      setCustomerId('');
      products.reload();
      sessions.reload();
      summary.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const registerRows = registers.data?.registers ?? [];
  const sessionRows = sessions.data?.sessions ?? [];
  const customerRows = customers.data?.customers ?? [];
  const productRows = products.data?.products ?? [];

  return (
    <>
      <PageHeader
        title="Point of Sale"
        subtitle="Trade-counter register, cash sales and session cash-up"
        actions={
          <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            <Wallet className="size-4 text-emerald-600" />
            <span className="font-semibold text-slate-900">
              {money(summary.data?.today.sales_cents ?? 0)}
            </span>
            today
            <span className="text-slate-400">·</span>
            {summary.data?.today.order_count ?? 0} sales
          </span>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {(
            [
              ['register', 'Register'],
              ['sessions', 'Sessions'],
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
        <select
          className={`${inputCls} w-auto`}
          value={String(activeRegister?.id ?? '')}
          onChange={(event) => setRegisterId(event.target.value)}
        >
          {registerRows.map((register) => (
            <option key={register.id} value={register.id}>
              {register.name} ({register.code})
            </option>
          ))}
        </select>
        {openSession ? (
          <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Session open · {openSession.cashier_name ?? 'cashier'}
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            No open session
          </span>
        )}
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {tab === 'register' ? (
        !activeRegister ? (
          <Spinner />
        ) : !openSession ? (
          <Card className="max-w-lg p-5">
            <h2 className="text-base font-bold text-slate-900">Open {activeRegister.name}</h2>
            <p className="mt-1 text-sm text-slate-500">
              Count the opening float before taking the first sale.
            </p>
            <div className="mt-4 space-y-3">
              <Field label="Opening float (R)">
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  step="0.01"
                  value={openingFloat}
                  onChange={(event) => setOpeningFloat(event.target.value)}
                />
              </Field>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy || !can('pos.manage')}
                onClick={() => void openSessionNow()}
              >
                Open session
              </button>
            </div>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
            <Card className="p-4">
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
                <input
                  className={`${inputCls} pl-9`}
                  placeholder="Scan or search products…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  autoFocus
                />
              </div>
              {products.loading && !products.data ? (
                <Spinner />
              ) : products.error ? (
                <ErrorBox message={products.error} />
              ) : productRows.length === 0 ? (
                <EmptyState colSpan={1} message="No products found." />
              ) : (
                <div className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                  {productRows.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => addProduct(product)}
                      className="rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-emerald-400 hover:bg-emerald-50"
                    >
                      <p className="line-clamp-2 text-sm font-semibold text-slate-800">
                        {product.name}
                      </p>
                      <p className="font-mono text-[11px] text-slate-400">{product.sku}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-sm font-bold text-emerald-700">
                          {money(product.sale_price_cents)}
                        </span>
                        <span className="text-xs text-slate-400">
                          {product.track_inventory === 1
                            ? `${product.stock_quantity} in stock`
                            : 'service'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {cart.length > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    document.getElementById('pos-cart')?.scrollIntoView({ behavior: 'smooth' })
                  }
                  className="sticky bottom-20 mt-3 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-lg lg:hidden"
                >
                  Cart · {cart.length} item{cart.length === 1 ? '' : 's'} · {money(totals.total)}
                </button>
              ) : null}
            </Card>

            <Card id="pos-cart" className="flex flex-col p-4">
              <div className="mb-3 flex items-center gap-2">
                <ShoppingCart className="size-4 text-emerald-600" />
                <h2 className="text-sm font-bold text-slate-900">Current sale</h2>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto">
                {cart.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">
                    Tap a product to add it to the sale.
                  </p>
                ) : (
                  cart.map((line) => (
                    <div
                      key={line.product.id}
                      className="flex items-center gap-2 rounded-lg border border-slate-200 p-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800">
                          {line.product.name}
                        </p>
                        <p className="text-xs text-slate-400">
                          {money(line.product.sale_price_cents)} each
                        </p>
                      </div>
                      <button
                        type="button"
                        className={btnGhost}
                        onClick={() => setQuantity(line.product.id, line.quantity - 1)}
                      >
                        <Minus className="size-3.5" />
                      </button>
                      <span className="w-6 text-center text-sm font-semibold">{line.quantity}</span>
                      <button
                        type="button"
                        className={btnGhost}
                        onClick={() => setQuantity(line.product.id, line.quantity + 1)}
                      >
                        <Plus className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        className={btnGhost}
                        onClick={() => setQuantity(line.product.id, 0)}
                      >
                        <Trash2 className="size-3.5 text-red-500" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
                <Field label="Customer (optional)">
                  <select
                    className={inputCls}
                    value={customerId}
                    onChange={(event) => setCustomerId(event.target.value)}
                  >
                    <option value="">Walk-in customer</option>
                    {customerRows.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Subtotal</span>
                  <span className="font-semibold">{money(totals.subtotal)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">VAT</span>
                  <span className="font-semibold">{money(totals.tax)}</span>
                </div>
                <div className="flex items-center justify-between text-lg">
                  <span className="font-bold text-slate-900">Total</span>
                  <span className="font-bold text-emerald-700">{money(totals.total)}</span>
                </div>
                <Field label="Payment method">
                  <select
                    className={inputCls}
                    value={paymentMethod}
                    onChange={(event) =>
                      setPaymentMethod(event.target.value as 'cash' | 'card' | 'eft')
                    }
                  >
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {titleCase(method)}
                      </option>
                    ))}
                  </select>
                </Field>
                {paymentMethod === 'cash' ? (
                  <>
                    <Field label="Cash tendered (R)">
                      <input
                        className={inputCls}
                        type="number"
                        min={0}
                        step="0.01"
                        value={tendered}
                        onChange={(event) => setTendered(event.target.value)}
                      />
                    </Field>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">Change</span>
                      <span className="font-bold text-slate-900">{money(change)}</span>
                    </div>
                  </>
                ) : null}
                <button
                  type="button"
                  className={`${btnPrimary} w-full`}
                  disabled={busy || cart.length === 0 || !can('pos.manage')}
                  onClick={() => void checkout()}
                >
                  {busy ? 'Processing…' : `Charge ${money(totals.total)}`}
                </button>
              </div>
            </Card>
          </div>
        )
      ) : null}

      {tab === 'sessions' ? (
        sessions.loading && !sessions.data ? (
          <Spinner />
        ) : sessions.error ? (
          <ErrorBox message={sessions.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Register</th>
                  <th className={thCls}>Cashier</th>
                  <th className={thCls}>Opened</th>
                  <th className={thCls}>Status</th>
                  <th className={`${thCls} text-right`}>Opening float</th>
                  <th className={`${thCls} text-right`}>Sales</th>
                  <th className={`${thCls} text-right`}>Expected cash</th>
                  <th className={`${thCls} text-right`}>Difference</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {sessionRows.length === 0 ? (
                  <EmptyState colSpan={9} message="No open sessions." />
                ) : (
                  sessionRows.map((session) => (
                    <tr key={session.id} className="hover:bg-slate-50">
                      <td className={tdCls}>
                        <p className="font-semibold text-slate-800">{session.register_name}</p>
                        <p className="font-mono text-xs text-slate-400">{session.register_code}</p>
                      </td>
                      <td className={tdCls}>{session.cashier_name ?? '—'}</td>
                      <td className={tdCls}>{shortDate(session.opened_at)}</td>
                      <td className={tdCls}>
                        <Badge value={session.status} />
                      </td>
                      <td className={`${tdCls} text-right`}>
                        {money(session.opening_float_cents)}
                      </td>
                      <td className={`${tdCls} text-right`}>{money(session.sales_cents ?? 0)}</td>
                      <td className={`${tdCls} text-right`}>
                        {money(session.live_expected_cash_cents ?? session.expected_cash_cents)}
                      </td>
                      <td className={`${tdCls} text-right`}>{money(session.difference_cents)}</td>
                      <td className={tdCls}>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            className={btnGhost}
                            disabled={!can('pos.manage')}
                            onClick={() => setClosingSession(session)}
                          >
                            <Receipt className="size-3.5" /> Cash up
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

      {receipt ? (
        <Modal title="Sale complete" onClose={() => setReceipt(null)}>
          <div className="space-y-3">
            <div className="rounded-lg bg-emerald-50 p-4 text-center">
              <p className="text-sm text-emerald-700">Change due</p>
              <p className="text-3xl font-bold text-emerald-800">{money(receipt.change_cents)}</p>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Receipt</span>
                <span className="font-mono font-semibold">{receipt.number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Invoice</span>
                <span className="font-mono">{receipt.invoice_number ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Payment</span>
                <span>{titleCase(receipt.payment_method)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Total</span>
                <span className="font-semibold">{money(receipt.total_cents)}</span>
              </div>
            </div>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {(receipt.lines ?? []).map((line) => (
                <div key={line.id} className="flex justify-between px-3 py-2 text-sm">
                  <span>
                    {line.description} × {line.quantity}
                  </span>
                  <span className="font-semibold">{money(line.line_total_cents)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={() => window.print()}>
                Print
              </button>
              <button type="button" className={btnPrimary} onClick={() => setReceipt(null)}>
                Done
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {closingSession ? (
        <Modal title="Cash up session" onClose={() => setClosingSession(null)}>
          <CloseSessionForm
            session={closingSession}
            onSaved={() => {
              sessions.reload();
              summary.reload();
            }}
            onClose={() => setClosingSession(null)}
          />
        </Modal>
      ) : null}
    </>
  );
}
