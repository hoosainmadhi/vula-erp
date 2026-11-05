import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Shield, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../lib/useFetch';
import { dateTime, shortDate, titleCase } from '../lib/format';
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
  PasswordInput,
  Spinner,
  tdCls,
  thCls,
} from '../components/ui';
import type { AuditEntry, Permission, Role, Warehouse } from '../types';

type Tab = 'users' | 'roles' | 'audit';

interface ManagedUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  is_active: number;
  warehouse_id: number | null;
  last_login_at: string | null;
  created_at: string;
  roles: string[];
}

interface RolesResponse {
  roles: Role[];
  permissions: Permission[];
}

function UserForm({
  user,
  roles,
  warehouses,
  onSaved,
  onClose,
}: {
  user: ManagedUser | null;
  roles: Role[];
  warehouses: Warehouse[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState(user?.email ?? '');
  const [firstName, setFirstName] = useState(user?.first_name ?? '');
  const [lastName, setLastName] = useState(user?.last_name ?? '');
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(user ? user.is_active === 1 : true);
  const [warehouseId, setWarehouseId] = useState(String(user?.warehouse_id ?? ''));
  const [selected, setSelected] = useState<string[]>(user?.roles ?? ['viewer']);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleRole = (name: string) => {
    setSelected((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (user) {
        await api.put(`/users/${user.id}`, {
          firstName,
          lastName,
          isActive,
          roles: selected,
          warehouseId: warehouseId ? Number(warehouseId) : null,
          ...(password ? { password } : {}),
        });
      } else {
        await api.post('/users', {
          email,
          firstName,
          lastName,
          password,
          roles: selected,
          warehouseId: warehouseId ? Number(warehouseId) : null,
        });
      }
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
      {!user ? (
        <Field label="Email">
          <input
            className={inputCls}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
      ) : (
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{user.email}</div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First name">
          <input
            className={inputCls}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </Field>
        <Field label="Last name">
          <input
            className={inputCls}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </Field>
      </div>
      <Field
        label={user ? 'New password (optional)' : 'Password'}
        hint={user ? 'Leave blank to keep the current password.' : 'At least 8 characters.'}
      >
        <PasswordInput
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required={!user}
          minLength={8}
          autoComplete="new-password"
        />
      </Field>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Roles</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {roles.map((role) => (
            <label
              key={role.id}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
            >
              <input
                type="checkbox"
                checked={selected.includes(role.name)}
                onChange={() => toggleRole(role.name)}
              />
              <span className="font-medium">{titleCase(role.name)}</span>
            </label>
          ))}
        </div>
      </div>
      <Field label="Branch scope" hint="Restricts this user to one branch; admins always see all.">
        <select
          className={inputCls}
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
        >
          <option value="">All branches</option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}
            </option>
          ))}
        </select>
      </Field>
      {user ? (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />{' '}
          Account active
        </label>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : user ? 'Save changes' : 'Create user'}
        </button>
      </div>
    </form>
  );
}

function RoleForm({
  role,
  permissions,
  onSaved,
  onClose,
}: {
  role: Role | null;
  permissions: Permission[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState<string[]>(role?.permissions ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const modules = [...new Set(permissions.map((permission) => permission.module))];
  const toggle = (key: string) =>
    setSelected((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...(role ? {} : { name }),
        description: description || null,
        permissions: selected,
      };
      if (role) await api.put(`/roles/${role.id}`, body);
      else await api.post('/roles', body);
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
      {!role ? (
        <Field label="Role name">
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
      ) : (
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
          {titleCase(role.name)}
        </div>
      )}
      <Field label="Description">
        <input
          className={inputCls}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <div className="max-h-80 space-y-3 overflow-y-auto rounded-lg border border-slate-200 p-3">
        {modules.map((module) => (
          <div key={module}>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
              {titleCase(module)}
            </p>
            <div className="grid gap-1 sm:grid-cols-2">
              {permissions
                .filter((permission) => permission.module === module)
                .map((permission) => (
                  <label
                    key={permission.id}
                    className="flex items-start gap-2 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selected.includes(permission.key)}
                      onChange={() => toggle(permission.key)}
                    />
                    <span>
                      <span className="font-mono text-xs">{permission.key}</span>
                      <span className="block text-xs text-slate-400">{permission.description}</span>
                    </span>
                  </label>
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : 'Save role'}
        </button>
      </div>
    </form>
  );
}

export default function UsersPage() {
  const { can, user: currentUser } = useAuth();
  const [tab, setTab] = useState<Tab>('users');
  const [userModal, setUserModal] = useState<ManagedUser | 'new' | null>(null);
  const [roleModal, setRoleModal] = useState<Role | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const users = useFetch<{ users: ManagedUser[] }>('/users');
  const roles = useFetch<RolesResponse>('/roles');
  const warehouses = useFetch<{ warehouses: Warehouse[] }>('/inventory/warehouses');
  const audit = useFetch<{ audit: AuditEntry[] }>(tab === 'audit' ? '/audit?limit=200' : null);

  const removeUser = async (user: ManagedUser) => {
    if (!window.confirm(`Delete ${user.email}?`)) return;
    setError(null);
    try {
      await api.del(`/users/${user.id}`);
      users.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const removeRole = async (role: Role) => {
    if (!window.confirm(`Delete role ${role.name}?`)) return;
    setError(null);
    try {
      await api.del(`/roles/${role.id}`);
      roles.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Users & roles"
        subtitle="Access control, permissions and audit trail"
        actions={
          can('users.manage') ? (
            tab === 'users' ? (
              <button type="button" className={btnPrimary} onClick={() => setUserModal('new')}>
                <Plus className="size-4" /> New user
              </button>
            ) : tab === 'roles' ? (
              <button type="button" className={btnPrimary} onClick={() => setRoleModal('new')}>
                <Plus className="size-4" /> New role
              </button>
            ) : null
          ) : null
        }
      />

      <div className="mb-3 flex rounded-lg border border-slate-200 bg-white p-1">
        {(
          [
            ['users', 'Users'],
            ['roles', 'Roles & permissions'],
            ['audit', 'Audit trail'],
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

      {error ? <ErrorBox message={error} /> : null}

      {tab === 'users' ? (
        users.loading && !users.data ? (
          <Spinner />
        ) : users.error ? (
          <ErrorBox message={users.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>User</th>
                  <th className={thCls}>Roles</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Last login</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {!users.data || users.data.users.length === 0 ? (
                  <EmptyState colSpan={5} message="No users found." />
                ) : (
                  users.data.users.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-50">
                      <td className={tdCls}>
                        <p className="font-semibold text-slate-800">
                          {user.first_name} {user.last_name}
                        </p>
                        <p className="text-xs text-slate-400">{user.email}</p>
                      </td>
                      <td className={tdCls}>
                        <div className="flex flex-wrap gap-1">
                          {user.roles.map((role) => (
                            <span
                              key={role}
                              className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600"
                            >
                              {titleCase(role)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className={tdCls}>
                        <Badge value={user.is_active === 1 ? 'active' : 'terminated'} />
                      </td>
                      <td className={`${tdCls} text-xs text-slate-500`}>
                        {user.last_login_at ? dateTime(user.last_login_at) : 'Never'}
                        <p className="text-slate-400">Joined {shortDate(user.created_at)}</p>
                      </td>
                      <td className={tdCls}>
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className={btnGhost}
                            onClick={() => setUserModal(user)}
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          {can('users.manage') && user.id !== currentUser?.id ? (
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => removeUser(user)}
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

      {tab === 'roles' ? (
        roles.loading && !roles.data ? (
          <Spinner />
        ) : roles.error ? (
          <ErrorBox message={roles.error} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(roles.data?.roles ?? []).map((role) => (
              <div
                key={role.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-1.5 font-bold text-slate-900">
                      <Shield className="size-4 text-emerald-600" />
                      {titleCase(role.name)}
                      {role.is_system === 1 ? (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                          System
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {role.description ?? 'No description'}
                    </p>
                  </div>
                  {can('users.manage') && role.name !== 'admin' ? (
                    <div className="flex gap-1">
                      <button type="button" className={btnGhost} onClick={() => setRoleModal(role)}>
                        <Pencil className="size-3.5" />
                      </button>
                      {role.is_system === 0 ? (
                        <button type="button" className={btnGhost} onClick={() => removeRole(role)}>
                          <Trash2 className="size-3.5 text-red-500" />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {role.permissions.length} permission(s)
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {role.permissions.slice(0, 12).map((permission) => (
                    <span
                      key={permission}
                      className="rounded bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-500"
                    >
                      {permission}
                    </span>
                  ))}
                  {role.permissions.length > 12 ? (
                    <span className="text-[10px] text-slate-400">
                      +{role.permissions.length - 12} more
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )
      ) : null}

      {tab === 'audit' ? (
        audit.loading && !audit.data ? (
          <Spinner />
        ) : audit.error ? (
          <ErrorBox message={audit.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>When</th>
                  <th className={thCls}>User</th>
                  <th className={thCls}>Action</th>
                  <th className={thCls}>Entity</th>
                  <th className={thCls}>Details</th>
                </tr>
              </thead>
              <tbody>
                {!audit.data || audit.data.audit.length === 0 ? (
                  <EmptyState colSpan={5} message="No audit entries yet." />
                ) : (
                  audit.data.audit.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} whitespace-nowrap text-xs text-slate-500`}>
                        {dateTime(entry.created_at)}
                      </td>
                      <td className={`${tdCls} text-xs text-slate-600`}>
                        {entry.user_name ?? entry.user_email ?? 'System'}
                      </td>
                      <td className={tdCls}>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">
                          {titleCase(entry.action)}
                        </span>
                      </td>
                      <td className={`${tdCls} font-mono text-xs`}>
                        {entry.entity}
                        {entry.entity_id ? ` #${entry.entity_id}` : ''}
                      </td>
                      <td className={`${tdCls} max-w-md truncate text-xs text-slate-500`}>
                        {entry.details ?? '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {userModal ? (
        <Modal
          title={userModal === 'new' ? 'New user' : 'Edit user'}
          onClose={() => setUserModal(null)}
          wide
        >
          <UserForm
            user={userModal === 'new' ? null : userModal}
            roles={roles.data?.roles ?? []}
            warehouses={warehouses.data?.warehouses ?? []}
            onSaved={users.reload}
            onClose={() => setUserModal(null)}
          />
        </Modal>
      ) : null}

      {roleModal ? (
        <Modal
          title={roleModal === 'new' ? 'New role' : `Edit ${titleCase(roleModal.name)}`}
          onClose={() => setRoleModal(null)}
          wide
        >
          <RoleForm
            role={roleModal === 'new' ? null : roleModal}
            permissions={roles.data?.permissions ?? []}
            onSaved={roles.reload}
            onClose={() => setRoleModal(null)}
          />
        </Modal>
      ) : null}
    </>
  );
}
