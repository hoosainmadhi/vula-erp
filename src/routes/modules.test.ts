import request from 'supertest';
import { createApp } from '../app.js';
import { freshDb, seedUser } from '../test/helpers.js';

const app = createApp();

describe('modules', () => {
  beforeEach(() => {
    freshDb();
  });

  it('lists the module catalogue with every module enabled by default', async () => {
    const admin = seedUser();
    const res = await request(app)
      .get('/api/modules')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);

    expect(res.body.modules.length).toBeGreaterThanOrEqual(10);
    expect(res.body.modules.every((module: { enabled: boolean }) => module.enabled)).toBe(true);
    expect(
      res.body.modules.find((module: { key: string }) => module.key === 'dashboard').isCore,
    ).toBe(true);
  });

  it('disables a module and blocks its API until re-enabled', async () => {
    const admin = seedUser();

    const disable = await request(app)
      .post('/api/modules/partners/disable')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(
      disable.body.modules.find((module: { key: string }) => module.key === 'partners').enabled,
    ).toBe(false);

    const blocked = await request(app)
      .get('/api/partners')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(403);
    expect(blocked.body.code).toBe('module_disabled');

    await request(app)
      .post('/api/modules/partners/enable')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);

    await request(app)
      .get('/api/partners')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
  });

  it('refuses to disable core modules', async () => {
    const admin = seedUser();
    const res = await request(app)
      .post('/api/modules/dashboard/disable')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(400);
    expect(res.body.error).toMatch(/core modules/i);
  });

  it('requires modules.manage to change module state', async () => {
    const viewer = seedUser({ email: 'viewer@example.com', role: 'viewer' });
    await request(app)
      .post('/api/modules/partners/disable')
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(403);
  });
});
