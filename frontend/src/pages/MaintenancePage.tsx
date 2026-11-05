import { useState, type FormEvent } from 'react';
import { Cog, Pencil, Plus, Search, Trash2, Wrench } from 'lucide-react';
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
  MaintenanceCategory,
  MaintenanceEquipment,
  MaintenanceRequest,
  Technician,
} from '../types';

type Tab = 'requests' | 'equipment' | 'categories';

const STATUSES = ['pending', 'scheduled', 'in_progress', 'done', 'cancelled'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const TYPES = ['preventive', 'corrective'] as const;

function EquipmentForm({
  equipment,
  categories,
  onSaved,
  onClose,
}: {
  equipment: MaintenanceEquipment | null;
  categories: MaintenanceCategory[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(equipment?.name ?? '');
  const [categoryId, setCategoryId] = useState(String(equipment?.category_id ?? ''));
  const [location, setLocation] = useState(equipment?.location ?? '');
  const [model, setModel] = useState(equipment?.model ?? '');
  const [serialNo, setSerialNo] = useState(equipment?.serial_no ?? '');
  const [effectiveDate, setEffectiveDate] = useState(equipment?.effective_date ?? '');
  const [warrantyDate, setWarrantyDate] = useState(equipment?.warranty_date ?? '');
  const [cost, setCost] = useState(((equipment?.cost_cents ?? 0) / 100).toFixed(2));
  const [note, setNote] = useState(equipment?.note ?? '');
  const [isActive, setIsActive] = useState(equipment ? equipment.is_active === 1 : true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        name,
        categoryId: categoryId ? Number(categoryId) : null,
        location: location || null,
        model: model || null,
        serialNo: serialNo || null,
        effectiveDate: effectiveDate || null,
        warrantyDate: warrantyDate || null,
        costCents: Math.round((Number(cost) || 0) * 100),
        note: note || null,
        isActive,
      };
      if (equipment) await api.put(`/maintenance/equipment/${equipment.id}`, body);
      else await api.post('/maintenance/equipment', body);
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
        <Field label="Category">
          <select
            className={inputCls}
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">Uncategorised</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Model">
          <input className={inputCls} value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <Field label="Serial number">
          <input
            className={inputCls}
            value={serialNo}
            onChange={(e) => setSerialNo(e.target.value)}
          />
        </Field>
        <Field label="Location">
          <input
            className={inputCls}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </Field>
        <Field label="Purchase cost (R)">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </Field>
        <Field label="Effective date">
          <input
            className={inputCls}
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
          />
        </Field>
        <Field label="Warranty until">
          <input
            className={inputCls}
            type="date"
            value={warrantyDate}
            onChange={(e) => setWarrantyDate(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Note">
        <textarea
          className={inputCls}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
          className="size-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
        />
        In service
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : equipment ? 'Save changes' : 'Add equipment'}
        </button>
      </div>
    </form>
  );
}

function RequestForm({
  request,
  equipment,
  technicians,
  onSaved,
  onClose,
}: {
  request: MaintenanceRequest | null;
  equipment: MaintenanceEquipment[];
  technicians: Technician[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState(request?.subject ?? '');
  const [equipmentId, setEquipmentId] = useState(
    String(request?.equipment_id ?? equipment[0]?.id ?? ''),
  );
  const [maintenanceType, setMaintenanceType] = useState(request?.maintenance_type ?? 'corrective');
  const [priority, setPriority] = useState(request?.priority ?? 'medium');
  const [assignedTo, setAssignedTo] = useState(String(request?.assigned_to ?? ''));
  const [requestedAt, setRequestedAt] = useState(request?.requested_at ?? today());
  const [scheduledAt, setScheduledAt] = useState(request?.scheduled_at ?? '');
  const [durationHours, setDurationHours] = useState(String(request?.duration_hours ?? 0));
  const [cost, setCost] = useState(((request?.cost_cents ?? 0) / 100).toFixed(2));
  const [description, setDescription] = useState(request?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        subject,
        equipmentId: Number(equipmentId),
        maintenanceType,
        priority,
        assignedTo: assignedTo ? Number(assignedTo) : null,
        requestedAt,
        scheduledAt: scheduledAt || null,
        durationHours: Number(durationHours) || 0,
        costCents: Math.round((Number(cost) || 0) * 100),
        description: description || null,
      };
      if (request) await api.put(`/maintenance/requests/${request.id}`, body);
      else await api.post('/maintenance/requests', body);
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
      <Field label="Subject">
        <input
          className={inputCls}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          required
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Equipment">
          <select
            className={inputCls}
            value={equipmentId}
            onChange={(event) => setEquipmentId(event.target.value)}
            required
          >
            <option value="">Select equipment…</option>
            {equipment.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.serial_no ? ` · ${item.serial_no}` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type">
          <select
            className={inputCls}
            value={maintenanceType}
            onChange={(event) =>
              setMaintenanceType(event.target.value as 'preventive' | 'corrective')
            }
          >
            {TYPES.map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priority">
          <select
            className={inputCls}
            value={priority}
            onChange={(event) => setPriority(event.target.value as MaintenanceRequest['priority'])}
          >
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Technician">
          <select
            className={inputCls}
            value={assignedTo}
            onChange={(event) => setAssignedTo(event.target.value)}
          >
            <option value="">Unassigned</option>
            {technicians.map((technician) => (
              <option key={technician.id} value={technician.id}>
                {technician.first_name} {technician.last_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Requested on">
          <input
            className={inputCls}
            type="date"
            value={requestedAt}
            onChange={(event) => setRequestedAt(event.target.value)}
          />
        </Field>
        <Field label="Scheduled for">
          <input
            className={inputCls}
            type="date"
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
          />
        </Field>
        <Field label="Duration (hours)">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.5"
            value={durationHours}
            onChange={(event) => setDurationHours(event.target.value)}
          />
        </Field>
        <Field label="Cost (R)">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.01"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
          />
        </Field>
      </div>
      <Field label="Description">
        <textarea
          className={inputCls}
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : request ? 'Save changes' : 'Raise request'}
        </button>
      </div>
    </form>
  );
}

function CompleteForm({
  request,
  onSaved,
  onClose,
}: {
  request: MaintenanceRequest;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [durationHours, setDurationHours] = useState(String(request.duration_hours || 1));
  const [cost, setCost] = useState(((request.cost_cents ?? 0) / 100).toFixed(2));
  const [resolution, setResolution] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/maintenance/requests/${request.id}/status`, {
        status: 'done',
        resolution,
        durationHours: Number(durationHours) || 0,
        costCents: Math.round((Number(cost) || 0) * 100),
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
        <Field label="Duration (hours)">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.5"
            value={durationHours}
            onChange={(event) => setDurationHours(event.target.value)}
          />
        </Field>
        <Field label="Cost (R)">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.01"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
          />
        </Field>
      </div>
      <Field label="Resolution">
        <textarea
          className={inputCls}
          rows={3}
          value={resolution}
          onChange={(event) => setResolution(event.target.value)}
          placeholder="What was done?"
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : 'Mark complete'}
        </button>
      </div>
    </form>
  );
}

export default function MaintenancePage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('requests');
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [requestModal, setRequestModal] = useState<MaintenanceRequest | 'new' | null>(null);
  const [equipmentModal, setEquipmentModal] = useState<MaintenanceEquipment | 'new' | null>(null);
  const [completing, setCompleting] = useState<MaintenanceRequest | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [editingCategory, setEditingCategory] = useState<MaintenanceCategory | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestParams = new URLSearchParams();
  if (status !== 'all') requestParams.set('status', status);

  const requests = useFetch<{ requests: MaintenanceRequest[] }>(
    `/maintenance/requests?${requestParams}`,
    [status],
  );
  const equipment = useFetch<{ equipment: MaintenanceEquipment[] }>('/maintenance/equipment');
  const categories = useFetch<{ categories: MaintenanceCategory[] }>('/maintenance/categories');
  const technicians = useFetch<{ technicians: Technician[] }>('/maintenance/technicians');
  const summary = useFetch<{
    byStatus: { status: string; count: number }[];
    open: { count: number; cost_cents: number };
    equipmentCount: { count: number };
  }>('/maintenance/requests/summary');

  const reloadAll = () => {
    requests.reload();
    summary.reload();
    equipment.reload();
  };

  const setRequestStatus = async (
    request: MaintenanceRequest,
    next: 'scheduled' | 'in_progress' | 'cancelled',
  ) => {
    if (next === 'cancelled' && !window.confirm(`Cancel request ${request.number}?`)) return;
    setError(null);
    try {
      await api.post(`/maintenance/requests/${request.id}/status`, { status: next });
      reloadAll();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const removeRequest = async (request: MaintenanceRequest) => {
    if (!window.confirm(`Delete request ${request.number}?`)) return;
    setError(null);
    try {
      await api.del(`/maintenance/requests/${request.id}`);
      reloadAll();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const removeEquipment = async (item: MaintenanceEquipment) => {
    if (!window.confirm(`Delete “${item.name}” and all its maintenance requests?`)) return;
    setError(null);
    try {
      await api.del(`/maintenance/equipment/${item.id}`);
      equipment.reload();
      requests.reload();
      summary.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const saveCategory = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      if (editingCategory) {
        await api.put(`/maintenance/categories/${editingCategory.id}`, { name: categoryName });
      } else {
        await api.post('/maintenance/categories', { name: categoryName });
      }
      setCategoryName('');
      setEditingCategory(null);
      categories.reload();
      equipment.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const removeCategory = async (category: MaintenanceCategory) => {
    if (!window.confirm(`Delete category “${category.name}”?`)) return;
    setError(null);
    try {
      await api.del(`/maintenance/categories/${category.id}`);
      categories.reload();
      equipment.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const equipmentRows = equipment.data?.equipment ?? [];
  const requestRows = requests.data?.requests ?? [];
  const categoryRows = categories.data?.categories ?? [];
  const openCount = summary.data?.open.count ?? 0;

  return (
    <>
      <PageHeader
        title="Maintenance"
        subtitle="Equipment register, preventive work and repair requests"
        actions={
          can('maintenance.manage') ? (
            tab === 'requests' ? (
              <button type="button" className={btnPrimary} onClick={() => setRequestModal('new')}>
                <Plus className="size-4" /> New request
              </button>
            ) : tab === 'equipment' ? (
              <button type="button" className={btnPrimary} onClick={() => setEquipmentModal('new')}>
                <Plus className="size-4" /> New equipment
              </button>
            ) : null
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {(
            [
              ['requests', 'Requests'],
              ['equipment', 'Equipment'],
              ['categories', 'Categories'],
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

        {tab === 'requests' ? (
          <>
            <select
              className={`${inputCls} w-auto`}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">All requests</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {titleCase(value)}
                </option>
              ))}
            </select>
            <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
              <Wrench className="size-4 text-amber-600" />
              <span className="font-semibold text-slate-900">{openCount}</span> open
            </span>
          </>
        ) : null}

        {tab === 'equipment' ? (
          <div className="relative min-w-56 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
            <input
              className={`${inputCls} pl-9`}
              placeholder="Search equipment…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        ) : null}
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {tab === 'requests' ? (
        requests.loading && !requests.data ? (
          <Spinner />
        ) : requests.error ? (
          <ErrorBox message={requests.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Number</th>
                  <th className={thCls}>Subject</th>
                  <th className={thCls}>Equipment</th>
                  <th className={thCls}>Type</th>
                  <th className={thCls}>Priority</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Technician</th>
                  <th className={thCls}>Requested</th>
                  <th className={`${thCls} text-right`}>Cost</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {requestRows.length === 0 ? (
                  <EmptyState colSpan={10} message="No maintenance requests yet." />
                ) : (
                  requestRows.map((request) => (
                    <tr key={request.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-mono text-xs`}>{request.number}</td>
                      <td className={tdCls}>
                        <p className="font-semibold text-slate-800">{request.subject}</p>
                        <p className="max-w-56 truncate text-xs text-slate-400">
                          {request.description ?? '—'}
                        </p>
                      </td>
                      <td className={tdCls}>
                        {request.equipment_name}
                        {request.serial_no ? (
                          <p className="font-mono text-xs text-slate-400">{request.serial_no}</p>
                        ) : null}
                      </td>
                      <td className={tdCls}>{titleCase(request.maintenance_type)}</td>
                      <td className={tdCls}>
                        <Badge value={request.priority} />
                      </td>
                      <td className={tdCls}>
                        <Badge value={request.status} />
                      </td>
                      <td className={tdCls}>{request.assignee_name ?? '—'}</td>
                      <td className={tdCls}>
                        {shortDate(request.requested_at)}
                        {request.scheduled_at ? (
                          <p className="text-xs text-slate-400">
                            for {shortDate(request.scheduled_at)}
                          </p>
                        ) : null}
                      </td>
                      <td className={`${tdCls} text-right`}>{money(request.cost_cents)}</td>
                      <td className={tdCls}>
                        <div className="flex justify-end gap-1">
                          {can('maintenance.manage') &&
                          request.status !== 'done' &&
                          request.status !== 'cancelled' ? (
                            <>
                              {request.status === 'pending' ? (
                                <button
                                  type="button"
                                  className={btnGhost}
                                  onClick={() => void setRequestStatus(request, 'scheduled')}
                                >
                                  Schedule
                                </button>
                              ) : null}
                              {request.status === 'pending' || request.status === 'scheduled' ? (
                                <button
                                  type="button"
                                  className={btnGhost}
                                  onClick={() => void setRequestStatus(request, 'in_progress')}
                                >
                                  Start
                                </button>
                              ) : null}
                              {request.status === 'in_progress' ? (
                                <button
                                  type="button"
                                  className={btnGhost}
                                  onClick={() => setCompleting(request)}
                                >
                                  Complete
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className={btnGhost}
                                onClick={() => setRequestModal(request)}
                              >
                                <Pencil className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                className={btnGhost}
                                onClick={() => void setRequestStatus(request, 'cancelled')}
                              >
                                <Trash2 className="size-3.5 text-red-500" />
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

      {tab === 'equipment' ? (
        equipment.loading && !equipment.data ? (
          <Spinner />
        ) : equipment.error ? (
          <ErrorBox message={equipment.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[940px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Equipment</th>
                  <th className={thCls}>Category</th>
                  <th className={thCls}>Model / serial</th>
                  <th className={thCls}>Location</th>
                  <th className={thCls}>Warranty</th>
                  <th className={`${thCls} text-right`}>Open</th>
                  <th className={`${thCls} text-right`}>Cost</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {equipmentRows.length === 0 ? (
                  <EmptyState colSpan={8} message="No equipment registered yet." />
                ) : (
                  equipmentRows.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className={tdCls}>
                        <p className="font-semibold text-slate-800">{item.name}</p>
                        {item.is_active === 0 ? (
                          <span className="text-xs text-red-500">Out of service</span>
                        ) : null}
                      </td>
                      <td className={tdCls}>{item.category_name ?? '—'}</td>
                      <td className={tdCls}>
                        {item.model ?? '—'}
                        {item.serial_no ? (
                          <p className="font-mono text-xs text-slate-400">{item.serial_no}</p>
                        ) : null}
                      </td>
                      <td className={tdCls}>{item.location ?? '—'}</td>
                      <td className={tdCls}>{shortDate(item.warranty_date)}</td>
                      <td className={`${tdCls} text-right font-semibold`}>
                        {item.open_request_count}
                      </td>
                      <td className={`${tdCls} text-right`}>{money(item.cost_cents)}</td>
                      <td className={tdCls}>
                        <div className="flex justify-end gap-1">
                          {can('maintenance.manage') ? (
                            <>
                              <button
                                type="button"
                                className={btnGhost}
                                onClick={() => setEquipmentModal(item)}
                              >
                                <Pencil className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                className={btnGhost}
                                onClick={() => void removeEquipment(item)}
                              >
                                <Trash2 className="size-3.5 text-red-500" />
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

      {tab === 'categories' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {can('maintenance.manage') ? (
            <Card className="p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
                <Cog className="size-4 text-slate-400" />
                {editingCategory ? 'Rename category' : 'New category'}
              </h2>
              <form onSubmit={saveCategory} className="space-y-3">
                <Field label="Name">
                  <input
                    className={inputCls}
                    value={categoryName}
                    onChange={(event) => setCategoryName(event.target.value)}
                    required
                  />
                </Field>
                <div className="flex gap-2">
                  <button type="submit" className={btnPrimary}>
                    {editingCategory ? 'Save' : 'Add category'}
                  </button>
                  {editingCategory ? (
                    <button
                      type="button"
                      className={btnSecondary}
                      onClick={() => {
                        setEditingCategory(null);
                        setCategoryName('');
                      }}
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </form>
            </Card>
          ) : null}
          <Card className="p-0 lg:col-span-2">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Category</th>
                  <th className={thCls}>Note</th>
                  <th className={`${thCls} text-right`}>Equipment</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {categoryRows.length === 0 ? (
                  <EmptyState colSpan={4} message="No categories yet." />
                ) : (
                  categoryRows.map((category) => (
                    <tr key={category.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-semibold text-slate-800`}>{category.name}</td>
                      <td className={tdCls}>{category.note ?? '—'}</td>
                      <td className={`${tdCls} text-right`}>{category.equipment_count ?? 0}</td>
                      <td className={tdCls}>
                        {can('maintenance.manage') ? (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => {
                                setEditingCategory(category);
                                setCategoryName(category.name);
                              }}
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => void removeCategory(category)}
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
          </Card>
        </div>
      ) : null}

      {requestModal ? (
        <Modal
          title={requestModal === 'new' ? 'New maintenance request' : 'Edit maintenance request'}
          onClose={() => setRequestModal(null)}
          wide
        >
          <RequestForm
            request={requestModal === 'new' ? null : requestModal}
            equipment={equipmentRows}
            technicians={technicians.data?.technicians ?? []}
            onSaved={reloadAll}
            onClose={() => setRequestModal(null)}
          />
        </Modal>
      ) : null}

      {equipmentModal ? (
        <Modal
          title={equipmentModal === 'new' ? 'New equipment' : 'Edit equipment'}
          onClose={() => setEquipmentModal(null)}
          wide
        >
          <EquipmentForm
            equipment={equipmentModal === 'new' ? null : equipmentModal}
            categories={categoryRows}
            onSaved={() => {
              equipment.reload();
              summary.reload();
            }}
            onClose={() => setEquipmentModal(null)}
          />
        </Modal>
      ) : null}

      {completing ? (
        <Modal title={`Complete ${completing.number}`} onClose={() => setCompleting(null)}>
          <CompleteForm
            request={completing}
            onSaved={reloadAll}
            onClose={() => setCompleting(null)}
          />
        </Modal>
      ) : null}
    </>
  );
}
