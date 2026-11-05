import { useState, type FormEvent } from 'react';
import { ArrowLeftRight, Plus, Search } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../lib/useFetch';
import { dateTime, money, titleCase } from '../lib/format';
import {
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
import type { Product, StockMove, StockRow, Warehouse } from '../types';

type Tab = 'stock' | 'moves' | 'warehouses';

export default function InventoryPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('stock');
  const [query, setQuery] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  const [locationFor, setLocationFor] = useState<Warehouse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stock = useFetch<{ stock: StockRow[]; totalValueCents: number }>(
    `/inventory/stock?${new URLSearchParams({
      ...(query ? { q: query } : {}),
      ...(lowOnly ? { lowOnly: 'true' } : {}),
    }).toString()}`,
    [query, lowOnly],
  );
  const moves = useFetch<{ moves: StockMove[] }>('/inventory/stock/moves?limit=200');
  const warehouses = useFetch<{ warehouses: Warehouse[] }>('/inventory/warehouses');
  const products = useFetch<{ products: Product[] }>('/products?limit=1000');

  const locations = (warehouses.data?.warehouses ?? []).flatMap((warehouse) =>
    (warehouse.locations ?? []).map((location) => ({
      ...location,
      warehouseName: warehouse.name,
    })),
  );

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Stock on hand, movements and locations"
        actions={
          can('inventory.adjust') ? (
            <button type="button" className={btnPrimary} onClick={() => setAdjustOpen(true)}>
              <ArrowLeftRight className="size-4" /> Adjust stock
            </button>
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {(
            [
              ['stock', 'Stock on hand'],
              ['moves', 'Movements'],
              ['warehouses', 'Warehouses'],
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
        {tab === 'stock' ? (
          <>
            <div className="relative min-w-56 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
              <input
                className={`${inputCls} pl-9`}
                placeholder="Search product or SKU…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={lowOnly}
                onChange={(e) => setLowOnly(e.target.checked)}
              />{' '}
              Low stock only
            </label>
          </>
        ) : null}
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {tab === 'stock' ? (
        stock.loading && !stock.data ? (
          <Spinner />
        ) : stock.error ? (
          <ErrorBox message={stock.error} />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-3 text-sm">
              <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-600">
                Products:{' '}
                <strong className="text-slate-900">{stock.data?.stock.length ?? 0}</strong>
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-600">
                Stock value at cost:{' '}
                <strong className="text-slate-900">
                  {money(stock.data?.totalValueCents ?? 0)}
                </strong>
              </span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead>
                  <tr>
                    <th className={thCls}>SKU</th>
                    <th className={thCls}>Product</th>
                    <th className={thCls}>Category</th>
                    <th className={`${thCls} text-right`}>On hand</th>
                    <th className={`${thCls} text-right`}>Reorder at</th>
                    <th className={`${thCls} text-right`}>Unit cost</th>
                    <th className={`${thCls} text-right`}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {!stock.data || stock.data.stock.length === 0 ? (
                    <EmptyState colSpan={7} message="No tracked stock found." />
                  ) : (
                    stock.data.stock.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className={`${tdCls} font-mono text-xs text-slate-500`}>{row.sku}</td>
                        <td className={`${tdCls} font-semibold text-slate-800`}>{row.name}</td>
                        <td className={tdCls}>{row.category_name ?? '—'}</td>
                        <td
                          className={`${tdCls} text-right font-semibold ${
                            row.quantity <= row.reorder_level ? 'text-amber-700' : 'text-slate-800'
                          }`}
                        >
                          {row.quantity} {row.uom}
                        </td>
                        <td className={`${tdCls} text-right text-slate-500`}>
                          {row.reorder_level}
                        </td>
                        <td className={`${tdCls} text-right text-slate-500`}>
                          {money(row.cost_cents)}
                        </td>
                        <td className={`${tdCls} text-right font-semibold`}>
                          {money(Math.round(row.value_cents))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : null}

      {tab === 'moves' ? (
        moves.loading && !moves.data ? (
          <Spinner />
        ) : moves.error ? (
          <ErrorBox message={moves.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>When</th>
                  <th className={thCls}>Product</th>
                  <th className={thCls}>Type</th>
                  <th className={thCls}>Location</th>
                  <th className={`${thCls} text-right`}>Qty</th>
                  <th className={thCls}>Reference</th>
                  <th className={thCls}>By</th>
                </tr>
              </thead>
              <tbody>
                {!moves.data || moves.data.moves.length === 0 ? (
                  <EmptyState colSpan={7} message="No stock movements yet." />
                ) : (
                  moves.data.moves.map((move) => (
                    <tr key={move.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} whitespace-nowrap text-xs text-slate-500`}>
                        {dateTime(move.created_at)}
                      </td>
                      <td className={tdCls}>
                        <p className="font-semibold text-slate-800">{move.product_name}</p>
                        <p className="font-mono text-xs text-slate-400">{move.sku}</p>
                      </td>
                      <td className={tdCls}>{titleCase(move.move_type)}</td>
                      <td className={tdCls}>
                        {move.warehouse_name} / {move.location_name}
                      </td>
                      <td
                        className={`${tdCls} text-right font-semibold ${
                          move.quantity >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {move.quantity > 0 ? '+' : ''}
                        {move.quantity}
                      </td>
                      <td className={`${tdCls} text-xs text-slate-500`}>
                        {move.reference_type
                          ? `${titleCase(move.reference_type)} #${move.reference_id}`
                          : '—'}
                      </td>
                      <td className={`${tdCls} text-xs text-slate-500`}>
                        {move.user_email ?? '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === 'warehouses' ? (
        warehouses.loading && !warehouses.data ? (
          <Spinner />
        ) : warehouses.error ? (
          <ErrorBox message={warehouses.error} />
        ) : (
          <>
            {can('products.manage') ? (
              <div className="mb-3">
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => setWarehouseOpen(true)}
                >
                  <Plus className="size-4" /> Add warehouse
                </button>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {(warehouses.data?.warehouses ?? []).map((warehouse) => (
                <div
                  key={warehouse.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-bold text-slate-900">{warehouse.name}</p>
                      <p className="font-mono text-xs text-slate-400">{warehouse.code}</p>
                    </div>
                    {can('products.manage') ? (
                      <button
                        type="button"
                        className="text-xs font-semibold text-emerald-700"
                        onClick={() => setLocationFor(warehouse)}
                      >
                        + Location
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{warehouse.address ?? 'No address'}</p>
                  <div className="mt-3 space-y-1 border-t border-slate-100 pt-2">
                    {(warehouse.locations ?? []).map((location) => (
                      <div key={location.id} className="flex items-center justify-between text-sm">
                        <span className="text-slate-700">{location.name}</span>
                        <span className="font-mono text-xs text-slate-400">
                          {location.code}
                          {location.is_default ? ' · default' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )
      ) : null}

      {adjustOpen ? (
        <AdjustModal
          products={products.data?.products ?? []}
          locations={locations}
          onClose={() => setAdjustOpen(false)}
          onSaved={() => {
            stock.reload();
            moves.reload();
          }}
        />
      ) : null}

      {warehouseOpen ? (
        <WarehouseModal
          onClose={() => setWarehouseOpen(false)}
          onSaved={() => warehouses.reload()}
        />
      ) : null}

      {locationFor ? (
        <LocationModal
          warehouse={locationFor}
          onClose={() => setLocationFor(null)}
          onSaved={() => warehouses.reload()}
        />
      ) : null}
    </>
  );
}

function AdjustModal({
  products,
  locations,
  onClose,
  onSaved,
}: {
  products: Product[];
  locations: { id: number; name: string; code: string; warehouseName: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    productId: products[0]?.id ? String(products[0].id) : '',
    locationId: locations[0]?.id ? String(locations[0].id) : '',
    quantity: '1',
    note: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/inventory/stock/adjust', {
        productId: Number(form.productId),
        locationId: Number(form.locationId),
        quantity: Number(form.quantity),
        note: form.note || null,
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
    <Modal title="Adjust stock" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error ? <ErrorBox message={error} /> : null}
        <Field label="Product">
          <select
            className={inputCls}
            value={form.productId}
            onChange={(e) => setForm({ ...form, productId: e.target.value })}
            required
          >
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.sku} — {product.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Location">
          <select
            className={inputCls}
            value={form.locationId}
            onChange={(e) => setForm({ ...form, locationId: e.target.value })}
            required
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.warehouseName} / {location.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity" hint="Positive adds stock, negative removes it (e.g. -2).">
          <input
            className={inputCls}
            type="number"
            step="0.01"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            required
          />
        </Field>
        <Field label="Reason">
          <input
            className={inputCls}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="Stock count, damage, opening balance…"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy}>
            {busy ? 'Saving…' : 'Apply adjustment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function WarehouseModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ code: '', name: '', address: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Add warehouse" onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.post('/inventory/warehouses', form);
            onSaved();
            onClose();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-3"
      >
        {error ? <ErrorBox message={error} /> : null}
        <Field label="Code">
          <input
            className={inputCls}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            required
          />
        </Field>
        <Field label="Name">
          <input
            className={inputCls}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </Field>
        <Field label="Address">
          <input
            className={inputCls}
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy}>
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LocationModal({
  warehouse,
  onClose,
  onSaved,
}: {
  warehouse: Warehouse;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ code: '', name: '', isDefault: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Add location — ${warehouse.name}`} onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.post(`/inventory/warehouses/${warehouse.id}/locations`, form);
            onSaved();
            onClose();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-3"
      >
        {error ? <ErrorBox message={error} /> : null}
        <Field label="Code">
          <input
            className={inputCls}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            required
          />
        </Field>
        <Field label="Name">
          <input
            className={inputCls}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
          />
          Default location
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy}>
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}
