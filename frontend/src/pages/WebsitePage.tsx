import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../lib/useFetch';
import { shortDate, today } from '../lib/format';
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
import type { WebsiteMenuItem, WebsitePage } from '../types';

type Tab = 'pages' | 'menu';

function PageForm({
  page,
  onSaved,
  onClose,
}: {
  page: WebsitePage | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(page?.title ?? '');
  const [slug, setSlug] = useState(page?.slug ?? '');
  const [content, setContent] = useState(page?.content ?? '');
  const [status, setStatus] = useState<string>(page?.status ?? 'draft');
  const [publishedAt, setPublishedAt] = useState(page?.published_at ?? today());
  const [showHeader, setShowHeader] = useState(page ? page.show_header === 1 : true);
  const [showFooter, setShowFooter] = useState(page ? page.show_footer === 1 : true);
  const [metaTitle, setMetaTitle] = useState(page?.meta_title ?? '');
  const [metaDescription, setMetaDescription] = useState(page?.meta_description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        title,
        slug: slug || null,
        content,
        status,
        publishedAt: status === 'published' ? publishedAt || null : null,
        showHeader,
        showFooter,
        metaTitle: metaTitle || null,
        metaDescription: metaDescription || null,
      };
      if (page) await api.put(`/website/pages/${page.id}`, body);
      else await api.post('/website/pages', body);
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
        <Field label="Title">
          <input
            className={inputCls}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </Field>
        <Field label="Slug">
          <input
            className={inputCls}
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder="auto-generated from the title"
          />
        </Field>
        <Field label="Status">
          <select
            className={inputCls}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </Field>
        <Field label="Published date">
          <input
            className={inputCls}
            type="date"
            value={publishedAt}
            onChange={(event) => setPublishedAt(event.target.value)}
            disabled={status !== 'published'}
          />
        </Field>
      </div>
      <Field label="Content">
        <textarea
          className={`${inputCls} font-mono text-xs`}
          rows={14}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Write the page. Line breaks are preserved on the public page."
        />
      </Field>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={showHeader}
            onChange={(event) => setShowHeader(event.target.checked)}
            className="size-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          Show site header
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={showFooter}
            onChange={(event) => setShowFooter(event.target.checked)}
            className="size-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          Show site footer
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Meta title">
          <input
            className={inputCls}
            value={metaTitle}
            onChange={(event) => setMetaTitle(event.target.value)}
          />
        </Field>
        <Field label="Meta description">
          <input
            className={inputCls}
            value={metaDescription}
            onChange={(event) => setMetaDescription(event.target.value)}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : page ? 'Save changes' : 'Create page'}
        </button>
      </div>
    </form>
  );
}

