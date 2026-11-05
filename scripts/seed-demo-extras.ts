/**
 * Idempotent demo extras: expenses, attendance and a bank account.
 *
 * Runs on every container boot for the demo apps (see docker-entrypoint.sh) so
 * existing persistent volumes pick up newly added modules without being wiped.
 * Every block only inserts when its table is empty.
 */
import { closeDb, getDb } from '../src/db.js';
import { nextNumber } from '../src/services/sequences.js';
import { accountByCode, postJournalEntry } from '../src/services/accounting.js';
import { lineTotals } from '../src/utils/money.js';
import { addDays } from '../src/utils/dates.js';

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

function updateProductAttributes(): void {
  const rows = db
    .prepare(
      `SELECT id, description FROM products
       WHERE description LIKE 'Brand:%' AND (brand IS NULL OR colour IS NULL OR size IS NULL OR thickness IS NULL)`,
    )
    .all() as { id: number; description: string }[];
  const update = db.prepare(
    'UPDATE products SET brand = ?, colour = ?, size = ?, thickness = ? WHERE id = ?',
  );
  for (const row of rows) {
    const match = row.description.match(/^Brand:\s*([^.]+)\.\s*(.*)\.$/);
    if (!match) continue;
    const brand = match[1]?.trim() || null;
    const spec = match[2] ?? '';
    let colour: string | null = null;
    let size: string | null = null;
    let thickness: string | null = null;
    for (const part of spec.split('·').map((value) => value.trim())) {
      if (!part) continue;
      if (/^\d+(?:\.\d+)?mm$/i.test(part)) {
        thickness = part;
      } else if (/^\d+\s*[x×]\s*\d+/i.test(part)) {
        size = part.replace(/\s*[x×]\s*/i, 'x');
      } else if (
        !colour &&
        !/^(pack of|per |made to order|clip-on|cut |cutting |on-site|full extension|hot melt)/i.test(
          part,
        )
      ) {
        colour = part;
      }
    }
    update.run(brand, colour, size, thickness, row.id);
  }
}

