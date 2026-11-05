import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Blocks,
  Boxes,
  Briefcase,
  CalendarDays,
  ClipboardList,
  Clock,
  Factory,
  FileText,
  FolderKanban,
  Globe,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Newspaper,
  Package,
  Receipt,
  ScanLine,
  Settings,
  ShoppingCart,
  Store,
  UserCog,
  Users,
  Warehouse,
  Wrench,
  X,
} from 'lucide-react';
import { useAuth } from '../auth';
import { useFetch } from '../lib/useFetch';
import { useModules } from '../modules';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: string;
  module?: string;
  end?: boolean;
}

const NAV: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Overview',
    items: [
      {
        to: '/',
        label: 'Dashboard',
        icon: LayoutDashboard,
        permission: 'dashboard.view',
        module: 'dashboard',
        end: true,
      },
      {
        to: '/my-leave',
        label: 'My Leave',
        icon: CalendarDays,
        permission: 'leave.self',
        module: 'time-off',
      },
    ],
  },
  {
    heading: 'Trading',
    items: [
      {
        to: '/partners',
        label: 'Customers & Suppliers',
        icon: Users,
        permission: 'partners.view',
        module: 'partners',
      },
      {
        to: '/products',
        label: 'Products',
        icon: Package,
        permission: 'products.view',
        module: 'products',
      },
      {
        to: '/inventory',
        label: 'Inventory',
        icon: Warehouse,
        permission: 'products.view',
        module: 'inventory',
      },
      {
        to: '/purchases',
        label: 'Purchase Orders',
        icon: ClipboardList,
        permission: 'purchases.view',
        module: 'purchases',
      },
      {
        to: '/sales',
        label: 'Sales Orders',
        icon: ShoppingCart,
        permission: 'sales.view',
        module: 'sales',
      },
      {
        to: '/invoices',
        label: 'Invoices & Payments',
        icon: Receipt,
        permission: 'invoices.view',
        module: 'invoicing',
      },
      {
        to: '/barcode',
        label: 'Barcode',
        icon: ScanLine,
        permission: 'products.view',
        module: 'barcode',
      },
      {
        to: '/pos',
        label: 'Point of Sale',
        icon: Store,
        permission: 'pos.view',
        module: 'pos',
      },
      {
        to: '/maintenance',
        label: 'Maintenance',
        icon: Wrench,
        permission: 'maintenance.view',
        module: 'maintenance',
      },
    ],
  },
  {
    heading: 'Back office',
    items: [
      {
        to: '/accounting',
        label: 'Accounting',
        icon: Landmark,
        permission: 'accounting.view',
        module: 'accounting',
      },
      {
        to: '/employees',
        label: 'Employees',
        icon: Boxes,
        permission: 'hr.view',
        module: 'hr',
      },
      {
        to: '/time-off',
        label: 'Time Off',
        icon: CalendarDays,
        permission: 'hr.view',
        module: 'time-off',
      },
      {
        to: '/timesheets',
        label: 'Timesheets',
        icon: Clock,
        permission: 'hr.view',
        module: 'timesheets',
      },
      {
        to: '/projects',
        label: 'Projects',
        icon: FolderKanban,
        permission: 'projects.view',
        module: 'projects',
      },
      {
        to: '/manufacturing',
        label: 'Manufacturing',
        icon: Factory,
        permission: 'manufacturing.view',
        module: 'manufacturing',
      },
      {
        to: '/recruitment',
        label: 'Recruitment',
        icon: Briefcase,
        permission: 'recruitment.view',
        module: 'recruitment',
      },
      {
        to: '/blogs',
        label: 'Blogs',
        icon: Newspaper,
        permission: 'blogs.view',
        module: 'blogs',
      },
      {
        to: '/website',
        label: 'Website',
        icon: Globe,
        permission: 'website.view',
        module: 'website',
      },
      { to: '/plugins', label: 'Plugins', icon: Blocks, permission: 'modules.manage' },
      { to: '/users', label: 'Users & Roles', icon: UserCog, permission: 'users.manage' },
      { to: '/settings', label: 'Settings', icon: Settings, permission: 'settings.manage' },
    ],
  },
];

export default function Layout() {
  const { user, logout, can } = useAuth();
  const { isEnabled } = useModules();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const settings = useFetch<{ settings: Record<string, string> }>('/settings');
  const companyName = settings.data?.settings.company_name ?? 'vula-erp';

  const bottomItems: NavItem[] = (
    can('dashboard.view')
      ? [
          {
            to: '/',
            label: 'Home',
            icon: LayoutDashboard,
            permission: 'dashboard.view',
            module: 'dashboard',
            end: true,
          },
          {
            to: '/sales',
            label: 'Sales',
            icon: ShoppingCart,
            permission: 'sales.view',
            module: 'sales',
          },
          {
            to: '/pos',
            label: 'POS',
            icon: Store,
            permission: 'pos.view',
            module: 'pos',
          },
          {
            to: '/products',
            label: 'Products',
            icon: Package,
            permission: 'products.view',
            module: 'products',
          },
        ]
      : [
          {
            to: '/my-leave',
            label: 'My Leave',
            icon: CalendarDays,
            permission: 'leave.self',
            module: 'time-off',
          },
        ]
  ).filter(
    (item) =>
      (!item.permission || can(item.permission)) && (!item.module || isEnabled(item.module)),
  );

  const nav = (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {NAV.map((group) => {
        const items = group.items.filter(
          (item) =>
            (!item.permission || can(item.permission)) && (!item.module || isEnabled(item.module)),
        );
        if (items.length === 0) return null;
        return (
          <div key={group.heading}>
            <p className="mb-1 px-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
              {group.heading}
            </p>
            <div className="space-y-0.5">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`
                    }
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex h-full bg-slate-100">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex items-center gap-2.5 border-b border-slate-200 px-5 py-4">
          <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-600 text-lg font-black text-white">
            V
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900">{companyName}</p>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              vula-erp
            </p>
          </div>
        </div>
        {nav}
        <div className="border-t border-slate-200 p-3">
          <div className="mb-2 px-2">
            <p className="truncate text-sm font-semibold text-slate-800">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="truncate text-xs text-slate-500">{user?.roles.join(', ')}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      </aside>

      {open ? (
        <div className="fixed inset-0 z-30 flex lg:hidden">
          <div className="absolute inset-0 bg-slate-950/60" onClick={() => setOpen(false)} />
          <aside className="relative flex w-72 flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-bold text-slate-900">{companyName}</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-slate-500"
              >
                <X className="size-5" />
              </button>
            </div>
            {nav}
            <div className="border-t border-slate-200 p-3">
              <button
                type="button"
                onClick={logout}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                <LogOut className="size-4" /> Sign out
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="safe-top sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg p-2 text-slate-600"
          >
            <Menu className="size-5" />
          </button>
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-emerald-600" />
            <span className="text-sm font-bold text-slate-900">{companyName}</span>
          </div>
          <div className="size-8 rounded-full bg-emerald-600 text-center text-sm font-bold leading-8 text-white">
            {user?.firstName?.[0] ?? '?'}
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-4 pb-24 sm:p-6 lg:pb-6">
          <div key={location.pathname} className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden">
        <div className="flex">
          {bottomItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex flex-1 flex-col items-center gap-1 px-1 py-2 text-[11px] font-semibold ${
                    isActive ? 'text-emerald-700' : 'text-slate-500'
                  }`
                }
              >
                <Icon className="size-5" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex flex-1 flex-col items-center gap-1 px-1 py-2 text-[11px] font-semibold text-slate-500"
          >
            <Menu className="size-5" />
            <span>Menu</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
