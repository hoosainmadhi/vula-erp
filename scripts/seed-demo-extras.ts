/**
 * Idempotent demo extras: expenses, attendance and a bank account.
 *
 * Runs on every container boot for the demo apps (see docker-entrypoint.sh) so
 * existing persistent volumes pick up newly added modules without being wiped.
 * Every block only inserts when its table is empty.
 */
import { closeDb, getDb } from '../src/db.js';
import { nextNumber } from '../src/services/sequences.js';
import { accountByCode } from '../src/services/accounting.js';

const db = getDb();

function companyName(): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'company_name'").get() as
    { value: string } | undefined;
  return row?.value ?? 'vula-erp';
}

function adminUserId(): number | null {
  const row = db
    .prepare(
      `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE r.name = 'admin' ORDER BY u.id LIMIT 1`,
    )
    .get() as { id: number } | undefined;
  return row?.id ?? null;
}

/**
 * Demo logins use role emails (sales@, accounts@) while the seeded employee
 * records often use personal emails (yusuf@). Link or create an employee for
 * every staff login so My Leave works for admins and staff, not just employees.
 */
function linkDemoLogins(): void {
  const staffRoles = new Set([
    'admin',
    'sales',
    'accountant',
    'warehouse',
    'workshop',
    'hr',
    'employee',
  ]);
  const users = db
    .prepare(
      `SELECT u.id, u.email, u.first_name, u.last_name,
              COALESCE(GROUP_CONCAT(r.name, ','), '') AS role_names
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.is_active = 1
       GROUP BY u.id
       ORDER BY u.id`,
    )
    .all() as {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    role_names: string;
  }[];

  const findLinked = db.prepare('SELECT id FROM employees WHERE user_id = ?');
  const findUnlinkedByEmail = db.prepare(
    'SELECT id FROM employees WHERE lower(email) = lower(?) AND user_id IS NULL ORDER BY id LIMIT 1',
  );
  const link = db.prepare('UPDATE employees SET user_id = ? WHERE id = ?');
  const insert = db.prepare(
    `INSERT INTO employees
       (employee_number, user_id, first_name, last_name, email, job_title,
        employment_type, status, start_date)
     VALUES (?, ?, ?, ?, ?, ?, 'permanent', 'active', '2024-01-01')`,
  );

  for (const user of users) {
    const roles = user.role_names ? user.role_names.split(',') : [];
    if (!roles.some((role) => staffRoles.has(role))) continue;
    if (findLinked.get(user.id)) continue;

    const byEmail = findUnlinkedByEmail.get(user.email) as { id: number } | undefined;
    if (byEmail) {
      link.run(user.id, byEmail.id);
      continue;
    }
    insert.run(
      nextNumber('employee'),
      user.id,
      user.first_name,
      user.last_name,
      user.email,
      roles[0] ?? 'Staff',
    );
  }
}

