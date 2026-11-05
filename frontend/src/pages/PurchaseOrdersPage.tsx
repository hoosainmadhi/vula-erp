import { useState, type FormEvent } from 'react';
import { ClipboardList, Pencil, Plus, Search } from 'lucide-react';
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
import type { GoodsReceipt, OrderLine, Partner, Product, PurchaseOrder, Warehouse } from '../types';

interface PurchaseDetail {
  purchaseOrder: PurchaseOrder;
  lines: OrderLine[];
  receipts: GoodsReceipt[];
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

function PurchaseOrderForm({
  order,
  initialLines,
  suppliers,
  products,
  warehouses,
  onSaved,
  onClose,
}: {
  order: PurchaseOrder | null;
  initialLines: OrderLine[];
  suppliers: Partner[];
  products: Product[];
  warehouses: Warehouse[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [supplierId, setSupplierId] = useState(() =>
    String(order?.supplier_id ?? suppliers[0]?.id ?? ''),
  );
  const [warehouseId, setWarehouseId] = useState(
    String(order?.warehouse_id ?? warehouses[0]?.id ?? ''),
  );
  const [orderDate, setOrderDate] = useState(order?.order_date ?? today());
  const [expectedDate, setExpectedDate] = useState(order?.expected_date ?? addDays(today(), 7));
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [lines, setLines] = useState<DraftLine[]>(() =>
    order ? draftFromLines(initialLines, 'cost') : [blankLine()],
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
        supplierId: Number(supplierId),
        warehouseId: warehouseId ? Number(warehouseId) : null,
        orderDate,
        expectedDate: expectedDate || null,
        notes: notes || null,
        lines: payloadLines(lines, 'cost'),
      };
      if (order) await api.put(`/purchase-orders/${order.id}`, payload);
      else await api.post('/purchase-orders', payload);
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
        <Field label="Supplier">
          <select
            className={inputCls}
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            required
          >
            <option value="">Select supplier…</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
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
        <Field label="Expected date">
          <input
            className={inputCls}
            type="date"
            value={expectedDate ?? ''}
            onChange={(e) => setExpectedDate(e.target.value)}
          />
        </Field>
      </div>

      <LineItemsEditor lines={lines} products={products} priceKind="cost" onChange={setLines} />

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
            {busy ? 'Saving…' : order ? 'Save changes' : 'Create purchase order'}
          </button>
        </div>
      </div>
    </form>
  );
}

function ReceiveModal({
  detail,
  locations,
  onClose,
  onSaved,
}: {
  detail: PurchaseDetail;
  locations: LocationOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [locationId, setLocationId] = useState(String(locations[0]?.id ?? ''));
  const [receivedDate, setReceivedDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [quantities, setQuantities] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      detail.lines.map((line) => [
        line.id,
        String(Math.max(0, (line.quantity ?? 0) - (line.received_quantity ?? 0))),
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const lines = detail.lines
        .map((line) => ({
          purchaseOrderLineId: line.id,
          quantity: Number(quantities[line.id] ?? 0),
        }))
        .filter((line) => line.quantity > 0);
      await api.post(`/purchase-orders/${detail.purchaseOrder.id}/receive`, {
        locationId: Number(locationId),
        receivedDate,
        notes: notes || null,
        ...(lines.length > 0 ? { lines } : {}),
      });
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
      <Modal title="Receive goods" onClose={onClose}>
        <ErrorBox message="No stock locations exist. Create a warehouse and location first." />
      </Modal>
    );
  }

  return (
    <Modal title={`Receive ${detail.purchaseOrder.number}`} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {error ? <ErrorBox message={error} /> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Location">
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
          <Field label="Received date">
            <input
              className={inputCls}
              type="date"
              value={receivedDate}
              onChange={(e) => setReceivedDate(e.target.value)}
              required
            />
          </Field>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">Ordered</th>
                <th className="px-3 py-2 text-right">Received</th>
                <th className="px-3 py-2 text-right">Receive now</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((line) => (
                <tr key={line.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-800">{line.description}</p>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">{line.quantity}</td>
                  <td className="px-3 py-2 text-right text-slate-600">
                    {line.received_quantity ?? 0}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      className={`${inputCls} w-24 px-2 py-1 text-right`}
                      type="number"
                      min={0}
                      step="0.01"
                      max={(line.quantity ?? 0) - (line.received_quantity ?? 0)}
                      value={quantities[line.id] ?? '0'}
                      onChange={(event) =>
                        setQuantities({ ...quantities, [line.id]: event.target.value })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Field label="Notes">
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy}>
            {busy ? 'Receiving…' : 'Receive goods'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DetailModal({ detail, onClose }: { detail: PurchaseDetail; onClose: () => void }) {
  return (
    <Modal title={`Purchase order ${detail.purchaseOrder.number}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase text-slate-500">Supplier</p>
            <p className="font-semibold text-slate-800">{detail.purchaseOrder.supplier_name}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Order date</p>
            <p className="font-semibold text-slate-800">
              {shortDate(detail.purchaseOrder.order_date)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Expected</p>
            <p className="font-semibold text-slate-800">
              {shortDate(detail.purchaseOrder.expected_date)}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit cost</th>
                <th className="px-3 py-2 text-right">VAT</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((line) => (
                <tr key={line.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-800">{line.description}</p>
                    <p className="text-xs text-slate-400">
                      Received: {line.received_quantity ?? 0}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right">{line.quantity}</td>
                  <td className="px-3 py-2 text-right">{money(line.unit_cost_cents ?? 0)}</td>
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
            <p className="font-semibold">{money(detail.purchaseOrder.subtotal_cents)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">VAT</p>
            <p className="font-semibold">{money(detail.purchaseOrder.tax_cents)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Total</p>
            <p className="text-lg font-bold">{money(detail.purchaseOrder.total_cents)}</p>
          </div>
        </div>

        {detail.receipts.length > 0 ? (
          <div>
            <h3 className="mb-1 text-sm font-bold text-slate-900">Goods receipts</h3>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="px-2 py-2">Number</th>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {detail.receipts.map((receipt) => (
                  <tr key={receipt.id} className="border-t border-slate-100">
                    <td className="px-2 py-2 font-mono text-xs">{receipt.number}</td>
                    <td className="px-2 py-2">{shortDate(receipt.received_date)}</td>
                    <td className="px-2 py-2 text-slate-500">{receipt.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {detail.purchaseOrder.notes ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {detail.purchaseOrder.notes}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

export default function PurchaseOrdersPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [editing, setEditing] = useState<
    { order: PurchaseOrder; lines: OrderLine[] } | 'new' | null
  >(null);
  const [viewing, setViewing] = useState<PurchaseDetail | null>(null);
  const [receiving, setReceiving] = useState<PurchaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (query) params.set('q', query);
  if (warehouseId) params.set('warehouseId', warehouseId);

  const orders = useFetch<{ purchaseOrders: PurchaseOrder[]; total: number }>(
    `/purchase-orders?${params.toString()}`,
    [status, query, warehouseId],
  );
  const suppliers = useFetch<{ partners: Partner[] }>('/partners?type=supplier&limit=500');
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

  const openDetail = async (order: PurchaseOrder) => {
    setError(null);
    try {
      setViewing(await api.get<PurchaseDetail>(`/purchase-orders/${order.id}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const startEdit = async (order: PurchaseOrder) => {
    setError(null);
    try {
      const detail = await api.get<PurchaseDetail>(`/purchase-orders/${order.id}`);
      setEditing({ order: detail.purchaseOrder, lines: detail.lines });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const startReceive = async (order: PurchaseOrder) => {
    setError(null);
    try {
      setReceiving(await api.get<PurchaseDetail>(`/purchase-orders/${order.id}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const createBill = (order: PurchaseOrder) =>
    run(async () => {
      const result = await api.post<{ invoice: { number: string } }>(
        `/invoices/from-purchase-order/${order.id}`,
      );
      setNotice(`Supplier bill ${result.invoice.number} created and posted.`);
    });

  return (
    <>
      <PageHeader
        title="Purchase orders"
        subtitle="Order from suppliers, receive stock and capture supplier bills"
        actions={
          can('purchases.manage') ? (
            <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
              <Plus className="size-4" /> New purchase order
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
              ['received', 'Received'],
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
            placeholder="Search number or supplier…"
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
                <th className={thCls}>Supplier</th>
                <th className={thCls}>Branch</th>
                <th className={thCls}>Ordered</th>
                <th className={thCls}>Expected</th>
                <th className={thCls}>Status</th>
                <th className={`${thCls} text-right`}>Total</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {!orders.data || orders.data.purchaseOrders.length === 0 ? (
                <EmptyState colSpan={8} message="No purchase orders found." />
              ) : (
                orders.data.purchaseOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50">
                    <td className={`${tdCls} font-mono text-xs font-semibold text-slate-700`}>
                      {order.number}
                    </td>
                    <td className={tdCls}>
                      <p className="font-semibold text-slate-800">{order.supplier_name}</p>
                      <p className="text-xs text-slate-400">{order.line_count ?? 0} line(s)</p>
                    </td>
                    <td className={tdCls}>{order.warehouse_name ?? '—'}</td>
                    <td className={tdCls}>{shortDate(order.order_date)}</td>
                    <td className={tdCls}>{shortDate(order.expected_date)}</td>
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
                        {can('purchases.manage') && order.status === 'draft' ? (
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
                                  () => api.post(`/purchase-orders/${order.id}/confirm`),
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
                                    () => api.post(`/purchase-orders/${order.id}/cancel`),
                                    'Order cancelled.',
                                  );
                                }
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : null}
                        {can('purchases.manage') && order.status === 'confirmed' ? (
                          <>
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => startReceive(order)}
                            >
                              <ClipboardList className="size-3.5" /> Receive
                            </button>
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => createBill(order)}
                            >
                              Create bill
                            </button>
                            <button
                              type="button"
                              className={`${btnGhost} text-red-600`}
                              onClick={() => {
                                if (window.confirm(`Cancel ${order.number}?`)) {
                                  void run(
                                    () => api.post(`/purchase-orders/${order.id}/cancel`),
                                    'Order cancelled.',
                                  );
                                }
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : null}
                        {can('invoices.manage') && order.status === 'received' ? (
                          <button
                            type="button"
                            className={btnGhost}
                            onClick={() => createBill(order)}
                          >
                            Create bill
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
          title={editing === 'new' ? 'New purchase order' : `Edit ${editing.order.number}`}
          onClose={() => setEditing(null)}
          wide
        >
          <PurchaseOrderForm
            order={editing === 'new' ? null : editing.order}
            initialLines={editing === 'new' ? [] : editing.lines}
            suppliers={suppliers.data?.partners ?? []}
            products={products.data?.products ?? []}
            warehouses={warehouses.data?.warehouses ?? []}
            onSaved={orders.reload}
            onClose={() => setEditing(null)}
          />
        </Modal>
      ) : null}

      {viewing ? <DetailModal detail={viewing} onClose={() => setViewing(null)} /> : null}

      {receiving ? (
        <ReceiveModal
          detail={receiving}
          locations={locations}
          onClose={() => setReceiving(null)}
          onSaved={() => {
            orders.reload();
            setNotice('Goods received into stock.');
          }}
        />
      ) : null}
    </>
  );
}
