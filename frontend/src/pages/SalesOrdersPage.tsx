import { useState, type FormEvent } from 'react';
import { PackageCheck, Pencil, Plus, Search } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../lib/useFetch';
import { addDays, money, shortDate, today } from '../lib/format';
import {
  Badge,
  btnGhost,
  btnPrimary,
  btnSecondary,
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
import {
  blankLine,
  draftFromLines,
  draftTotals,
  LineItemsEditor,
  payloadLines,
  type DraftLine,
} from '../components/LineItemsEditor';
import type { OrderLine, Partner, Product, SalesOrder, Warehouse } from '../types';

interface SalesDetail {
  salesOrder: SalesOrder;
}

interface LocationOption {
  id: number;
  name: string;
  code: string;
  warehouseName: string;
}

function locationsOf(warehouses: Warehouse[]): LocationOption[] {
  return warehouses.flatMap((warehouse) =>
    (warehouse.locations ?? []).map((location) => ({
      id: location.id,
      name: location.name,
      code: location.code,
      warehouseName: warehouse.name,
    })),
  );
}

function SalesOrderForm({
  order,
  initialLines,
  customers,
  products,
  warehouses,
  onSaved,
  onClose,
}: {
  order: SalesOrder | null;
  initialLines: OrderLine[];
  customers: Partner[];
  products: Product[];
  warehouses: Warehouse[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [customerId, setCustomerId] = useState(() =>
    String(order?.customer_id ?? customers[0]?.id ?? ''),
  );
  const [warehouseId, setWarehouseId] = useState(
    String(order?.warehouse_id ?? warehouses[0]?.id ?? ''),
  );
  const [orderDate, setOrderDate] = useState(order?.order_date ?? today());
  const [deliveryDate, setDeliveryDate] = useState(order?.delivery_date ?? addDays(today(), 3));
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [lines, setLines] = useState<DraftLine[]>(() =>
    order ? draftFromLines(initialLines, 'price') : [blankLine()],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const totals = draftTotals(lines);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        customerId: Number(customerId),
        warehouseId: warehouseId ? Number(warehouseId) : null,
        orderDate,
        deliveryDate: deliveryDate || null,
        notes: notes || null,
        lines: payloadLines(lines, 'price'),
      };
      if (order) await api.put(`/sales-orders/${order.id}`, payload);
      else await api.post('/sales-orders', payload);
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
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Customer">
          <select
            className={inputCls}
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            required
          >
            <option value="">Select customer…</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Branch">
          <select
            className={inputCls}
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Order date">
          <input
            className={inputCls}
            type="date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            required
          />
        </Field>
        <Field label="Delivery date">
          <input
            className={inputCls}
            type="date"
            value={deliveryDate ?? ''}
            onChange={(e) => setDeliveryDate(e.target.value)}
          />
        </Field>
      </div>

      <LineItemsEditor lines={lines} products={products} priceKind="price" onChange={setLines} />

      <Field label="Notes">
        <textarea
          className={inputCls}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <p className="text-sm text-slate-500">
          Order total <strong className="text-slate-900">{money(totals.totalCents)}</strong> incl.
          VAT
        </p>
        <div className="flex gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy || lines.length === 0}>
            {busy ? 'Saving…' : order ? 'Save changes' : 'Create sales order'}
          </button>
        </div>
      </div>
    </form>
  );
}

function FulfilModal({
  order,
  locations,
  onClose,
  onSaved,
}: {
  order: SalesOrder;
  locations: LocationOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [locationId, setLocationId] = useState(String(locations[0]?.id ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/sales-orders/${order.id}/fulfil`, { locationId: Number(locationId) });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (locations.length === 0) {
    return (
      <Modal title="Fulfil order" onClose={onClose}>
        <ErrorBox message="No stock locations exist. Create a warehouse and location first." />
      </Modal>
    );
  }

  return (
    <Modal title={`Fulfil ${order.number}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error ? <ErrorBox message={error} /> : null}
        <p className="text-sm text-slate-600">
          Stock will be deducted for every inventory-tracked product on this order.
        </p>
        <Field label="Pick from location">
          <select
            className={inputCls}
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            required
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.warehouseName} / {location.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy}>
            {busy ? 'Fulfilling…' : 'Fulfil order'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DetailModal({ detail, onClose }: { detail: SalesDetail; onClose: () => void }) {
  const order = detail.salesOrder;
  return (
    <Modal title={`Sales order ${order.number}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase text-slate-500">Customer</p>
            <p className="font-semibold text-slate-800">{order.customer_name}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Order date</p>
            <p className="font-semibold text-slate-800">{shortDate(order.order_date)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Delivery</p>
            <p className="font-semibold text-slate-800">{shortDate(order.delivery_date)}</p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit price</th>
                <th className="px-3 py-2 text-right">VAT</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {(order.lines ?? []).map((line) => (
                <tr key={line.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-800">{line.description}</p>
                    <p className="text-xs text-slate-400">
                      Fulfilled: {line.fulfilled_quantity ?? 0}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right">{line.quantity}</td>
                  <td className="px-3 py-2 text-right">{money(line.unit_price_cents ?? 0)}</td>
                  <td className="px-3 py-2 text-right">{money(line.line_tax_cents)}</td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {money(line.line_total_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Subtotal</p>
            <p className="font-semibold">{money(order.subtotal_cents)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">VAT</p>
            <p className="font-semibold">{money(order.tax_cents)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Total</p>
            <p className="text-lg font-bold">{money(order.total_cents)}</p>
          </div>
        </div>

        {order.invoices && order.invoices.length > 0 ? (
          <div>
            <h3 className="mb-1 text-sm font-bold text-slate-900">Invoices</h3>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="px-2 py-2">Number</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2 text-right">Total</th>
                  <th className="px-2 py-2 text-right">Paid</th>
                </tr>
              </thead>
              <tbody>
                {order.invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-t border-slate-100">
                    <td className="px-2 py-2 font-mono text-xs">{invoice.number}</td>
                    <td className="px-2 py-2">
                      <Badge value={invoice.status} />
                    </td>
                    <td className="px-2 py-2 text-right">{money(invoice.total_cents)}</td>
                    <td className="px-2 py-2 text-right">{money(invoice.amount_paid_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {order.notes ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{order.notes}</p>
        ) : null}
      </div>
    </Modal>
  );
}

export default function SalesOrdersPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [editing, setEditing] = useState<{ order: SalesOrder; lines: OrderLine[] } | 'new' | null>(
    null,
  );
  const [viewing, setViewing] = useState<SalesOrder | null>(null);
  const [fulfilling, setFulfilling] = useState<SalesOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (query) params.set('q', query);
  if (warehouseId) params.set('warehouseId', warehouseId);

  const orders = useFetch<{ salesOrders: SalesOrder[]; total: number }>(
    `/sales-orders?${params.toString()}`,
    [status, query, warehouseId],
  );
  const customers = useFetch<{ partners: Partner[] }>('/partners?type=customer&limit=500');
  const products = useFetch<{ products: Product[] }>('/products?limit=1000');
  const warehouses = useFetch<{ warehouses: Warehouse[] }>('/inventory/warehouses');
  const locations = locationsOf(warehouses.data?.warehouses ?? []);

  const run = async (action: () => Promise<unknown>, success?: string) => {
    setError(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
      orders.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const openDetail = async (order: SalesOrder) => {
    setError(null);
    try {
      const detail = await api.get<SalesDetail>(`/sales-orders/${order.id}`);
      setViewing(detail.salesOrder);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const startEdit = async (order: SalesOrder) => {
    setError(null);
    try {
      const detail = await api.get<SalesDetail>(`/sales-orders/${order.id}`);
      setEditing({ order: detail.salesOrder, lines: detail.salesOrder.lines ?? [] });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const createInvoice = (order: SalesOrder) =>
    run(async () => {
      const result = await api.post<{ invoice: { number: string } }>(
        `/sales-orders/${order.id}/invoice`,
      );
      setNotice(`Invoice ${result.invoice.number} created and posted.`);
    });

  return (
    <>
      <PageHeader
        title="Sales orders"
        subtitle="Capture customer orders, fulfil stock and raise invoices"
        actions={
          can('sales.manage') ? (
            <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
              <Plus className="size-4" /> New sales order
            </button>
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-lg border border-slate-200 bg-white p-1">
          {(
            [
              ['all', 'All'],
              ['draft', 'Draft'],
              ['confirmed', 'Confirmed'],
              ['fulfilled', 'Fulfilled'],
              ['invoiced', 'Invoiced'],
              ['cancelled', 'Cancelled'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                status === value ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
          <input
            className={`${inputCls} pl-9`}
            placeholder="Search number or customer…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          className={`${inputCls} w-auto`}
          value={warehouseId}
          onChange={(event) => setWarehouseId(event.target.value)}
        >
          <option value="">All branches</option>
          {(warehouses.data?.warehouses ?? []).map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}
            </option>
          ))}
        </select>
        <span className="text-sm text-slate-500">{orders.data?.total ?? 0} order(s)</span>
      </div>

      {error ? <ErrorBox message={error} /> : null}
      {notice ? (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}

      {orders.loading && !orders.data ? (
        <Spinner />
      ) : orders.error ? (
        <ErrorBox message={orders.error} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr>
                <th className={thCls}>Number</th>
                <th className={thCls}>Customer</th>
                <th className={thCls}>Branch</th>
                <th className={thCls}>Ordered</th>
                <th className={thCls}>Delivery</th>
                <th className={thCls}>Status</th>
                <th className={`${thCls} text-right`}>Total</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {!orders.data || orders.data.salesOrders.length === 0 ? (
                <EmptyState colSpan={8} message="No sales orders found." />
              ) : (
                orders.data.salesOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50">
                    <td className={`${tdCls} font-mono text-xs font-semibold text-slate-700`}>
                      {order.number}
                    </td>
                    <td className={tdCls}>
                      <p className="font-semibold text-slate-800">{order.customer_name}</p>
                      <p className="text-xs text-slate-400">{order.line_count ?? 0} line(s)</p>
                    </td>
                    <td className={tdCls}>{order.warehouse_name ?? '—'}</td>
                    <td className={tdCls}>{shortDate(order.order_date)}</td>
                    <td className={tdCls}>{shortDate(order.delivery_date)}</td>
                    <td className={tdCls}>
                      <Badge value={order.status} />
                    </td>
                    <td className={`${tdCls} text-right font-semibold`}>
                      {money(order.total_cents)}
                    </td>
                    <td className={tdCls}>
                      <div className="flex flex-wrap justify-end gap-1">
                        <button
                          type="button"
                          className={btnGhost}
                          onClick={() => openDetail(order)}
                        >
                          View
                        </button>
                        {can('sales.manage') && order.status === 'draft' ? (
                          <>
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => startEdit(order)}
                            >
                              <Pencil className="size-3.5" /> Edit
                            </button>
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() =>
                                run(
                                  () => api.post(`/sales-orders/${order.id}/confirm`),
                                  'Order confirmed.',
                                )
                              }
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              className={`${btnGhost} text-red-600`}
                              onClick={() => {
                                if (window.confirm(`Cancel ${order.number}?`)) {
                                  void run(
                                    () => api.post(`/sales-orders/${order.id}/cancel`),
                                    'Order cancelled.',
                                  );
                                }
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : null}
                        {can('sales.manage') && order.status === 'confirmed' ? (
                          <>
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => setFulfilling(order)}
                            >
                              <PackageCheck className="size-3.5" /> Fulfil
                            </button>
                            <button
                              type="button"
                              className={`${btnGhost} text-red-600`}
                              onClick={() => {
                                if (window.confirm(`Cancel ${order.number}?`)) {
                                  void run(
                                    () => api.post(`/sales-orders/${order.id}/cancel`),
                                    'Order cancelled.',
                                  );
                                }
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : null}
                        {can('invoices.manage') &&
                        (order.status === 'confirmed' || order.status === 'fulfilled') ? (
                          <button
                            type="button"
                            className={btnGhost}
                            onClick={() => createInvoice(order)}
                          >
                            Invoice
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
          title={editing === 'new' ? 'New sales order' : `Edit ${editing.order.number}`}
          onClose={() => setEditing(null)}
          wide
        >
          <SalesOrderForm
            order={editing === 'new' ? null : editing.order}
            initialLines={editing === 'new' ? [] : editing.lines}
            customers={customers.data?.partners ?? []}
            products={products.data?.products ?? []}
            warehouses={warehouses.data?.warehouses ?? []}
            onSaved={orders.reload}
            onClose={() => setEditing(null)}
          />
        </Modal>
      ) : null}

      {viewing ? (
        <DetailModal detail={{ salesOrder: viewing }} onClose={() => setViewing(null)} />
      ) : null}

      {fulfilling ? (
        <FulfilModal
          order={fulfilling}
          locations={locations}
          onClose={() => setFulfilling(null)}
          onSaved={() => {
            orders.reload();
            setNotice('Order fulfilled. Stock has been issued.');
          }}
        />
      ) : null}
    </>
  );
}
