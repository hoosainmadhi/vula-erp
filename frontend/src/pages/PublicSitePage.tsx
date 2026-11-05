import { Link, useParams } from 'react-router-dom';
import { useFetch } from '../lib/useFetch';
import { shortDate } from '../lib/format';
import { ErrorBox, Spinner } from '../components/ui';
import type { BlogPost, PublicSite, WebsitePage } from '../types';

export default function PublicSitePage() {
  const { slug } = useParams();
  const site = useFetch<PublicSite>('/public/website/site');
  const page = useFetch<{ page: WebsitePage }>(
    slug ? `/public/website/pages/${encodeURIComponent(slug)}` : null,
    [slug],
  );
  const latest = useFetch<{ posts: BlogPost[] }>('/public/blogs/posts?limit=3');

  if (slug) {
    if (page.loading && !page.data) return <Spinner />;
    if (page.error) return <ErrorBox message={page.error} />;
    if (!page.data?.page) return null;
    return (
      <article className="mx-auto max-w-3xl">
        <Link to="/site" className="text-sm font-semibold text-emerald-700 hover:underline">
          ← Back to home
        </Link>
        <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-900">
          {page.data.page.title}
        </h1>
        <div className="mt-6 whitespace-pre-wrap text-[15px] leading-7 text-slate-700">
          {page.data.page.content}
        </div>
      </article>
    );
  }

  if (site.loading && !site.data) return <Spinner />;
  if (site.error) return <ErrorBox message={site.error} />;

  const data = site.data;
  return (
    <div>
      <section className="rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-800 px-6 py-12 text-white sm:px-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100">
          {data?.site.companyName ?? 'vula-erp'}
        </p>
        <h1 className="mt-3 max-w-2xl text-3xl font-black tracking-tight sm:text-4xl">
          {data?.site.tagline ?? 'News and updates from our team'}
        </h1>
        <p className="mt-3 max-w-xl text-sm text-emerald-50">
          Browse our latest pages and posts, or get in touch.
        </p>
        {data?.site.email ? (
          <a
            href={`mailto:${data.site.email}`}
            className="mt-6 inline-flex rounded-lg bg-white px-4 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50"
          >
            Contact us
          </a>
        ) : null}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-bold text-slate-900">Pages</h2>
        {(data?.pages.length ?? 0) === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No pages have been published yet.</p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {data?.pages.map((item) => (
              <Link
                key={item.id}
                to={`/site/${item.slug}`}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-emerald-300"
              >
                <p className="font-semibold text-slate-800">{item.title}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {item.published_at ? shortDate(item.published_at) : 'Published'}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      {(latest.data?.posts.length ?? 0) > 0 ? (
        <section className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">From the blog</h2>
            <Link to="/blog" className="text-sm font-semibold text-emerald-700 hover:underline">
              All posts →
            </Link>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {latest.data?.posts.map((post) => (
              <Link
                key={post.id}
                to={`/blog/${post.slug}`}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-emerald-300"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  {post.category_name ?? 'General'}
                </p>
                <p className="mt-1 font-semibold text-slate-800">{post.title}</p>
                <p className="mt-1 text-xs text-slate-400">{shortDate(post.published_at)}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
