import { Link } from 'react-router-dom';
import { useFetch } from '../lib/useFetch';
import { shortDate } from '../lib/format';
import { ErrorBox, Spinner } from '../components/ui';
import type { BlogPost } from '../types';

export default function BlogListPage() {
  const posts = useFetch<{ posts: BlogPost[] }>('/public/blogs/posts');

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight text-slate-900">Blog</h1>
        <p className="mt-1 text-sm text-slate-500">News, ideas and updates from our team.</p>
      </div>

      {posts.loading && !posts.data ? (
        <Spinner />
      ) : posts.error ? (
        <ErrorBox message={posts.error} />
      ) : (posts.data?.posts.length ?? 0) === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No posts have been published yet.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {posts.data?.posts.map((post) => (
            <article
              key={post.id}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-emerald-300 hover:shadow"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                {post.category_name ?? 'General'}
                {post.published_at ? ` · ${shortDate(post.published_at)}` : ''}
              </p>
              <h2 className="mt-2 text-lg font-bold text-slate-900">
                <Link to={`/blog/${post.slug}`} className="hover:text-emerald-700">
                  {post.title}
                </Link>
              </h2>
              {post.excerpt ? (
                <p className="mt-2 line-clamp-3 text-sm text-slate-600">{post.excerpt}</p>
              ) : null}
              <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
                <span>{post.author_name ?? 'Editorial team'}</span>
                <span>{post.views} views</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