function MenuForm({
  item,
  items,
  onSaved,
  onClose,
}: {
  item: WebsiteMenuItem | null;
  items: WebsiteMenuItem[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(item?.label ?? '');
  const [path, setPath] = useState(item?.path ?? '/site');
  const [sort, setSort] = useState(String(item?.sort ?? 0));
  const [parentId, setParentId] = useState(String(item?.parent_id ?? ''));
  const [isActive, setIsActive] = useState(item ? item.is_active === 1 : true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        label,
        path,
        sort: Number(sort) || 0,
        parentId: parentId ? Number(parentId) : null,
        isActive,
      };
      if (item) await api.put(`/website/menu/${item.id}`, body);
      else await api.post('/website/menu', body);
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
        <Field label="Label">
          <input
            className={inputCls}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            required
          />
        </Field>
        <Field label="Path">
          <input
            className={inputCls}
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/site/about"
            required
          />
        </Field>
        <Field label="Sort order">
          <input
            className={inputCls}
            type="number"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          />
        </Field>
        <Field label="Parent">
          <select
            className={inputCls}
            value={parentId}
            onChange={(event) => setParentId(event.target.value)}
          >
            <option value="">Top level</option>
            {items
              .filter((candidate) => candidate.id !== item?.id)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
          className="size-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
        />
        Visible in the site menu
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : item ? 'Save changes' : 'Add menu item'}
        </button>
      </div>
    </form>
  );
}

export default function WebsitePage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('pages');
  const [pageModal, setPageModal] = useState<WebsitePage | 'new' | null>(null);
  const [menuModal, setMenuModal] = useState<WebsiteMenuItem | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pages = useFetch<{ pages: WebsitePage[] }>('/website/pages');
  const menu = useFetch<{ items: WebsiteMenuItem[] }>('/website/menu');

  const removePage = async (page: WebsitePage) => {
    if (!window.confirm(`Delete page “${page.title}”?`)) return;
    setError(null);
    try {
      await api.del(`/website/pages/${page.id}`);
      pages.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const removeMenuItem = async (item: WebsiteMenuItem) => {
    if (!window.confirm(`Delete menu item “${item.label}”?`)) return;
    setError(null);
    try {
      await api.del(`/website/menu/${item.id}`);
      menu.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const pageRows = pages.data?.pages ?? [];
  const menuRows = menu.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Website"
        subtitle="Public pages and site navigation"
        actions={
          can('website.manage') ? (
            tab === 'pages' ? (
              <button type="button" className={btnPrimary} onClick={() => setPageModal('new')}>
                <Plus className="size-4" /> New page
              </button>
            ) : (
              <button type="button" className={btnPrimary} onClick={() => setMenuModal('new')}>
                <Plus className="size-4" /> New menu item
              </button>
            )
          ) : null
        }
      />

      <div className="mb-3 flex items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {(
            [
              ['pages', 'Pages'],
              ['menu', 'Menu'],
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
        <a
          href="/site"
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-emerald-700 hover:underline"
        >
          Open public site ↗
        </a>
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {tab === 'pages' ? (
        pages.loading && !pages.data ? (
          <Spinner />
        ) : pages.error ? (
          <ErrorBox message={pages.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[750px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Page</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Published</th>
                  <th className={thCls}>Header</th>
                  <th className={thCls}>Footer</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <EmptyState colSpan={6} message="No website pages yet." />
                ) : (
                  pageRows.map((page) => (
                    <tr key={page.id} className="hover:bg-slate-50">
                      <td className={tdCls}>
                        <p className="font-semibold text-slate-800">{page.title}</p>
                        <p className="font-mono text-xs text-slate-400">/site/{page.slug}</p>
                      </td>
                      <td className={tdCls}>
                        <Badge value={page.status} />
                      </td>
                      <td className={tdCls}>{shortDate(page.published_at)}</td>
                      <td className={tdCls}>{page.show_header ? 'Yes' : 'No'}</td>
                      <td className={tdCls}>{page.show_footer ? 'Yes' : 'No'}</td>
                      <td className={tdCls}>
                        {can('website.manage') ? (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => setPageModal(page)}
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => void removePage(page)}
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

      {tab === 'menu' ? (
        menu.loading && !menu.data ? (
          <Spinner />
        ) : menu.error ? (
          <ErrorBox message={menu.error} />
        ) : (
          <Card className="p-0">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Label</th>
                  <th className={thCls}>Path</th>
                  <th className={`${thCls} text-right`}>Sort</th>
                  <th className={thCls}>Parent</th>
                  <th className={thCls}>Visible</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {menuRows.length === 0 ? (
                  <EmptyState colSpan={6} message="No menu items yet." />
                ) : (
                  menuRows.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-semibold text-slate-800`}>{item.label}</td>
                      <td className={`${tdCls} font-mono text-xs`}>{item.path}</td>
                      <td className={`${tdCls} text-right`}>{item.sort}</td>
                      <td className={tdCls}>
                        {menuRows.find((candidate) => candidate.id === item.parent_id)?.label ??
                          '—'}
                      </td>
                      <td className={tdCls}>
                        <Badge value={item.is_active ? 'active' : 'inactive'} />
                      </td>
                      <td className={tdCls}>
                        {can('website.manage') ? (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => setMenuModal(item)}
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => void removeMenuItem(item)}
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
        )
      ) : null}

      {pageModal ? (
        <Modal
          title={pageModal === 'new' ? 'New website page' : `Edit “${pageModal.title}”`}
          onClose={() => setPageModal(null)}
          wide
        >
          <PageForm
            page={pageModal === 'new' ? null : pageModal}
            onSaved={() => pages.reload()}
            onClose={() => setPageModal(null)}
          />
        </Modal>
      ) : null}

      {menuModal ? (
        <Modal
          title={menuModal === 'new' ? 'New menu item' : 'Edit menu item'}
          onClose={() => setMenuModal(null)}
        >
          <MenuForm
            item={menuModal === 'new' ? null : menuModal}
            items={menuRows}
            onSaved={() => menu.reload()}
            onClose={() => setMenuModal(null)}
          />
        </Modal>
      ) : null}
    </>
  );
}
