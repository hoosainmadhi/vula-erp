import { useState, type FormEvent } from 'react';
import { Check, Factory, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../lib/useFetch';
import { money, shortDate, titleCase, today } from '../lib/format';
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
import type {
  ManufacturingBom,
  ManufacturingBomLine,
  ManufacturingOperation,
  ManufacturingOrder,
  ManufacturingOrderOperation,
  ManufacturingWorkCenter,
} from '../types';

type Tab = 'orders' | 'boms' | 'work-centers' | 'operations';

interface OptionProduct {
  id: number;
  sku: string;
  name: string;
  type: 'goods' | 'service';
  uom: string;
  cost_cents: number;
  track_inventory: number;
}

interface OptionLocation {
  id: number;
  code: string;
  name: string;
  warehouse_name: string;
  is_default: number;
}

interface OptionUser {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

function OrderForm({
  order,
  products,
  locations,
  users,
  boms,
  onSaved,
  onClose,
}: {
  order: ManufacturingOrder | null;
  products: OptionProduct[];
  locations: OptionLocation[];
  users: OptionUser[];
  boms: ManufacturingBom[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const goods = products.filter((product) => product.type === 'goods');
  const [productId, setProductId] = useState(String(order?.product_id ?? goods[0]?.id ?? ''));
  const [bomId, setBomId] = useState(String(order?.bom_id ?? ''));
  const [quantity, setQuantity] = useState(String(order?.quantity ?? 1));
  const [priority, setPriority] = useState(order?.priority ?? 'medium');
  const [scheduledDate, setScheduledDate] = useState(order?.scheduled_date ?? today());
  const [sourceLocationId, setSourceLocationId] = useState(
    String(order?.source_location_id ?? locations[0]?.id ?? ''),
  );
  const [destinationLocationId, setDestinationLocationId] = useState(
    String(order?.destination_location_id ?? locations[0]?.id ?? ''),
  );
  const [assignedTo, setAssignedTo] = useState(String(order?.assigned_to ?? ''));
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const productBoms = boms.filter(
    (bom) => String(bom.product_id) === productId && bom.is_active === 1,
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        productId: Number(productId),
        bomId: bomId ? Number(bomId) : null,
        quantity: Number(quantity) || 1,
        priority,
        scheduledDate: scheduledDate || null,
        sourceLocationId: sourceLocationId ? Number(sourceLocationId) : null,
        destinationLocationId: destinationLocationId ? Number(destinationLocationId) : null,
        assignedTo: assignedTo ? Number(assignedTo) : null,
        notes: notes || null,
      };
      if (order) await api.put(`/manufacturing/orders/${order.id}`, body);
      else await api.post('/manufacturing/orders', body);
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
        <Field label="Finished product">
          <select
            className={inputCls}
            value={productId}
            onChange={(event) => {
              setProductId(event.target.value);
              const match = boms.find(
                (bom) => String(bom.product_id) === event.target.value && bom.is_active === 1,
              );
              setBomId(match ? String(match.id) : '');
            }}
            required
          >
            <option value="">Select a product…</option>
            {goods.map((product) => (
              <option key={product.id} value={product.id}>
                {product.sku} — {product.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bill of materials">
          <select
            className={inputCls}
            value={bomId}
            onChange={(event) => setBomId(event.target.value)}
          >
            <option value="">No BOM (produce without components)</option>
            {productBoms.map((bom) => (
              <option key={bom.id} value={bom.id}>
                {bom.code} — {bom.line_count} components
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity">
          <input
            className={inputCls}
            type="number"
            min={0.0001}
            step="0.01"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            required
          />
        </Field>
        <Field label="Priority">
          <select
            className={inputCls}
            value={priority}
            onChange={(event) => setPriority(event.target.value as ManufacturingOrder['priority'])}
          >
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Scheduled for">
          <input
            className={inputCls}
            type="date"
            value={scheduledDate}
            onChange={(event) => setScheduledDate(event.target.value)}
          />
        </Field>
        <Field label="Assigned to">
          <select
            className={inputCls}
            value={assignedTo}
            onChange={(event) => setAssignedTo(event.target.value)}
          >
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.first_name} {user.last_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Components from">
          <select
            className={inputCls}
            value={sourceLocationId}
            onChange={(event) => setSourceLocationId(event.target.value)}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.warehouse_name} · {location.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Finished goods to">
          <select
            className={inputCls}
            value={destinationLocationId}
            onChange={(event) => setDestinationLocationId(event.target.value)}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.warehouse_name} · {location.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
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
          {busy ? 'Saving…' : order ? 'Save changes' : 'Create order'}
        </button>
      </div>
    </form>
  );
}

function OrderDetail({
  orderId,
  onChanged,
  onClose,
}: {
  orderId: number;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { can } = useAuth();
  const detail = useFetch<{ order: ManufacturingOrder }>(`/manufacturing/orders/${orderId}`, [
    orderId,
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const order = detail.data?.order;

  const run = async (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      if (body === undefined) await api.post(path);
      else await api.post(path, body);
      detail.reload();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const allOperationsDone =
    !order?.operations || order.operations.every((operation) => operation.status === 'done');

  return (
    <div className="space-y-4">
      {error ? <ErrorBox message={error} /> : null}
      {detail.loading && !order ? (
        <Spinner />
      ) : detail.error ? (
        <ErrorBox message={detail.error} />
      ) : order ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Product</p>
              <p className="font-semibold text-slate-800">{order.product_name}</p>
              <p className="font-mono text-xs text-slate-400">{order.product_sku}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Quantity</p>
              <p className="text-lg font-bold text-slate-800">{order.quantity}</p>
              <p className="text-xs text-slate-400">{order.bom_code ?? 'No BOM'}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Status</p>
              <Badge value={order.status} />
              <p className="mt-1 text-xs text-slate-400">
                {order.scheduled_date
                  ? `Scheduled ${shortDate(order.scheduled_date)}`
                  : 'Unscheduled'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {can('manufacturing.manage') && order.status === 'draft' ? (
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() => void run(`/manufacturing/orders/${order.id}/confirm`)}
              >
                <Check className="size-4" /> Confirm
              </button>
            ) : null}
            {can('manufacturing.manage') && order.status === 'confirmed' ? (
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() => void run(`/manufacturing/orders/${order.id}/start`)}
              >
                <Play className="size-4" /> Start production
              </button>
            ) : null}
            {can('manufacturing.manage') && order.status === 'in_progress' && allOperationsDone ? (
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() => void run(`/manufacturing/orders/${order.id}/complete`)}
              >
                <Check className="size-4" /> Complete order
              </button>
            ) : null}
            {can('manufacturing.manage') &&
            (order.status === 'draft' || order.status === 'confirmed') ? (
              <button
                type="button"
                className={btnSecondary}
                disabled={busy}
                onClick={() => void run(`/manufacturing/orders/${order.id}/cancel`)}
              >
                Cancel order
              </button>
            ) : null}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-bold text-slate-800">Components</h3>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className={thCls}>Component</th>
                    <th className={`${thCls} text-right`}>Required</th>
                    <th className={`${thCls} text-right`}>Consumed</th>
                    <th className={`${thCls} text-right`}>Available</th>
                    <th className={`${thCls} text-right`}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(order.components ?? []).length === 0 ? (
                    <EmptyState colSpan={5} message="This order has no components." />
                  ) : (
                    (order.components ?? []).map((component) => (
                      <tr key={component.id}>
                        <td className={tdCls}>
                          <p className="font-semibold text-slate-800">{component.product_name}</p>
                          <p className="font-mono text-xs text-slate-400">
                            {component.product_sku}
                          </p>
                        </td>
                        <td className={`${tdCls} text-right`}>{component.required_quantity}</td>
                        <td className={`${tdCls} text-right`}>{component.consumed_quantity}</td>
                        <td className={`${tdCls} text-right`}>{component.available_quantity}</td>
                        <td className={`${tdCls} text-right`}>
                          {money(component.required_quantity * component.unit_cost_cents)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-bold text-slate-800">Operations</h3>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className={thCls}>Operation</th>
                    <th className={thCls}>Work center</th>
                    <th className={`${thCls} text-right`}>Planned</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls} />
                  </tr>
                </thead>
                <tbody>
                  {(order.operations ?? []).length === 0 ? (
                    <EmptyState colSpan={5} message="This order has no operations." />
                  ) : (
                    (order.operations ?? []).map((operation: ManufacturingOrderOperation) => (
                      <tr key={operation.id}>
                        <td className={`${tdCls} font-semibold text-slate-800`}>
                          {operation.name}
                        </td>
                        <td className={tdCls}>{operation.work_center_name ?? '—'}</td>
                        <td className={`${tdCls} text-right`}>{operation.duration_minutes} min</td>
                        <td className={tdCls}>
                          <Badge value={operation.status} />
                        </td>
                        <td className={tdCls}>
                          {can('manufacturing.manage') && order.status === 'in_progress' ? (
                            <div className="flex justify-end gap-1">
                              {operation.status === 'pending' ? (
                                <button
                                  type="button"
                                  className={btnGhost}
                                  disabled={busy}
                                  onClick={() =>
                                    void run(
                                      `/manufacturing/orders/${order.id}/operations/${operation.id}/start`,
                                    )
                                  }
                                >
                                  Start
                                </button>
                              ) : null}
                              {operation.status !== 'done' ? (
                                <button
                                  type="button"
                                  className={btnGhost}
                                  disabled={busy}
                                  onClick={() =>
                                    void run(
                                      `/manufacturing/orders/${order.id}/operations/${operation.id}/complete`,
                                    )
                                  }
                                >
                                  Complete
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-slate-400">Material cost</p>
              <p className="font-semibold">{money(order.material_cost_cents)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-slate-400">Operation cost</p>
              <p className="font-semibold">{money(order.operation_cost_cents)}</p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-emerald-700">Total cost</p>
              <p className="font-bold text-emerald-800">{money(order.total_cost_cents)}</p>
            </div>
          </div>

          <div className="flex justify-end">
            <button type="button" className={btnSecondary} onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function BomForm({
  bom,
  products,
  operations,
  onSaved,
  onClose,
}: {
  bom: ManufacturingBom | null;
  products: OptionProduct[];
  operations: ManufacturingOperation[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const goods = products.filter((product) => product.type === 'goods');
  const [code, setCode] = useState(bom?.code ?? '');
  const [productId, setProductId] = useState(String(bom?.product_id ?? goods[0]?.id ?? ''));
  const [quantity, setQuantity] = useState(String(bom?.quantity ?? 1));
  const [notes, setNotes] = useState(bom?.notes ?? '');
  const [isActive, setIsActive] = useState(bom ? bom.is_active === 1 : true);
  const [lines, setLines] = useState<{ productId: string; quantity: string }[]>(
    bom?.lines?.map((line: ManufacturingBomLine) => ({
      productId: String(line.product_id),
      quantity: String(line.quantity),
    })) ?? [{ productId: '', quantity: '1' }],
  );
  const [operationIds, setOperationIds] = useState<number[]>(
    bom?.operations?.map((operation) => operation.operation_id) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        code,
        productId: Number(productId),
        quantity: Number(quantity) || 1,
        notes: notes || null,
        isActive,
        lines: lines
          .filter((line) => line.productId)
          .map((line) => ({
            productId: Number(line.productId),
            quantity: Number(line.quantity) || 1,
          })),
        operationIds,
      };
      if (bom) await api.put(`/manufacturing/boms/${bom.id}`, body);
      else await api.post('/manufacturing/boms', body);
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
            onChange={(event) => setCode(event.target.value)}
            required
          />
        </Field>
        <Field label="Finished product">
          <select
            className={inputCls}
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            required
          >
            <option value="">Select a product…</option>
            {goods.map((product) => (
              <option key={product.id} value={product.id}>
                {product.sku} — {product.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Produces quantity">
          <input
            className={inputCls}
            type="number"
            min={0.0001}
            step="0.01"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            className="size-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          Active
        </label>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">Components</h3>
          <button
            type="button"
            className={btnGhost}
            onClick={() => setLines([...lines, { productId: '', quantity: '1' }])}
          >
            <Plus className="size-3.5" /> Add component
          </button>
        </div>
        <div className="space-y-2">
          {lines.map((line, index) => (
            <div key={index} className="flex gap-2">
              <select
                className={inputCls}
                value={line.productId}
                onChange={(event) => {
                  const next = [...lines];
                  next[index] = { ...line, productId: event.target.value };
                  setLines(next);
                }}
              >
                <option value="">Select component…</option>
                {goods
                  .filter((product) => String(product.id) !== productId)
                  .map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.sku} — {product.name}
                    </option>
                  ))}
              </select>
              <input
                className={`${inputCls} w-28`}
                type="number"
                min={0.0001}
                step="0.01"
                value={line.quantity}
                onChange={(event) => {
                  const next = [...lines];
                  next[index] = { ...line, quantity: event.target.value };
                  setLines(next);
                }}
              />
              <button
                type="button"
                className={btnGhost}
                onClick={() => setLines(lines.filter((_, i) => i !== index))}
              >
                <X className="size-4 text-red-500" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-bold text-slate-800">Operations</h3>
        {operations.length === 0 ? (
          <p className="text-sm text-slate-500">Create operations in the Operations tab first.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {operations.map((operation) => (
              <label key={operation.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={operationIds.includes(operation.id)}
                  onChange={(event) =>
                    setOperationIds(
                      event.target.checked
                        ? [...operationIds, operation.id]
                        : operationIds.filter((id) => id !== operation.id),
                    )
                  }
                  className="size-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                {operation.name}
                <span className="text-xs text-slate-400">
                  {operation.work_center_name ?? 'No work center'}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

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
          {busy ? 'Saving…' : bom ? 'Save changes' : 'Create BOM'}
        </button>
      </div>
    </form>
  );
}

function WorkCenterForm({
  workCenter,
  onSaved,
  onClose,
}: {
  workCenter: ManufacturingWorkCenter | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(workCenter?.name ?? '');
  const [code, setCode] = useState(workCenter?.code ?? '');
  const [costPerHour, setCostPerHour] = useState(
    ((workCenter?.cost_per_hour_cents ?? 0) / 100).toFixed(2),
  );
  const [capacity, setCapacity] = useState(String(workCenter?.capacity_per_day ?? 8));
  const [notes, setNotes] = useState(workCenter?.notes ?? '');
  const [isActive, setIsActive] = useState(workCenter ? workCenter.is_active === 1 : true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        name,
        code,
        costPerHourCents: Math.round((Number(costPerHour) || 0) * 100),
        capacityPerDay: Number(capacity) || 0,
        notes: notes || null,
        isActive,
      };
      if (workCenter) await api.put(`/manufacturing/work-centers/${workCenter.id}`, body);
      else await api.post('/manufacturing/work-centers', body);
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
        <Field label="Name">
          <input
            className={inputCls}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Field>
        <Field label="Code">
          <input
            className={inputCls}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
        </Field>
        <Field label="Cost per hour (R)">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.01"
            value={costPerHour}
            onChange={(event) => setCostPerHour(event.target.value)}
          />
        </Field>
        <Field label="Capacity per day (hours)">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.5"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
          />
        </Field>
      </div>
      <Field label="Notes">
        <textarea
          className={inputCls}
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
          className="size-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
        />
        Active
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : workCenter ? 'Save changes' : 'Add work center'}
        </button>
      </div>
    </form>
  );
}

function OperationForm({
  operation,
  workCenters,
  onSaved,
  onClose,
}: {
  operation: ManufacturingOperation | null;
  workCenters: ManufacturingWorkCenter[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(operation?.name ?? '');
  const [workCenterId, setWorkCenterId] = useState(String(operation?.work_center_id ?? ''));
  const [duration, setDuration] = useState(String(operation?.duration_minutes ?? 30));
  const [notes, setNotes] = useState(operation?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        name,
        workCenterId: workCenterId ? Number(workCenterId) : null,
        durationMinutes: Number(duration) || 0,
        notes: notes || null,
      };
      if (operation) await api.put(`/manufacturing/operations/${operation.id}`, body);
      else await api.post('/manufacturing/operations', body);
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
      <Field label="Name">
        <input
          className={inputCls}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Work center">
          <select
            className={inputCls}
            value={workCenterId}
            onChange={(event) => setWorkCenterId(event.target.value)}
          >
            <option value="">Unassigned</option>
            {workCenters.map((workCenter) => (
              <option key={workCenter.id} value={workCenter.id}>
                {workCenter.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Duration (minutes)">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="1"
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          />
        </Field>
      </div>
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
          {busy ? 'Saving…' : operation ? 'Save changes' : 'Add operation'}
        </button>
      </div>
    </form>
  );
}

export default function ManufacturingPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('orders');
  const [status, setStatus] = useState('all');
  const [orderModal, setOrderModal] = useState<ManufacturingOrder | 'new' | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [bomModal, setBomModal] = useState<ManufacturingBom | 'new' | null>(null);
  const [workCenterModal, setWorkCenterModal] = useState<ManufacturingWorkCenter | 'new' | null>(
    null,
  );
  const [operationModal, setOperationModal] = useState<ManufacturingOperation | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);

  const orders = useFetch<{ orders: ManufacturingOrder[] }>(`/manufacturing/orders?${params}`, [
    status,
  ]);
  const boms = useFetch<{ boms: ManufacturingBom[] }>('/manufacturing/boms');
  const workCenters = useFetch<{ workCenters: ManufacturingWorkCenter[] }>(
    '/manufacturing/work-centers',
  );
  const operations = useFetch<{ operations: ManufacturingOperation[] }>(
    '/manufacturing/operations',
  );
  const options = useFetch<{
    products: OptionProduct[];
    locations: OptionLocation[];
    users: OptionUser[];
  }>('/manufacturing/options');
  const summary = useFetch<{
    byStatus: { status: string; count: number }[];
    open: { count: number; cost_cents: number };
    completed: { count: number; cost_cents: number };
    bomCount: { count: number };
  }>('/manufacturing/summary');

  const reloadAll = () => {
    orders.reload();
    summary.reload();
  };

  const openBom = async (bom: ManufacturingBom) => {
    setError(null);
    try {
      const result = await api.get<{ bom: ManufacturingBom }>(`/manufacturing/boms/${bom.id}`);
      setBomModal(result.bom);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const deleteBom = async (bom: ManufacturingBom) => {
    if (!window.confirm(`Delete BOM ${bom.code}?`)) return;
    setError(null);
    try {
      await api.del(`/manufacturing/boms/${bom.id}`);
      boms.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const deleteWorkCenter = async (workCenter: ManufacturingWorkCenter) => {
    if (!window.confirm(`Delete work center ${workCenter.name}?`)) return;
    setError(null);
    try {
      await api.del(`/manufacturing/work-centers/${workCenter.id}`);
      workCenters.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const deleteOperation = async (operation: ManufacturingOperation) => {
    if (!window.confirm(`Delete operation ${operation.name}?`)) return;
    setError(null);
    try {
      await api.del(`/manufacturing/operations/${operation.id}`);
      operations.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const runOrderAction = async (
    order: ManufacturingOrder,
    action: 'confirm' | 'start' | 'cancel' | 'delete',
  ) => {
    if (action === 'cancel' && !window.confirm(`Cancel ${order.number}?`)) return;
    if (action === 'delete' && !window.confirm(`Delete ${order.number}?`)) return;
    setError(null);
    try {
      if (action === 'delete') await api.del(`/manufacturing/orders/${order.id}`);
      else await api.post(`/manufacturing/orders/${order.id}/${action}`);
      reloadAll();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const orderRows = orders.data?.orders ?? [];
  const bomRows = boms.data?.boms ?? [];
  const workCenterRows = workCenters.data?.workCenters ?? [];
  const operationRows = operations.data?.operations ?? [];
  const products = options.data?.products ?? [];
  const locations = options.data?.locations ?? [];
  const users = options.data?.users ?? [];
  const openCount = summary.data?.open.count ?? 0;
  const completedCount = summary.data?.completed.count ?? 0;

  return (
    <>
      <PageHeader
        title="Manufacturing"
        subtitle="Bills of materials, work centers and production orders"
        actions={
          can('manufacturing.manage') ? (
            tab === 'orders' ? (
              <button type="button" className={btnPrimary} onClick={() => setOrderModal('new')}>
                <Plus className="size-4" /> New order
              </button>
            ) : tab === 'boms' ? (
              <button type="button" className={btnPrimary} onClick={() => setBomModal('new')}>
                <Plus className="size-4" /> New BOM
              </button>
            ) : tab === 'work-centers' ? (
              <button
                type="button"
                className={btnPrimary}
                onClick={() => setWorkCenterModal('new')}
              >
                <Plus className="size-4" /> New work center
              </button>
            ) : (
              <button type="button" className={btnPrimary} onClick={() => setOperationModal('new')}>
                <Plus className="size-4" /> New operation
              </button>
            )
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {(
            [
              ['orders', 'Orders'],
              ['boms', 'BOMs'],
              ['work-centers', 'Work Centers'],
              ['operations', 'Operations'],
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

        {tab === 'orders' ? (
          <>
            <select
              className={`${inputCls} w-auto`}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">All statuses</option>
              {['draft', 'confirmed', 'in_progress', 'done', 'cancelled'].map((value) => (
                <option key={value} value={value}>
                  {titleCase(value)}
                </option>
              ))}
            </select>
            <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
              <Factory className="size-4 text-amber-600" />
              <span className="font-semibold text-slate-900">{openCount}</span> open
              <span className="text-slate-400">·</span>
              <span className="font-semibold text-slate-900">{completedCount}</span> done
            </span>
          </>
        ) : null}
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {tab === 'orders' ? (
        orders.loading && !orders.data ? (
          <Spinner />
        ) : orders.error ? (
          <ErrorBox message={orders.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Number</th>
                  <th className={thCls}>Product</th>
                  <th className={`${thCls} text-right`}>Quantity</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Priority</th>
                  <th className={thCls}>Scheduled</th>
                  <th className={thCls}>Assignee</th>
                  <th className={`${thCls} text-right`}>Cost</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {orderRows.length === 0 ? (
                  <EmptyState colSpan={9} message="No manufacturing orders yet." />
                ) : (
                  orderRows.map((order) => (
                    <tr key={order.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-mono text-xs`}>{order.number}</td>
                      <td className={tdCls}>
                        <p className="font-semibold text-slate-800">{order.product_name}</p>
                        <p className="font-mono text-xs text-slate-400">{order.product_sku}</p>
                      </td>
                      <td className={`${tdCls} text-right`}>{order.quantity}</td>
                      <td className={tdCls}>
                        <Badge value={order.status} />
                      </td>
                      <td className={tdCls}>
                        <Badge value={order.priority} />
                      </td>
                      <td className={tdCls}>{shortDate(order.scheduled_date)}</td>
                      <td className={tdCls}>{order.assignee_name ?? '—'}</td>
                      <td className={`${tdCls} text-right`}>{money(order.total_cost_cents)}</td>
                      <td className={tdCls}>
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className={btnGhost}
                            onClick={() => setDetailId(order.id)}
                          >
                            Open
                          </button>
                          {can('manufacturing.manage') && order.status === 'draft' ? (
                            <>
                              <button
                                type="button"
                                className={btnGhost}
                                onClick={() => void runOrderAction(order, 'confirm')}
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                className={btnGhost}
                                onClick={() => setOrderModal(order)}
                              >
                                <Pencil className="size-3.5" />
                              </button>
                            </>
                          ) : null}
                          {can('manufacturing.manage') && order.status === 'confirmed' ? (
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => void runOrderAction(order, 'start')}
                            >
                              Start
                            </button>
                          ) : null}
                          {can('manufacturing.manage') &&
                          (order.status === 'draft' || order.status === 'confirmed') ? (
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => void runOrderAction(order, 'cancel')}
                            >
                              Cancel
                            </button>
                          ) : null}
                          {can('manufacturing.manage') &&
                          (order.status === 'draft' || order.status === 'cancelled') ? (
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => void runOrderAction(order, 'delete')}
                            >
                              <Trash2 className="size-3.5 text-red-500" />
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
        )
      ) : null}

      {tab === 'boms' ? (
        boms.loading && !boms.data ? (
          <Spinner />
        ) : boms.error ? (
          <ErrorBox message={boms.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Code</th>
                  <th className={thCls}>Finished product</th>
                  <th className={`${thCls} text-right`}>Produces</th>
                  <th className={`${thCls} text-right`}>Components</th>
                  <th className={`${thCls} text-right`}>Operations</th>
                  <th className={thCls}>Active</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {bomRows.length === 0 ? (
                  <EmptyState colSpan={7} message="No bills of materials yet." />
                ) : (
                  bomRows.map((bom) => (
                    <tr key={bom.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-mono text-xs`}>{bom.code}</td>
                      <td className={tdCls}>
                        <p className="font-semibold text-slate-800">{bom.product_name}</p>
                        <p className="font-mono text-xs text-slate-400">{bom.product_sku}</p>
                      </td>
                      <td className={`${tdCls} text-right`}>{bom.quantity}</td>
                      <td className={`${tdCls} text-right`}>{bom.line_count}</td>
                      <td className={`${tdCls} text-right`}>{bom.operation_count}</td>
                      <td className={tdCls}>
                        <Badge value={bom.is_active ? 'active' : 'inactive'} />
                      </td>
                      <td className={tdCls}>
                        {can('manufacturing.manage') ? (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => void openBom(bom)}
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => void deleteBom(bom)}
                            >
                              <Trash2 className="size-3.5 text-red-500" />
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === 'work-centers' ? (
        workCenters.loading && !workCenters.data ? (
          <Spinner />
        ) : workCenters.error ? (
          <ErrorBox message={workCenters.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[750px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Work center</th>
                  <th className={thCls}>Code</th>
                  <th className={`${thCls} text-right`}>Cost / hour</th>
                  <th className={`${thCls} text-right`}>Capacity / day</th>
                  <th className={`${thCls} text-right`}>Operations</th>
                  <th className={thCls}>Active</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {workCenterRows.length === 0 ? (
                  <EmptyState colSpan={7} message="No work centers yet." />
                ) : (
                  workCenterRows.map((workCenter) => (
                    <tr key={workCenter.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-semibold text-slate-800`}>{workCenter.name}</td>
                      <td className={`${tdCls} font-mono text-xs`}>{workCenter.code}</td>
                      <td className={`${tdCls} text-right`}>
                        {money(workCenter.cost_per_hour_cents)}
                      </td>
                      <td className={`${tdCls} text-right`}>{workCenter.capacity_per_day} h</td>
                      <td className={`${tdCls} text-right`}>{workCenter.operation_count ?? 0}</td>
                      <td className={tdCls}>
                        <Badge value={workCenter.is_active ? 'active' : 'inactive'} />
                      </td>
                      <td className={tdCls}>
                        {can('manufacturing.manage') ? (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => setWorkCenterModal(workCenter)}
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => void deleteWorkCenter(workCenter)}
                            >
                              <Trash2 className="size-3.5 text-red-500" />
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === 'operations' ? (
        operations.loading && !operations.data ? (
          <Spinner />
        ) : operations.error ? (
          <ErrorBox message={operations.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[750px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Operation</th>
                  <th className={thCls}>Work center</th>
                  <th className={`${thCls} text-right`}>Duration</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {operationRows.length === 0 ? (
                  <EmptyState colSpan={4} message="No operations yet." />
                ) : (
                  operationRows.map((operation) => (
                    <tr key={operation.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-semibold text-slate-800`}>{operation.name}</td>
                      <td className={tdCls}>{operation.work_center_name ?? '—'}</td>
                      <td className={`${tdCls} text-right`}>{operation.duration_minutes} min</td>
                      <td className={tdCls}>
                        {can('manufacturing.manage') ? (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => setOperationModal(operation)}
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => void deleteOperation(operation)}
                            >
                              <Trash2 className="size-3.5 text-red-500" />
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === 'orders' ? (
        <Card className="mt-4 flex items-center gap-3 p-4 text-sm text-slate-600">
          <Factory className="size-4 text-emerald-600" />
          <span>
            Confirm an order, start production, complete each operation, then complete the order to
            consume components and receive finished goods into stock.
          </span>
        </Card>
      ) : null}

      {orderModal ? (
        <Modal
          title={orderModal === 'new' ? 'New manufacturing order' : `Edit ${orderModal.number}`}
          onClose={() => setOrderModal(null)}
          wide
        >
          <OrderForm
            order={orderModal === 'new' ? null : orderModal}
            products={products}
            locations={locations}
            users={users}
            boms={bomRows}
            onSaved={reloadAll}
            onClose={() => setOrderModal(null)}
          />
        </Modal>
      ) : null}

      {detailId ? (
        <Modal title="Manufacturing order" onClose={() => setDetailId(null)} wide>
          <OrderDetail orderId={detailId} onChanged={reloadAll} onClose={() => setDetailId(null)} />
        </Modal>
      ) : null}

      {bomModal ? (
        <Modal
          title={bomModal === 'new' ? 'New bill of materials' : `Edit ${bomModal.code}`}
          onClose={() => setBomModal(null)}
          wide
        >
          <BomForm
            bom={bomModal === 'new' ? null : bomModal}
            products={products}
            operations={operationRows}
            onSaved={() => {
              boms.reload();
              options.reload();
            }}
            onClose={() => setBomModal(null)}
          />
        </Modal>
      ) : null}

      {workCenterModal ? (
        <Modal
          title={workCenterModal === 'new' ? 'New work center' : 'Edit work center'}
          onClose={() => setWorkCenterModal(null)}
        >
          <WorkCenterForm
            workCenter={workCenterModal === 'new' ? null : workCenterModal}
            onSaved={() => {
              workCenters.reload();
              operations.reload();
            }}
            onClose={() => setWorkCenterModal(null)}
          />
        </Modal>
      ) : null}

      {operationModal ? (
        <Modal
          title={operationModal === 'new' ? 'New operation' : 'Edit operation'}
          onClose={() => setOperationModal(null)}
        >
          <OperationForm
            operation={operationModal === 'new' ? null : operationModal}
            workCenters={workCenterRows}
            onSaved={() => {
              operations.reload();
              boms.reload();
            }}
            onClose={() => setOperationModal(null)}
          />
        </Modal>
      ) : null}
    </>
  );
}
