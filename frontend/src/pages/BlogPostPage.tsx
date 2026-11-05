import { Link, useParams } from 'react-router-dom';
import { useFetch } from '../lib/useFetch';
import { shortDate } from '../lib/format';
import { ErrorBox, Spinner } from '../components/ui';
import type { BlogPost } from '../types';

export default function BlogPostPage() {
  const { slug } = useParams();
  const post = useFetch<{ post: BlogPost }>(
    slug ? `/public/blogs/posts/${encodeURIComponent(slug)}` : null,
    [slug],
  );

  if (post.loading && !post.data) return <Spinner />;
  if (post.error) return <ErrorBox message={post.error} />;
  if (!post.data?.post) return null;

  const article = post.data.post;

  return (
    <article className="mx-auto max-w-3xl">
      <Link to="/blog" className="text-sm font-semibold text-emerald-700 hover:underline">
        ← Back to the blog
      </Link>
      <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-emerald-700">
        {article.category_name ?? 'General'}
        {article.published_at ? ` · ${shortDate(article.published_at)}` : ''}
      </p>
      <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
        {article.title}
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        {article.author_name ?? 'Editorial team'} · {article.views} views
      </p>
      {article.excerpt ? (
        <p className="mt-6 border-l-4 border-emerald-200 pl-4 text-base text-slate-600">
          {article.excerpt}
        </p>
      ) : null}
      <div className="mt-8 whitespace-pre-wrap text-[15px] leading-7 text-slate-700">
        {article.content}
      </div>
      {article.tags && article.tags.length > 0 ? (
        <div className="mt-8 flex flex-wrap gap-2">
          {article.tags.map((tag) => (
            <span
              key={tag.id}
              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600"
            >
              #{tag.name}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