function seedQuotations(adminId: number | null): void {
  const count = db.prepare('SELECT COUNT(*) AS count FROM quotations').get() as { count: number };
  if (count.count > 0) return;
  const customers = db
    .prepare('SELECT id FROM partners WHERE is_customer = 1 ORDER BY id LIMIT 4')
    .all() as { id: number }[];
  const products = db
    .prepare(
      `SELECT p.id, p.name, p.sale_price_cents, COALESCE(t.rate_bp, 0) AS rate_bp
       FROM products p LEFT JOIN tax_rates t ON t.id = p.tax_rate_id
       WHERE p.type = 'goods' ORDER BY p.id LIMIT 8`,
    )
    .all() as { id: number; name: string; sale_price_cents: number; rate_bp: number }[];
  if (customers.length === 0 || products.length === 0) return;
  const warehouse = db.prepare('SELECT id FROM warehouses ORDER BY id LIMIT 1').get() as
    { id: number } | undefined;

  const quotes = [
    {
      status: 'sent',
      customer: customers[0]!,
      date: '2026-10-27',
      lines: [
        { product: products[0]!, quantity: 6 },
        { product: products[1] ?? products[0]!, quantity: 2 },
      ],
      notes: 'Cutting list to follow after site measure.',
    },
    {
      status: 'accepted',
      customer: customers[1] ?? customers[0]!,
      date: '2026-10-29',
      lines: [
        { product: products[2] ?? products[0]!, quantity: 10 },
        { product: products[3] ?? products[1]!, quantity: 4 },
      ],
      notes: 'Includes delivery to site.',
    },
    {
      status: 'draft',
      customer: customers[2] ?? customers[0]!,
      date: '2026-11-02',
      lines: [
        { product: products[4] ?? products[0]!, quantity: 3 },
        { product: products[5] ?? products[1]!, quantity: 6 },
      ],
      notes: 'Awaiting final board selection.',
    },
  ];

  const insertQuote = db.prepare(
    `INSERT INTO quotations
       (number, customer_id, warehouse_id, status, quote_date, valid_until,
        subtotal_cents, tax_cents, total_cents, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertLine = db.prepare(
    `INSERT INTO quotation_lines
       (quotation_id, product_id, description, quantity, unit_price_cents, tax_rate_bp,
        line_subtotal_cents, line_tax_cents, line_total_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  db.transaction(() => {
    for (const quote of quotes) {
      const lines = quote.lines.map((line) => ({
        ...line,
        totals: lineTotals(line.quantity, line.product.sale_price_cents, line.product.rate_bp),
      }));
      const subtotal = lines.reduce((total, line) => total + line.totals.subtotalCents, 0);
      const tax = lines.reduce((total, line) => total + line.totals.taxCents, 0);
      const result = insertQuote.run(
        nextNumber('quotation'),
        quote.customer.id,
        warehouse?.id ?? null,
        quote.status,
        quote.date,
        addDays(quote.date, 30),
        subtotal,
        tax,
        subtotal + tax,
        quote.notes,
        adminId,
      );
      const quotationId = Number(result.lastInsertRowid);
      for (const line of lines) {
        insertLine.run(
          quotationId,
          line.product.id,
          line.product.name,
          line.quantity,
          line.product.sale_price_cents,
          line.product.rate_bp,
          line.totals.subtotalCents,
          line.totals.taxCents,
          line.totals.totalCents,
        );
      }
    }
  })();
}

function seedCreditNotes(adminId: number | null): void {
  const count = db.prepare('SELECT COUNT(*) AS count FROM credit_notes').get() as { count: number };
  if (count.count > 0) return;
  const invoice = db
    .prepare(
      `SELECT i.id, i.number, i.partner_id, i.total_cents
       FROM invoices i
       WHERE i.direction = 'sale' AND i.status = 'open'
         AND (i.total_cents - i.amount_paid_cents) >= 30000
       ORDER BY i.id DESC LIMIT 1`,
    )
    .get() as { id: number; number: string; partner_id: number; total_cents: number } | undefined;
  if (!invoice) return;

  const net = Math.min(25_000, Math.floor(invoice.total_cents / 2));
  const tax = Math.round(net * 0.15);
  const total = net + tax;
  const issueDate = '2026-11-04';

  db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO credit_notes
           (number, invoice_id, partner_id, issue_date, subtotal_cents, tax_cents, total_cents,
            reason, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?)`,
      )
      .run(
        nextNumber('credit_note'),
        invoice.id,
        invoice.partner_id,
        issueDate,
        net,
        tax,
        total,
        'Short delivery — damaged board returned to branch',
        adminId,
      );
    const creditId = Number(result.lastInsertRowid);
    const journalId = postJournalEntry({
      journalCode: 'GEN',
      entryDate: issueDate,
      description: `Credit note against ${invoice.number}`,
      sourceType: 'credit_note',
      sourceId: creditId,
      userId: adminId ?? undefined,
      items: [
        {
          accountId: accountByCode('4000').id,
          debitCents: net,
          description: 'Credit note — revenue reversal',
        },
        {
          accountId: accountByCode('2100').id,
          debitCents: tax,
          description: 'Credit note — VAT output reversal',
        },
        {
          accountId: accountByCode('1100').id,
          creditCents: total,
          description: `Credit note against ${invoice.number}`,
        },
      ],
    });
    db.prepare('UPDATE credit_notes SET journal_entry_id = ? WHERE id = ?').run(
      journalId,
      creditId,
    );
  })();
}

function seedWorkshopJobs(adminId: number | null): void {
  const count = db.prepare('SELECT COUNT(*) AS count FROM workshop_jobs').get() as {
    count: number;
  };
  if (count.count > 0) return;
  const customers = db
    .prepare('SELECT id FROM partners WHERE is_customer = 1 ORDER BY id LIMIT 3')
    .all() as { id: number }[];
  if (customers.length === 0) return;
  const paidInvoice = db
    .prepare(
      "SELECT id FROM invoices WHERE direction = 'sale' AND status = 'paid' ORDER BY id DESC LIMIT 1",
    )
    .get() as { id: number } | undefined;
  const openInvoice = db
    .prepare(
      "SELECT id FROM invoices WHERE direction = 'sale' AND status = 'open' ORDER BY id DESC LIMIT 1",
    )
    .get() as { id: number } | undefined;
  const lead = db
    .prepare("SELECT id FROM users WHERE email = 'workshop.lead@jabulani.local'")
    .get() as { id: number } | undefined;

  const jobs = [
    {
      title: 'Kitchen carcasses — cut and edge',
      status: 'ready',
      priority: 'high',
      dueDate: '2026-11-06',
      customerId: customers[0]!.id,
      invoiceId: paidInvoice?.id ?? null,
      quoted: 850_000,
      material: 320_000,
      labour: 180_000,
      expense: 40_000,
      cuttingList:
        '18mm White melamine — 12 carcass sides 720x560, 6 shelves 560x520, 4 backs 720x560.\nEdge band all front edges 22mm ABS white. Grain direction vertical.',
    },
    {
      title: 'Wardrobe panels — awaiting payment',
      status: 'awaiting_payment',
      priority: 'medium',
      dueDate: '2026-11-12',
      customerId: customers[1]?.id ?? customers[0]!.id,
      invoiceId: openInvoice?.id ?? null,
      quoted: 640_000,
      material: 240_000,
      labour: 120_000,
      expense: 25_000,
      cuttingList:
        '16mm Oak melamine — 8 wardrobe sides 2100x600, 4 tops 1200x600, 2 doors 2100x595.\nEdge band exposed edges with 22mm oak ABS. Check grain before cutting.',
    },
  ];
  const operations = [
    'Cutting list check',
    'Panel cutting',
    'Edge banding',
    'Assembly',
    'Quality check',
    'Collection',
  ];

  const insertJob = db.prepare(
    `INSERT INTO workshop_jobs
       (number, customer_id, invoice_id, title, status, priority, due_date, assigned_to,
        payment_required, quoted_cents, material_cost_cents, labour_cost_cents,
        expense_cost_cents, cutting_list_notes, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertOperation = db.prepare(
    `INSERT INTO workshop_job_operations (job_id, name, sequence, status, assigned_to)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertFile = db.prepare(
    `INSERT INTO workshop_job_files (job_id, filename, mime_type, size_bytes, content, uploaded_by)
     VALUES (?, ?, 'text/csv', ?, ?, ?)`,
  );

  db.transaction(() => {
    for (const job of jobs) {
      const result = insertJob.run(
        nextNumber('workshop_job'),
        job.customerId,
        job.invoiceId,
        job.title,
        job.status,
        job.priority,
        job.dueDate,
        lead?.id ?? null,
        job.quoted,
        job.material,
        job.labour,
        job.expense,
        job.cuttingList,
        job.status === 'ready'
          ? 'All operations complete. Customer notified for collection.'
          : 'Release once the linked invoice is paid.',
        adminId,
      );
      const jobId = Number(result.lastInsertRowid);
      operations.forEach((name, index) => {
        insertOperation.run(
          jobId,
          name,
          index + 1,
          job.status === 'ready' ? 'done' : 'pending',
          lead?.id ?? null,
        );
      });
      const csv = `item,description,width_mm,height_mm,qty,edge\n1,Carcass side,720,560,12,front\n2,Shelf,560,520,6,front\n`;
      insertFile.run(
        jobId,
        `WS-${String(jobId).padStart(5, '0')}-cutting-list.csv`,
        Buffer.byteLength(csv),
        Buffer.from(csv),
        adminId,
      );
    }
  })();
}

function main(): void {
  const name = companyName();
  const jabulani = /jabulani/i.test(name);
  const logo = jabulani ? '/jabulani-logo.svg' : '/africoach-logo.svg';
  const existingLogo = db.prepare("SELECT value FROM settings WHERE key = 'company_logo'").get() as
    { value: string } | undefined;
  if (!existingLogo?.value) {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('company_logo', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    ).run(logo);
  }
  linkDemoLogins();
  updateProductAttributes();
  seedExpenses(adminUserId(), jabulani);
  seedAttendance();
  seedBank(jabulani);
  seedQuotations(adminUserId());
  seedCreditNotes(adminUserId());
  if (jabulani) seedWorkshopJobs(adminUserId());
  console.log(`Demo extras ready for ${name}.`);
}

main();
closeDb();
