import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../lib/useFetch';
import { shortDate, titleCase, today } from '../lib/format';
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
import type { BlogCategory, BlogPost, BlogTag } from '../types';

type Tab = 'posts' | 'categories' | 'tags';

function PostForm({
  post,
  categories,
  tags,
  onSaved,
  onClose,
}: {
  post: BlogPost | null;
  categories: BlogCategory[];
  tags: BlogTag[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(post?.title ?? '');
  const [slug, setSlug] = useState(post?.slug ?? '');
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? '');
  const [content, setContent] = useState(post?.content ?? '');
  const [categoryId, setCategoryId] = useState(String(post?.category_id ?? ''));
  const [status, setStatus] = useState<string>(post?.status ?? 'draft');
  const [publishedAt, setPublishedAt] = useState(post?.published_at ?? today());
  const [metaTitle, setMetaTitle] = useState(post?.meta_title ?? '');
  const [metaDescription, setMetaDescription] = useState(post?.meta_description ?? '');
  const [tagIds, setTagIds] = useState<number[]>(post?.tags?.map((tag) => tag.id) ?? []);
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
        excerpt: excerpt || null,
        content,
        categoryId: categoryId ? Number(categoryId) : null,
        status,
        publishedAt: status === 'published' ? publishedAt || null : null,
        metaTitle: metaTitle || null,
        metaDescription: metaDescription || null,
        tagIds,
      };
      if (post) await api.put(`/blogs/posts/${post.id}`, body);
      else await api.post('/blogs/posts', body);
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
      <Field label="Excerpt">
        <textarea
          className={inputCls}
          rows={2}
          value={excerpt}
          onChange={(event) => setExcerpt(event.target.value)}
        />
      </Field>
      <Field label="Content">
        <textarea
          className={`${inputCls} font-mono text-xs`}
          rows={12}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Write the post. Line breaks are preserved on the public page."
        />
      </Field>
      <Field label="Tags">
        {tags.length === 0 ? (
          <p className="text-sm text-slate-500">Create tags in the Tags tab first.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {tags.map((tag) => (
              <label key={tag.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={tagIds.includes(tag.id)}
                  onChange={(event) =>
                    setTagIds(
                      event.target.checked
                        ? [...tagIds, tag.id]
                        : tagIds.filter((id) => id !== tag.id),
                    )
                  }
                  className="size-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                {tag.name}
              </label>
            ))}
          </div>
        )}
      </Field>
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
          {busy ? 'Saving…' : post ? 'Save changes' : 'Create post'}
        </button>
      </div>
    </form>
  );
}

