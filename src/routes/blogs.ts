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
  requireString,
} from '../utils/validate.js';
import { recordAudit } from '../services/audit.js';

export const blogsRouter = Router();
blogsRouter.use(authenticate);

export const publicBlogsRouter = Router();

const STATUSES = ['draft', 'published'] as const;

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'post'
  );
}

function uniqueSlug(
  table: 'blog_posts' | 'blog_categories' | 'blog_tags' | 'website_pages',
  base: string,
  excludeId = 0,
): string {
  const db = getDb();
  const root = slugify(base);
  let slug = root;
  let counter = 1;
  while (db.prepare(`SELECT id FROM ${table} WHERE slug = ? AND id <> ?`).get(slug, excludeId)) {
    counter += 1;
    slug = `${root}-${counter}`;
  }
  return slug;
}

function tagIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => requireIntValue(item)).filter((id) => id > 0);
}

function requireIntValue(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Invalid tag');
  return id;
}

function replaceTags(postId: number, ids: number[]): void {
  const db = getDb();
  db.prepare('DELETE FROM blog_post_tags WHERE post_id = ?').run(postId);
  const insert = db.prepare('INSERT OR IGNORE INTO blog_post_tags (post_id, tag_id) VALUES (?, ?)');
  for (const tagId of ids) {
    if (!db.prepare('SELECT id FROM blog_tags WHERE id = ?').get(tagId)) {
      throw new ValidationError('Tag not found');
    }
    insert.run(postId, tagId);
  }
}

function postDetail(id: number) {
  const db = getDb();
  const post = db
    .prepare(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug,
              u.first_name || ' ' || u.last_name AS author_name
       FROM blog_posts p
       LEFT JOIN blog_categories c ON c.id = p.category_id
       LEFT JOIN users u ON u.id = p.author_id
       WHERE p.id = ?`,
    )
    .get(id);
  if (!post) throw notFound('Blog post not found');
  const tags = db
    .prepare(
      `SELECT t.* FROM blog_tags t
       JOIN blog_post_tags pt ON pt.tag_id = t.id
       WHERE pt.post_id = ? ORDER BY t.name`,
    )
    .all(id);
  return { ...(post as Record<string, unknown>), tags };
}

// Categories
blogsRouter.get(
  '/categories',
  requirePermission('blogs.view'),
  asyncHandler(async (_req, res) => {
    const categories = getDb()
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM blog_posts p WHERE p.category_id = c.id) AS post_count
         FROM blog_categories c ORDER BY c.name`,
      )
      .all();
    res.json({ categories });
  }),
);

blogsRouter.post(
  '/categories',
  requirePermission('blogs.manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const name = requireString(req.body?.name, 'Name', 200);
    const slug = uniqueSlug(
      'blog_categories',
      typeof req.body?.slug === 'string' && req.body.slug.trim() ? req.body.slug : name,
    );
    const result = db
      .prepare(
        `INSERT INTO blog_categories (name, slug, description, meta_title, meta_description)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        slug,
        optionalString(req.body?.description, 'Description', 5000),
        optionalString(req.body?.metaTitle, 'Meta title', 200),
        optionalString(req.body?.metaDescription, 'Meta description', 500),
      );
    const id = Number(result.lastInsertRowid);
    recordAudit(req.user!.id, 'create', 'blog_category', id);
    res
      .status(201)
      .json({ category: db.prepare('SELECT * FROM blog_categories WHERE id = ?').get(id) });
  }),
);

blogsRouter.put(
  '/categories/:id',
  requirePermission('blogs.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM blog_categories WHERE id = ?').get(id) as
      (Record<string, unknown> & { name: string; slug: string }) | undefined;
    if (!existing) throw notFound('Category not found');
    const name =
      req.body?.name === undefined ? existing.name : requireString(req.body.name, 'Name', 200);
    const slug =
      req.body?.slug === undefined
        ? existing.slug
        : uniqueSlug('blog_categories', req.body.slug, id);
    db.prepare(
      `UPDATE blog_categories SET name = ?, slug = ?, description = ?, meta_title = ?,
         meta_description = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(
      name,
      slug,
      req.body?.description === undefined
        ? existing.description
        : optionalString(req.body.description, 'Description', 5000),
      req.body?.metaTitle === undefined
        ? existing.meta_title
        : optionalString(req.body.metaTitle, 'Meta title', 200),
      req.body?.metaDescription === undefined
        ? existing.meta_description
        : optionalString(req.body.metaDescription, 'Meta description', 500),
      id,
    );
    recordAudit(req.user!.id, 'update', 'blog_category', id);
    res.json({ category: db.prepare('SELECT * FROM blog_categories WHERE id = ?').get(id) });
  }),
);