function seedExpenses(adminId: number | null, jabulani: boolean): void {
  const count = db.prepare('SELECT COUNT(*) AS count FROM expenses').get() as { count: number };
  if (count.count > 0) return;
  const insert = db.prepare(
    `INSERT INTO expenses
       (number, expense_date, category, description, amount_cents, tax_cents, total_cents,
        payment_method, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
  );
  const rows: [string, string, number, string, string][] = jabulani
    ? [
        ['2026-10-01', 'Rent', 1_800_000, 'bank', 'Workshop and yard rent — October'],
        ['2026-10-03', 'Utilities', 420_000, 'bank', 'City Power and water — October'],
        ['2026-10-08', 'Transport', 185_000, 'card', 'Deliveries to Rosebank and Sandton sites'],
        ['2026-10-15', 'Consumables', 96_500, 'cash', 'Glue, screws and workshop consumables'],
        ['2026-10-25', 'Repairs', 240_000, 'bank', 'Edgebander service and blade replacement'],
      ]
    : [
        ['2026-10-01', 'Rent', 2_400_000, 'bank', 'Factory and showroom rent — October'],
        ['2026-10-04', 'Utilities', 510_000, 'bank', 'Electricity and water — October'],
        ['2026-10-09', 'Transport', 210_000, 'card', 'Coach deliveries to Gauteng depots'],
        ['2026-10-18', 'Consumables', 132_000, 'cash', 'Adhesives, trims and upholstery supplies'],
        ['2026-10-26', 'Marketing', 350_000, 'bank', 'Trade show and brochure print run'],
      ];
  for (const [date, category, net, method, description] of rows) {
    const tax = Math.round(net * 0.15);
    insert.run(
      nextNumber('expense'),
      date,
      category,
      description,
      net,
      tax,
      net + tax,
      method,
      adminId,
    );
  }
}

function seedAttendance(): void {
  const count = db.prepare('SELECT COUNT(*) AS count FROM attendance').get() as { count: number };
  if (count.count > 0) return;
  const employees = db.prepare("SELECT id FROM employees WHERE status <> 'terminated'").all() as {
    id: number;
  }[];
  const insert = db.prepare(
    `INSERT OR IGNORE INTO attendance
       (employee_id, work_date, clock_in, clock_out, status, hours)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const employee of employees) {
    ['2026-11-03', '2026-11-04', '2026-11-05'].forEach((date, index) => {
      const late = index === 1;
      insert.run(
        employee.id,
        date,
        late ? '08:22' : '07:55',
        '17:05',
        late ? 'late' : 'present',
        9,
      );
    });
  }
}

function seedBank(jabulani: boolean): void {
  const count = db.prepare('SELECT COUNT(*) AS count FROM bank_accounts').get() as {
    count: number;
  };
  if (count.count > 0) return;
  const bank = accountByCode('1000');
  const result = db
    .prepare(
      `INSERT INTO bank_accounts (name, bank_name, account_number, gl_account_id, opening_balance_cents)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      jabulani ? 'FNB Business Current' : 'Standard Bank Current',
      jabulani ? 'FNB' : 'Standard Bank',
      jabulani ? '62710001234' : '04210098765',
      bank.id,
      jabulani ? 25_000_000 : 18_000_000,
    );
  const bankAccountId = Number(result.lastInsertRowid);
  const insert = db.prepare(
    `INSERT INTO bank_transactions
       (bank_account_id, transaction_date, description, reference, amount_cents)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const rows: [string, string, string, number][] = jabulani
    ? [
        ['2026-10-28', 'EFT — Highveld Shopfitters', 'INV-00021', 2_150_000],
        ['2026-10-30', 'EFT — Sandton Interiors', 'INV-00022', 890_000],
        ['2026-11-01', 'Bank charges', 'FNB-FEE', -18_500],
        ['2026-11-02', 'EFT — City Power', 'ELEC-OCT', -483_000],
        ['2026-11-04', 'Card settlement', 'POS-BATCH', 1_245_000],
      ]
    : [
        ['2026-10-29', 'EFT — Mega Coaches', 'INV-00018', 3_450_000],
        ['2026-10-31', 'EFT — City of Joburg', 'COJ-OCT', -612_000],
        ['2026-11-01', 'Bank charges', 'SB-FEE', -21_000],
        ['2026-11-03', 'Card settlement', 'POS-BATCH', 980_000],
        ['2026-11-04', 'EFT — Gauteng Coach Lines', 'INV-00019', 1_275_000],
      ];
  for (const [date, description, reference, amount] of rows) {
    insert.run(bankAccountId, date, description, reference, amount);
  }
}

function main(): void {
  const name = companyName();
  const jabulani = /jabulani/i.test(name);
  linkDemoLogins();
  seedExpenses(adminUserId(), jabulani);
  seedAttendance();
  seedBank(jabulani);
  console.log(`Demo extras ready for ${name}.`);
}

main();
closeDb();
