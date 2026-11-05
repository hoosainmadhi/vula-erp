import bcrypt from 'bcrypt';
import { getDb, closeDb } from '../src/db.js';
import { nextNumber } from '../src/services/sequences.js';

const demo = process.argv.includes('--demo');
const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@vula-erp.local';
const adminPassword = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';

const db = getDb();

function ensureAdmin(): void {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail) as
    { id: number } | undefined;

  if (existing) {
    console.log(`Admin already exists: ${adminEmail}`);
    return;
  }

  const role = db.prepare("SELECT id FROM roles WHERE name = 'admin'").get() as { id: number };
  const result = db
    .prepare('INSERT INTO users (email, password_hash, first_name, last_name) VALUES (?, ?, ?, ?)')
    .run(adminEmail, bcrypt.hashSync(adminPassword, 10), 'System', 'Administrator');
  db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(
    Number(result.lastInsertRowid),
    role.id,
  );
  console.log(`Created admin: ${adminEmail} / ${adminPassword}`);
}

function ensureDemoData(): void {
  const location = db
    .prepare("SELECT id FROM stock_locations WHERE code = 'STOCK' LIMIT 1")
    .get() as {
    id: number;
  };

  const partnerCount = (
    db.prepare('SELECT COUNT(*) AS count FROM partners').get() as { count: number }
  ).count;
  if (partnerCount === 0) {
    const insert = db.prepare(
      'INSERT INTO partners (name, is_customer, is_supplier, email, phone, city, vat_number) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run(
      'Acme Wholesale',
      0,
      1,
      'orders@acme.test',
      '011 555 0101',
      'Johannesburg',
      '4123456789',
    );
    insert.run(
      'Beta Retail (Pty) Ltd',
      1,
      0,
      'accounts@beta.test',
      '021 555 0202',
      'Cape Town',
      '4987654321',
    );
    insert.run('Gamma Services', 1, 1, 'hello@gamma.test', '031 555 0303', 'Durban', '');
    console.log('Seeded demo partners');
  }

  const categoryCount = (
    db.prepare('SELECT COUNT(*) AS count FROM product_categories').get() as {
      count: number;
    }
  ).count;
  if (categoryCount === 0) {
    db.prepare("INSERT INTO product_categories (name) VALUES ('General')").run();
  }
  const category = db.prepare('SELECT id FROM product_categories ORDER BY id LIMIT 1').get() as {
    id: number;
  };
  const vat = db.prepare("SELECT id FROM tax_rates WHERE name = 'Standard VAT 15%'").get() as {
    id: number;
  };

  const productCount = (
    db.prepare('SELECT COUNT(*) AS count FROM products').get() as { count: number }
  ).count;
  if (productCount === 0) {
    const insertProduct = db.prepare(
      `INSERT INTO products (sku, barcode, name, category_id, type, sale_price_cents, cost_cents, tax_rate_id, reorder_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const products: [string, string, string, number, number, number][] = [
      ['SKU-1001', '6001001000011', 'A4 Copy Paper (Ream)', 12_500, 8_500, 10],
      ['SKU-1002', '6001001000028', 'Blue Ballpoint Pens (Box)', 8_900, 5_200, 20],
      ['SKU-1003', '6001001000035', 'Desk Organiser', 24_900, 15_000, 5],
      ['SKU-1004', '6001001000042', 'Whiteboard Marker Set', 15_500, 9_400, 15],
      ['SVC-2001', '', 'On-site IT Support (hour)', 65_000, 0, 0],
    ];
    const ids: number[] = [];
    for (const [sku, barcode, name, sale, cost, reorder] of products) {
      const type = sku.startsWith('SVC') ? 'service' : 'goods';
      const result = insertProduct.run(
        sku,
        barcode || null,
        name,
        category.id,
        type,
        sale,
        cost,
        vat.id,
        reorder,
      );
      ids.push(Number(result.lastInsertRowid));
    }

    const adjust = db.prepare(
      `INSERT INTO stock_moves (product_id, location_id, quantity, move_type, note)
       VALUES (?, ?, ?, 'opening', 'Demo opening stock')`,
    );
    const level = db.prepare(
      `INSERT INTO stock_levels (product_id, location_id, quantity) VALUES (?, ?, ?)
       ON CONFLICT (product_id, location_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
    );
    const opening = [50, 30, 10, 40, 0];
    ids.forEach((productId, index) => {
      const quantity = opening[index] ?? 0;
      if (quantity === 0) return;
      adjust.run(productId, location.id, quantity);
      level.run(productId, location.id, quantity);
    });
    console.log('Seeded demo products and opening stock');
  }

  const employeeCount = (
    db.prepare('SELECT COUNT(*) AS count FROM employees').get() as { count: number }
  ).count;
  if (employeeCount === 0) {
    const department = db.prepare('SELECT id FROM departments ORDER BY id LIMIT 1').get() as {
      id: number;
    };
    db.prepare(
      `INSERT INTO employees (employee_number, first_name, last_name, email, department_id, job_title, start_date, salary_cents)
       VALUES (?, 'Thandi', 'Mokoena', 'thandi@vula-erp.local', ?, 'Operations Manager', '2024-02-01', 3500000)`,
    ).run(nextNumber('employee'), department.id);
    console.log('Seeded demo employee');
  }
}

ensureAdmin();
if (demo) ensureDemoData();
console.log(`Database ready at ${process.env.DB_PATH ?? 'data/vula-erp.db'}`);
closeDb();
