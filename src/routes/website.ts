import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { ValidationError, notFound } from '../utils/errors.js';
import {
  optionalDate,
  optionalInt,
  optionalString,
  paramId,
  requireEnum,
  requireInt,
  requireString,
} from '../utils/validate.js';
import { recordAudit } from '../services/audit.js';

export const websiteRouter = Router();
websiteRouter.use(authenticate);

export const publicWebsiteRouter = Router();

const STATUSES = ['draft', 'published'] as const;

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'page'
  );
}

function uniqueSlug(base: string, excludeId = 0): string {
  const db = getDb();
  const root = slugify(base);
  let slug = root;
  let counter = 1;
  while (
    db.prepare('SELECT id FROM website_pages WHERE slug = ? AND id <> ?').get(slug, excludeId)
  ) {
    counter += 1;
    slug = `${root}-${counter}`;
  }
  return slug;
}

function pageRow(id: number) {
  const page = getDb().prepare('SELECT * FROM website_pages WHERE id = ?').get(id);
  if (!page) throw notFound('Website page not found');
  return page;
}

// Pages
websiteRouter.get(
  '/pages',
  requirePermission('website.view'),
  asyncHandler(async (_req, res) => {
    const pages = getDb().prepare('SELECT * FROM website_pages ORDER BY title').all();
    res.json({ pages });
  }),
);

websiteRouter.get(
  '/pages/:id',
  requirePermission('website.view'),
  asyncHandler(async (req, res) => {
    res.json({ page: pageRow(paramId(req.params.id)) });
  }),
);