export default function BlogsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('posts');
  const [status, setStatus] = useState('all');
  const [postModal, setPostModal] = useState<BlogPost | 'new' | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [categorySlug, setCategorySlug] = useState('');
  const [editingCategory, setEditingCategory] = useState<BlogCategory | null>(null);
  const [tagName, setTagName] = useState('');
  const [tagSlug, setTagSlug] = useState('');
  const [editingTag, setEditingTag] = useState<BlogTag | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);

  const posts = useFetch<{ posts: BlogPost[] }>(`/blogs/posts?${params}`, [status]);
  const categories = useFetch<{ categories: BlogCategory[] }>('/blogs/categories');
  const tags = useFetch<{ tags: BlogTag[] }>('/blogs/tags');

  const openPost = async (post: BlogPost) => {
    setError(null);
    try {
      const result = await api.get<{ post: BlogPost }>(`/blogs/posts/${post.id}`);
      setPostModal(result.post);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const removePost = async (post: BlogPost) => {
    if (!window.confirm(`Delete “${post.title}”?`)) return;
    setError(null);
    try {
      await api.del(`/blogs/posts/${post.id}`);
      posts.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const saveCategory = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      if (editingCategory) {
        await api.put(`/blogs/categories/${editingCategory.id}`, {
          name: categoryName,
          slug: categorySlug || null,
        });
      } else {
        await api.post('/blogs/categories', { name: categoryName, slug: categorySlug || null });
      }
      setCategoryName('');
      setCategorySlug('');
      setEditingCategory(null);
      categories.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const removeCategory = async (category: BlogCategory) => {
    if (!window.confirm(`Delete category “${category.name}”?`)) return;
    setError(null);
    try {
      await api.del(`/blogs/categories/${category.id}`);
      categories.reload();
      posts.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const saveTag = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      if (editingTag) {
        await api.put(`/blogs/tags/${editingTag.id}`, { name: tagName, slug: tagSlug || null });
      } else {
        await api.post('/blogs/tags', { name: tagName, slug: tagSlug || null });
      }
      setTagName('');
      setTagSlug('');
      setEditingTag(null);
      tags.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const removeTag = async (tag: BlogTag) => {
    if (!window.confirm(`Delete tag “${tag.name}”?`)) return;
    setError(null);
    try {
      await api.del(`/blogs/tags/${tag.id}`);
      tags.reload();
      posts.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const postRows = posts.data?.posts ?? [];
  const categoryRows = categories.data?.categories ?? [];
  const tagRows = tags.data?.tags ?? [];

  return (
    <>
      <PageHeader
        title="Blogs"
        subtitle="Public posts, categories and tags"
        actions={
          can('blogs.manage') && tab === 'posts' ? (
            <button type="button" className={btnPrimary} onClick={() => setPostModal('new')}>
              <Plus className="size-4" /> New post
            </button>
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {(
            [
              ['posts', 'Posts'],
              ['categories', 'Categories'],
              ['tags', 'Tags'],
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
        {tab === 'posts' ? (
          <select
            className={`${inputCls} w-auto`}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        ) : null}
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {tab === 'posts' ? (
        posts.loading && !posts.data ? (
          <Spinner />
        ) : posts.error ? (
          <ErrorBox message={posts.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Title</th>
                  <th className={thCls}>Category</th>
                  <th className={thCls}>Tags</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Published</th>
                  <th className={`${thCls} text-right`}>Views</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {postRows.length === 0 ? (
                  <EmptyState colSpan={7} message="No blog posts yet." />
                ) : (
                  postRows.map((post) => (
                    <tr key={post.id} className="hover:bg-slate-50">
                      <td className={tdCls}>
                        <p className="font-semibold text-slate-800">{post.title}</p>
                        <p className="font-mono text-xs text-slate-400">/blog/{post.slug}</p>
                      </td>
                      <td className={tdCls}>{post.category_name ?? '—'}</td>
                      <td className={tdCls}>{post.tag_names ?? '—'}</td>
                      <td className={tdCls}>
                        <Badge value={post.status} />
                      </td>
                      <td className={tdCls}>{shortDate(post.published_at)}</td>
                      <td className={`${tdCls} text-right`}>{post.views}</td>
                      <td className={tdCls}>
                        {can('blogs.manage') ? (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => void openPost(post)}
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => void removePost(post)}
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

      {tab === 'categories' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {can('blogs.manage') ? (
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-bold text-slate-800">
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
                <Field label="Slug">
                  <input
                    className={inputCls}
                    value={categorySlug}
                    onChange={(event) => setCategorySlug(event.target.value)}
                    placeholder="auto-generated"
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
                        setCategorySlug('');
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
                  <th className={thCls}>Slug</th>
                  <th className={`${thCls} text-right`}>Posts</th>
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
                      <td className={`${tdCls} font-mono text-xs`}>{category.slug}</td>
                      <td className={`${tdCls} text-right`}>{category.post_count ?? 0}</td>
                      <td className={tdCls}>
                        {can('blogs.manage') ? (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => {
                                setEditingCategory(category);
                                setCategoryName(category.name);
                                setCategorySlug(category.slug);
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

      {tab === 'tags' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {can('blogs.manage') ? (
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-bold text-slate-800">
                {editingTag ? 'Rename tag' : 'New tag'}
              </h2>
              <form onSubmit={saveTag} className="space-y-3">
                <Field label="Name">
                  <input
                    className={inputCls}
                    value={tagName}
                    onChange={(event) => setTagName(event.target.value)}
                    required
                  />
                </Field>
                <Field label="Slug">
                  <input
                    className={inputCls}
                    value={tagSlug}
                    onChange={(event) => setTagSlug(event.target.value)}
                    placeholder="auto-generated"
                  />
                </Field>
                <div className="flex gap-2">
                  <button type="submit" className={btnPrimary}>
                    {editingTag ? 'Save' : 'Add tag'}
                  </button>
                  {editingTag ? (
                    <button
                      type="button"
                      className={btnSecondary}
                      onClick={() => {
                        setEditingTag(null);
                        setTagName('');
                        setTagSlug('');
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
                  <th className={thCls}>Tag</th>
                  <th className={thCls}>Slug</th>
                  <th className={`${thCls} text-right`}>Posts</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {tagRows.length === 0 ? (
                  <EmptyState colSpan={4} message="No tags yet." />
                ) : (
                  tagRows.map((tag) => (
                    <tr key={tag.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-semibold text-slate-800`}>{tag.name}</td>
                      <td className={`${tdCls} font-mono text-xs`}>{tag.slug}</td>
                      <td className={`${tdCls} text-right`}>{tag.post_count ?? 0}</td>
                      <td className={tdCls}>
                        {can('blogs.manage') ? (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => {
                                setEditingTag(tag);
                                setTagName(tag.name);
                                setTagSlug(tag.slug);
                              }}
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => void removeTag(tag)}
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

      {postModal ? (
        <Modal
          title={postModal === 'new' ? 'New blog post' : `Edit “${postModal.title}”`}
          onClose={() => setPostModal(null)}
          wide
        >
          <PostForm
            post={postModal === 'new' ? null : postModal}
            categories={categoryRows}
            tags={tagRows}
            onSaved={() => {
              posts.reload();
              categories.reload();
              tags.reload();
            }}
            onClose={() => setPostModal(null)}
          />
        </Modal>
      ) : null}
    </>
  );
}
