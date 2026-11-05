import request from 'supertest';
import { createApp } from '../app.js';
import { freshDb, seedUser } from '../test/helpers.js';

const app = createApp();

describe('auth', () => {
  beforeEach(() => {
    freshDb();
  });

  it('rejects bad credentials', async () => {
    seedUser({ email: 'admin@example.com', password: 'Password123!' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'wrong' })
      .expect(401);
    expect(res.body.error).toMatch(/invalid email or password/i);
  });

  it('logs in and returns the current user with permissions', async () => {
    const user = seedUser({ email: 'admin@example.com', password: 'Password123!' });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'Password123!' })
      .expect(200);

    expect(login.body.token).toBeTruthy();
    expect(login.body.user.email).toBe('admin@example.com');
    expect(login.body.user.permissions).toContain('accounting.manage');

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(200);
    expect(me.body.user.id).toBe(user.id);
  });

  it('blocks unauthenticated access', async () => {
    await request(app).get('/api/products').expect(401);
  });

  it('enforces role permissions', async () => {
    const viewer = seedUser({ email: 'viewer@example.com', role: 'viewer' });
    await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ sku: 'X1', name: 'Nope' })
      .expect(403);
  });
});
