import { Link, Outlet, useLocation } from 'react-router-dom';
import { useFetch } from '../lib/useFetch';
import type { PublicSite } from '../types';

export default function PublicLayout() {
  const location = useLocation();
  const site = useFetch<PublicSite>('/public/website/site');
  const companyName = site.data?.site.companyName ?? 'vula-erp';
  const tagline = site.data?.site.tagline ?? 'News and updates from our team';
  const menu = site.data?.menu ?? [
    { id: -1, label: 'Home', path: '/site', sort: 0, is_active: 1, parent_id: null },
    { id: -2, label: 'Blog', path: '/blog', sort: 1, is_active: 1, parent_id: null },
  ];

  return (
    <div className="flex min-h-full flex-col bg-white text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <Link to="/site" className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-600 text-lg font-black text-white">
              V
            </span>
            <span>
              <span className="block text-sm font-bold text-slate-900">{companyName}</span>
              <span className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                {tagline}
              </span>
            </span>
          </Link>
          <nav className="flex flex-wrap items-center gap-1">
            {menu.map((item) => (
              <Link
                key={item.id}
                to={item.path}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  location.pathname === item.path
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-5 py-5 text-xs text-slate-500">
          <span>
            © {new Date().getFullYear()} {companyName}
          </span>
          <span>
            {site.data?.site.email ? (
              <a href={`mailto:${site.data.site.email}`}>{site.data.site.email}</a>
            ) : null}
            {site.data?.site.phone ? ` · ${site.data.site.phone}` : ''}
          </span>
        </div>
      </footer>
    </div>
  );
}
