import request from 'supertest';
import { createApp } from '../app.js';
import { freshDb, seedUser } from '../test/helpers.js';

const app = createApp();

describe('wave 4 blogs and website', () => {
  let token = '';

  beforeEach(() => {
    freshDb();
    token = seedUser().token;
  });

  describe('blogs', () => {
    it('publishes a post and serves it on the public blog', async () => {
      const category = await request(app)
        .post('/api/blogs/categories')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Company news' })
        .expect(201);
      expect(category.body.category.slug).toBe('company-news');

      const tag = await request(app)
        .post('/api/blogs/tags')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Announcement' })
        .expect(201);

      const draft = await request(app)
        .post('/api/blogs/posts')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'A new chapter',
          excerpt: 'What is changing',
          content: 'We are growing.\n\nThank you for the support.',
          categoryId: category.body.category.id,
          tagIds: [tag.body.tag.id],
          status: 'draft',
        })
        .expect(201);
      expect(draft.body.post.slug).toBe('a-new-chapter');
      expect(draft.body.post.status).toBe('draft');
      expect(draft.body.post.tags).toHaveLength(1);

      const hidden = await request(app).get('/api/public/blogs/posts').expect(200);
      expect(hidden.body.posts).toHaveLength(0);

      const published = await request(app)
        .put(`/api/blogs/posts/${draft.body.post.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'published' })
        .expect(200);
      expect(published.body.post.status).toBe('published');
      expect(published.body.post.published_at).toBeTruthy();

      const list = await request(app).get('/api/public/blogs/posts').expect(200);
      expect(list.body.posts).toHaveLength(1);
      expect(list.body.posts[0].title).toBe('A new chapter');
      expect(list.body.posts[0].category_name).toBe('Company news');

      const detail = await request(app).get('/api/public/blogs/posts/a-new-chapter').expect(200);
      expect(detail.body.post.content).toMatch(/growing/);
      expect(detail.body.post.views).toBe(1);
      expect(detail.body.post.tags[0].name).toBe('Announcement');

      const again = await request(app).get('/api/public/blogs/posts/a-new-chapter').expect(200);
      expect(again.body.post.views).toBe(2);
    });

    it('generates unique slugs for duplicate titles', async () => {
      const first = await request(app)
        .post('/api/blogs/posts')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Same title', content: 'One' })
        .expect(201);
      const second = await request(app)
        .post('/api/blogs/posts')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Same title', content: 'Two' })
        .expect(201);
      expect(first.body.post.slug).toBe('same-title');
      expect(second.body.post.slug).toBe('same-title-2');
    });

    it('blocks public blog routes when the module is disabled', async () => {
      await request(app)
        .post('/api/modules/blogs/disable')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const res = await request(app).get('/api/public/blogs/posts').expect(403);
      expect(res.body.code).toBe('module_disabled');
    });
  });

  describe('website', () => {
    it('publishes a page and serves the public site and page', async () => {
      const page = await request(app)
        .post('/api/website/pages')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'About us',
          content: 'We build things.\nSince 2020.',
          status: 'published',
          showHeader: true,
          showFooter: true,
        })
        .expect(201);
      expect(page.body.page.slug).toBe('about-us');

      const menu = await request(app)
        .post('/api/website/menu')
        .set('Authorization', `Bearer ${token}`)
        .send({ label: 'About', path: '/site/about-us', sort: 1 })
        .expect(201);
      expect(menu.body.item.label).toBe('About');

      const site = await request(app).get('/api/public/website/site').expect(200);
      expect(site.body.site.companyName).toBeTruthy();
      expect(site.body.pages).toHaveLength(1);
      expect(site.body.menu[0].path).toBe('/site/about-us');

      const publicPage = await request(app).get('/api/public/website/pages/about-us').expect(200);
      expect(publicPage.body.page.title).toBe('About us');
      expect(publicPage.body.page.content).toMatch(/Since 2020/);
    });

    it('does not expose draft pages publicly', async () => {
      await request(app)
        .post('/api/website/pages')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Secret', content: 'Not yet' })
        .expect(201);
      await request(app).get('/api/public/website/pages/secret').expect(404);
      const site = await request(app).get('/api/public/website/site').expect(200);
      expect(site.body.pages).toHaveLength(0);
    });

    it('blocks public website routes when the module is disabled', async () => {
      await request(app)
        .post('/api/modules/website/disable')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const res = await request(app).get('/api/public/website/site').expect(403);
      expect(res.body.code).toBe('module_disabled');
    });
  });
});