websiteRouter.post(
  '/pages',
  requirePermission('website.manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const title = requireString(req.body?.title, 'Title', 300);
    const status =
      req.body?.status === undefined ? 'draft' : requireEnum(req.body.status, 'Status', STATUSES);
    const publishedAt =
      optionalDate(req.body?.publishedAt, 'Published date') ??
      (status === 'published' ? new Date().toISOString().slice(0, 10) : null);
    const slug = uniqueSlug(
      typeof req.body?.slug === 'string' && req.body.slug.trim() ? req.body.slug : title,
    );
    const result = db
      .prepare(
        `INSERT INTO website_pages
           (title, slug, content, status, show_header, show_footer, published_at,
            meta_title, meta_description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        title,
        slug,
        optionalString(req.body?.content, 'Content', 100_000) ?? '',
        status,
        req.body?.showHeader === false ? 0 : 1,
        req.body?.showFooter === false ? 0 : 1,
        publishedAt,
        optionalString(req.body?.metaTitle, 'Meta title', 200),
        optionalString(req.body?.metaDescription, 'Meta description', 500),
      );
    const id = Number(result.lastInsertRowid);
    recordAudit(req.user!.id, 'create', 'website_page', id);
    res.status(201).json({ page: pageRow(id) });
  }),
);

websiteRouter.put(
  '/pages/:id',
  requirePermission('website.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM website_pages WHERE id = ?').get(id) as
      | (Record<string, unknown> & {
          title: string;
          slug: string;
          status: string;
          published_at: string | null;
          show_header: number;
          show_footer: number;
        })
      | undefined;
    if (!existing) throw notFound('Website page not found');

    const title =
      req.body?.title === undefined ? existing.title : requireString(req.body.title, 'Title', 300);
    const status =
      req.body?.status === undefined
        ? existing.status
        : requireEnum(req.body.status, 'Status', STATUSES);
    const publishedAt =
      req.body?.publishedAt === undefined
        ? status === 'published' && !existing.published_at
          ? new Date().toISOString().slice(0, 10)
          : existing.published_at
        : optionalDate(req.body.publishedAt, 'Published date');
    const slug = req.body?.slug === undefined ? existing.slug : uniqueSlug(req.body.slug, id);

    db.prepare(
      `UPDATE website_pages SET title = ?, slug = ?, content = ?, status = ?, show_header = ?,
         show_footer = ?, published_at = ?, meta_title = ?, meta_description = ?,
         updated_at = datetime('now') WHERE id = ?`,
    ).run(
      title,
      slug,
      req.body?.content === undefined
        ? existing.content
        : (optionalString(req.body.content, 'Content', 100_000) ?? ''),
      status,
      req.body?.showHeader === undefined ? existing.show_header : req.body.showHeader ? 1 : 0,
      req.body?.showFooter === undefined ? existing.show_footer : req.body.showFooter ? 1 : 0,
      publishedAt,
      req.body?.metaTitle === undefined
        ? existing.meta_title
        : optionalString(req.body.metaTitle, 'Meta title', 200),
      req.body?.metaDescription === undefined
        ? existing.meta_description
        : optionalString(req.body.metaDescription, 'Meta description', 500),
      id,
    );
    recordAudit(req.user!.id, 'update', 'website_page', id);
    res.json({ page: pageRow(id) });
  }),
);

websiteRouter.delete(
  '/pages/:id',
  requirePermission('website.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb().prepare('DELETE FROM website_pages WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('Website page not found');
    recordAudit(req.user!.id, 'delete', 'website_page', id);
    res.json({ ok: true });
  }),
);

// Menu
websiteRouter.get(
  '/menu',
  requirePermission('website.view'),
  asyncHandler(async (_req, res) => {
    const items = getDb().prepare('SELECT * FROM website_menu_items ORDER BY sort, id').all();
    res.json({ items });
  }),
);

websiteRouter.post(
  '/menu',
  requirePermission('website.manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const parentId = optionalInt(req.body?.parentId, 'Parent', 1);
    if (parentId && !db.prepare('SELECT id FROM website_menu_items WHERE id = ?').get(parentId)) {
      throw notFound('Parent menu item not found');
    }
    const result = db
      .prepare(
        'INSERT INTO website_menu_items (label, path, sort, is_active, parent_id) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        requireString(req.body?.label, 'Label', 100),
        requireString(req.body?.path, 'Path', 300),
        optionalInt(req.body?.sort, 'Sort', 0) ?? 0,
        req.body?.isActive === false ? 0 : 1,
        parentId,
      );
    const id = Number(result.lastInsertRowid);
    recordAudit(req.user!.id, 'create', 'website_menu_item', id);
    res.status(201).json({
      item: db.prepare('SELECT * FROM website_menu_items WHERE id = ?').get(id),
    });
  }),
);

websiteRouter.put(
  '/menu/:id',
  requirePermission('website.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM website_menu_items WHERE id = ?').get(id) as
      | (Record<string, unknown> & {
          label: string;
          path: string;
          sort: number;
          is_active: number;
          parent_id: number | null;
        })
      | undefined;
    if (!existing) throw notFound('Menu item not found');
    const parentId =
      req.body?.parentId === undefined
        ? existing.parent_id
        : optionalInt(req.body.parentId, 'Parent', 1);
    if (parentId && !db.prepare('SELECT id FROM website_menu_items WHERE id = ?').get(parentId)) {
      throw notFound('Parent menu item not found');
    }
    db.prepare(
      'UPDATE website_menu_items SET label = ?, path = ?, sort = ?, is_active = ?, parent_id = ? WHERE id = ?',
    ).run(
      req.body?.label === undefined ? existing.label : requireString(req.body.label, 'Label', 100),
      req.body?.path === undefined ? existing.path : requireString(req.body.path, 'Path', 300),
      req.body?.sort === undefined ? existing.sort : (optionalInt(req.body.sort, 'Sort', 0) ?? 0),
      req.body?.isActive === undefined ? existing.is_active : req.body.isActive ? 1 : 0,
      parentId,
      id,
    );
    recordAudit(req.user!.id, 'update', 'website_menu_item', id);
    res.json({
      item: db.prepare('SELECT * FROM website_menu_items WHERE id = ?').get(id),
    });
  }),
);

websiteRouter.delete(
  '/menu/:id',
  requirePermission('website.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb().prepare('DELETE FROM website_menu_items WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('Menu item not found');
    recordAudit(req.user!.id, 'delete', 'website_menu_item', id);
    res.json({ ok: true });
  }),
);

// Public site
publicWebsiteRouter.get(
  '/site',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const settings = db
      .prepare(
        `SELECT key, value FROM settings
         WHERE key IN ('company_name', 'company_email', 'company_phone', 'company_address',
                       'website_tagline')`,
      )
      .all() as { key: string; value: string }[];
    const map = Object.fromEntries(settings.map((row) => [row.key, row.value]));
    const menu = db
      .prepare(
        'SELECT id, label, path, sort, parent_id FROM website_menu_items WHERE is_active = 1 ORDER BY sort, id',
      )
      .all();
    const pages = db
      .prepare(
        `SELECT id, title, slug, published_at FROM website_pages
         WHERE status = 'published' ORDER BY title`,
      )
      .all();
    res.json({
      site: {
        companyName: map.company_name ?? 'vula-erp',
        tagline: map.website_tagline ?? 'News and updates from our team',
        email: map.company_email ?? '',
        phone: map.company_phone ?? '',
        address: map.company_address ?? '',
      },
      menu,
      pages,
    });
  }),
);

publicWebsiteRouter.get(
  '/pages/:slug',
  asyncHandler(async (req, res) => {
    const page = getDb()
      .prepare(
        `SELECT id, title, slug, content, show_header, show_footer, published_at,
                meta_title, meta_description
         FROM website_pages WHERE slug = ? AND status = 'published'`,
      )
      .get(req.params.slug);
    if (!page) throw notFound('Website page not found');
    res.json({ page });
  }),
);

publicWebsiteRouter.get(
  '/menu',
  asyncHandler(async (_req, res) => {
    const items = getDb()
      .prepare(
        'SELECT id, label, path, sort, parent_id FROM website_menu_items WHERE is_active = 1 ORDER BY sort, id',
      )
      .all();
    res.json({ items });
  }),
);
