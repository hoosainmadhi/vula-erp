import bcrypt from 'bcrypt';
import { getDb, resetDbForTests } from '../db.js';
import { signToken } from '../middleware/auth.js';

export function freshDb(): void {
  resetDbForTests();
  getDb();
}

export function seedUser(options?: {
  email?: string;
  password?: string;
  role?: string;
  firstName?: string;
  lastName?: string;
}): { id: number; token: string; email: string; password: string } {
  const db = getDb();
  const email = options?.email ?? 'admin@example.com';
  const password = options?.password ?? 'Password123!';
  const role = options?.role ?? 'admin';
  const firstName = options?.firstName ?? 'Test';
  const lastName = options?.lastName ?? 'User';

  const result = db
    .prepare('INSERT INTO users (email, password_hash, first_name, last_name) VALUES (?, ?, ?, ?)')
    .run(email, bcrypt.hashSync(password, 4), firstName, lastName);
  const id = Number(result.lastInsertRowid);
  const roleRow = db.prepare('SELECT id FROM roles WHERE name = ?').get(role) as { id: number };
  db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(id, roleRow.id);

  return { id, token: signToken(id), email, password };
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export function seedPartner(options: {
  name: string;
  isCustomer?: boolean;
  isSupplier?: boolean;
}): number {
  const db = getDb();
  const result = db
    .prepare('INSERT INTO partners (name, is_customer, is_supplier) VALUES (?, ?, ?)')
    .run(options.name, options.isCustomer ? 1 : 0, options.isSupplier ? 1 : 0);
  return Number(result.lastInsertRowid);
}

export function seedProduct(options: {
  sku: string;
  name?: string;
  salePriceCents?: number;
  costCents?: number;
  taxRateId?: number | null;
}): number {
  const db = getDb();
  const taxRateId =
    options.taxRateId === undefined
      ? (
          db.prepare("SELECT id FROM tax_rates WHERE name = 'Standard VAT 15%'").get() as {
            id: number;
          }
        ).id
      : options.taxRateId;
  const result = db
    .prepare(
      `INSERT INTO products (sku, name, sale_price_cents, cost_cents, tax_rate_id, track_inventory)
       VALUES (?, ?, ?, ?, ?, 1)`,
    )
    .run(
      options.sku,
      options.name ?? `Product ${options.sku}`,
      options.salePriceCents ?? 10_000,
      options.costCents ?? 6_000,
      taxRateId,
    );
  return Number(result.lastInsertRowid);
}

export function defaultLocationId(): number {
  const row = getDb().prepare("SELECT id FROM stock_locations WHERE code = 'STOCK'").get() as {
    id: number;
  };
  return row.id;
}