blogsRouter.delete(
  '/categories/:id',
  requirePermission('blogs.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb().prepare('DELETE FROM blog_categories WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('Category not found');
    recordAudit(req.user!.id, 'delete', 'blog_category', id);
    res.json({ ok: true });
  }),
);

// Tags
blogsRouter.get(
  '/tags',
  requirePermission('blogs.view'),
  asyncHandler(async (_req, res) => {
    const tags = getDb()
      .prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM blog_post_tags pt WHERE pt.tag_id = t.id) AS post_count
         FROM blog_tags t ORDER BY t.name`,
      )
      .all();
    res.json({ tags });
  }),
);

blogsRouter.post(
  '/tags',
  requirePermission('blogs.manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const name = requireString(req.body?.name, 'Name', 100);
    const slug = uniqueSlug(
      'blog_tags',
      typeof req.body?.slug === 'string' && req.body.slug.trim() ? req.body.slug : name,
    );
    const result = db.prepare('INSERT INTO blog_tags (name, slug) VALUES (?, ?)').run(name, slug);
    const id = Number(result.lastInsertRowid);
    recordAudit(req.user!.id, 'create', 'blog_tag', id);
    res.status(201).json({ tag: db.prepare('SELECT * FROM blog_tags WHERE id = ?').get(id) });
  }),
);

blogsRouter.put(
  '/tags/:id',
  requirePermission('blogs.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM blog_tags WHERE id = ?').get(id) as
      (Record<string, unknown> & { name: string; slug: string }) | undefined;
    if (!existing) throw notFound('Tag not found');
    const name =
      req.body?.name === undefined ? existing.name : requireString(req.body.name, 'Name', 100);
    const slug =
      req.body?.slug === undefined ? existing.slug : uniqueSlug('blog_tags', req.body.slug, id);
    db.prepare('UPDATE blog_tags SET name = ?, slug = ? WHERE id = ?').run(name, slug, id);
    recordAudit(req.user!.id, 'update', 'blog_tag', id);
    res.json({ tag: db.prepare('SELECT * FROM blog_tags WHERE id = ?').get(id) });
  }),
);

blogsRouter.delete(
  '/tags/:id',
  requirePermission('blogs.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb().prepare('DELETE FROM blog_tags WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('Tag not found');
    recordAudit(req.user!.id, 'delete', 'blog_tag', id);
    res.json({ ok: true });
  }),
);

// Posts
blogsRouter.get(
  '/posts',
  requirePermission('blogs.view'),
  asyncHandler(async (req, res) => {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (typeof req.query.status === 'string' && req.query.status !== 'all') {
      where.push('p.status = ?');
      params.push(req.query.status);
    }
    if (req.query.categoryId) {
      where.push('p.category_id = ?');
      params.push(Number(req.query.categoryId));
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where.push('(p.title LIKE ? OR p.excerpt LIKE ? OR p.content LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const posts = getDb()
      .prepare(
        `SELECT p.*, c.name AS category_name, u.first_name || ' ' || u.last_name AS author_name,
           (SELECT GROUP_CONCAT(t.name, ', ') FROM blog_post_tags pt
             JOIN blog_tags t ON t.id = pt.tag_id WHERE pt.post_id = p.id) AS tag_names
         FROM blog_posts p
         LEFT JOIN blog_categories c ON c.id = p.category_id
         LEFT JOIN users u ON u.id = p.author_id
         WHERE ${where.join(' AND ')}
         ORDER BY COALESCE(p.published_at, p.created_at) DESC, p.id DESC LIMIT 300`,
      )
      .all(...params);
    res.json({ posts });
  }),
);

blogsRouter.get(
  '/posts/:id',
  requirePermission('blogs.view'),
  asyncHandler(async (req, res) => {
    res.json({ post: postDetail(paramId(req.params.id)) });
  }),
);

blogsRouter.post(
  '/posts',
  requirePermission('blogs.manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const title = requireString(req.body?.title, 'Title', 300);
    const status =
      req.body?.status === undefined ? 'draft' : requireEnum(req.body.status, 'Status', STATUSES);
    const publishedAt =
      optionalDate(req.body?.publishedAt, 'Published date') ??
      (status === 'published' ? new Date().toISOString().slice(0, 10) : null);
    const slug = uniqueSlug(
      'blog_posts',
      typeof req.body?.slug === 'string' && req.body.slug.trim() ? req.body.slug : title,
    );
    const categoryId = optionalInt(req.body?.categoryId, 'Category', 1);
    if (categoryId && !db.prepare('SELECT id FROM blog_categories WHERE id = ?').get(categoryId)) {
      throw notFound('Category not found');
    }

    const id = db.transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO blog_posts
             (title, slug, excerpt, content, category_id, author_id, status, published_at,
              meta_title, meta_description)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          title,
          slug,
          optionalString(req.body?.excerpt, 'Excerpt', 1000),
          optionalString(req.body?.content, 'Content', 100_000) ?? '',
          categoryId,
          req.user!.id,
          status,
          publishedAt,
          optionalString(req.body?.metaTitle, 'Meta title', 200),
          optionalString(req.body?.metaDescription, 'Meta description', 500),
        );
      const postId = Number(result.lastInsertRowid);
      replaceTags(postId, tagIds(req.body?.tagIds));
      return postId;
    })();

    recordAudit(req.user!.id, 'create', 'blog_post', id);
    res.status(201).json({ post: postDetail(id) });
  }),
);

blogsRouter.put(
  '/posts/:id',
  requirePermission('blogs.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM blog_posts WHERE id = ?').get(id) as
      | (Record<string, unknown> & {
          title: string;
          slug: string;
          status: string;
          published_at: string | null;
        })
      | undefined;
    if (!existing) throw notFound('Blog post not found');

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
    const slug =
      req.body?.slug === undefined ? existing.slug : uniqueSlug('blog_posts', req.body.slug, id);
    const categoryId =
      req.body?.categoryId === undefined
        ? (existing.category_id as number | null)
        : optionalInt(req.body.categoryId, 'Category', 1);
    if (categoryId && !db.prepare('SELECT id FROM blog_categories WHERE id = ?').get(categoryId)) {
      throw notFound('Category not found');
    }

    db.transaction(() => {
      db.prepare(
        `UPDATE blog_posts SET title = ?, slug = ?, excerpt = ?, content = ?, category_id = ?,
           status = ?, published_at = ?, meta_title = ?, meta_description = ?,
           updated_at = datetime('now') WHERE id = ?`,
      ).run(
        title,
        slug,
        req.body?.excerpt === undefined
          ? existing.excerpt
          : optionalString(req.body.excerpt, 'Excerpt', 1000),
        req.body?.content === undefined
          ? existing.content
          : (optionalString(req.body.content, 'Content', 100_000) ?? ''),
        categoryId,
        status,
        publishedAt,
        req.body?.metaTitle === undefined
          ? existing.meta_title
          : optionalString(req.body.metaTitle, 'Meta title', 200),
        req.body?.metaDescription === undefined
          ? existing.meta_description
          : optionalString(req.body.metaDescription, 'Meta description', 500),
        id,
      );
      if (req.body?.tagIds !== undefined) replaceTags(id, tagIds(req.body.tagIds));
    })();

    recordAudit(req.user!.id, 'update', 'blog_post', id);
    res.json({ post: postDetail(id) });
  }),
);

blogsRouter.delete(
  '/posts/:id',
  requirePermission('blogs.manage'),
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const result = getDb().prepare('DELETE FROM blog_posts WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('Blog post not found');
    recordAudit(req.user!.id, 'delete', 'blog_post', id);
    res.json({ ok: true });
  }),
);

// Public endpoints (no authentication)
publicBlogsRouter.get(
  '/posts',
  asyncHandler(async (req, res) => {
    const where: string[] = ["p.status = 'published'"];
    const params: unknown[] = [];
    if (typeof req.query.category === 'string' && req.query.category) {
      where.push('c.slug = ?');
      params.push(req.query.category);
    }
    if (typeof req.query.tag === 'string' && req.query.tag) {
      where.push(
        `EXISTS (SELECT 1 FROM blog_post_tags pt JOIN blog_tags t ON t.id = pt.tag_id
                 WHERE pt.post_id = p.id AND t.slug = ?)`,
      );
      params.push(req.query.tag);
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const posts = getDb()
      .prepare(
        `SELECT p.id, p.title, p.slug, p.excerpt, p.published_at, p.views,
                c.name AS category_name, c.slug AS category_slug,
                u.first_name || ' ' || u.last_name AS author_name,
                (SELECT GROUP_CONCAT(t.name, ', ') FROM blog_post_tags pt
                  JOIN blog_tags t ON t.id = pt.tag_id WHERE pt.post_id = p.id) AS tag_names
         FROM blog_posts p
         LEFT JOIN blog_categories c ON c.id = p.category_id
         LEFT JOIN users u ON u.id = p.author_id
         WHERE ${where.join(' AND ')}
         ORDER BY COALESCE(p.published_at, p.created_at) DESC, p.id DESC LIMIT ?`,
      )
      .all(...params, limit);
    res.json({ posts });
  }),
);

publicBlogsRouter.get(
  '/posts/:slug',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const post = db
      .prepare(
        `SELECT p.*, c.name AS category_name, c.slug AS category_slug,
                u.first_name || ' ' || u.last_name AS author_name
         FROM blog_posts p
         LEFT JOIN blog_categories c ON c.id = p.category_id
         LEFT JOIN users u ON u.id = p.author_id
         WHERE p.slug = ? AND p.status = 'published'`,
      )
      .get(req.params.slug) as (Record<string, unknown> & { id: number }) | undefined;
    if (!post) throw notFound('Blog post not found');
    db.prepare('UPDATE blog_posts SET views = views + 1 WHERE id = ?').run(post.id);
    const tags = db
      .prepare(
        `SELECT t.* FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id = t.id
         WHERE pt.post_id = ? ORDER BY t.name`,
      )
      .all(post.id);
    res.json({ post: { ...post, views: Number(post.views) + 1, tags } });
  }),
);

publicBlogsRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const categories = getDb()
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM blog_posts p
           WHERE p.category_id = c.id AND p.status = 'published') AS post_count
         FROM blog_categories c ORDER BY c.name`,
      )
      .all();
    res.json({ categories });
  }),
);

publicBlogsRouter.get(
  '/tags',
  asyncHandler(async (_req, res) => {
    const tags = getDb()
      .prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM blog_post_tags pt
           JOIN blog_posts p ON p.id = pt.post_id
           WHERE pt.tag_id = t.id AND p.status = 'published') AS post_count
         FROM blog_tags t ORDER BY t.name`,
      )
      .all();
    res.json({ tags });
  }),
);
