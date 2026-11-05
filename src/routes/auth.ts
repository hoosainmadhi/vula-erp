import { Router } from 'express';
import bcrypt from 'bcrypt';
import { getDb } from '../db.js';
import { authenticate, loadUser, publicUser, rateLimit, signToken } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { HttpError, ValidationError } from '../utils/errors.js';
import { requireString } from '../utils/validate.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  rateLimit(20, 15 * 60 * 1000),
  asyncHandler(async (req, res) => {
    const email = requireString(req.body?.email, 'Email', 320).toLowerCase();
    const password = requireString(req.body?.password, 'Password', 200);

    const user = getDb()
      .prepare('SELECT id, password_hash, is_active FROM users WHERE email = ?')
      .get(email) as { id: number; password_hash: string; is_active: number } | undefined;

    if (!user || user.is_active !== 1 || !bcrypt.compareSync(password, user.password_hash)) {
      throw new HttpError(401, 'Invalid email or password', 'invalid_credentials');
    }

    getDb().prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
    const loaded = loadUser(user.id);
    if (!loaded) throw new HttpError(401, 'Account is inactive', 'inactive');
    res.json({ token: signToken(user.id), user: publicUser(loaded) });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ user: publicUser(req.user!) });
  }),
);

authRouter.post(
  '/change-password',
  authenticate,
  rateLimit(10, 15 * 60 * 1000),
  asyncHandler(async (req, res) => {
    const currentPassword = requireString(req.body?.currentPassword, 'Current password', 200);
    const newPassword = requireString(req.body?.newPassword, 'New password', 200);
    if (newPassword.length < 8)
      throw new ValidationError('New password must be at least 8 characters');

    const row = getDb()
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(req.user!.id) as { password_hash: string } | undefined;
    if (!row || !bcrypt.compareSync(currentPassword, row.password_hash)) {
      throw new ValidationError('Current password is incorrect');
    }

    getDb()
      .prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .run(bcrypt.hashSync(newPassword, 10), req.user!.id);
    res.json({ ok: true });
  }),
);
