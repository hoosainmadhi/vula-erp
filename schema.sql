-- vula-erp — schema mirror. The single source of truth is src/db.ts (embedded
-- DDL executed at boot + in-place migrate() for older databases).
-- Keep this file in sync when the schema changes.
-- SQLite, WAL mode, foreign_keys ON. Money is INTEGER cents. Quantities are REAL.
-- Timestamps are UTC text `datetime('now')` (YYYY-MM-DD HH:MM:SS).
-- Reference data (permissions, roles, chart of accounts, journals, tax rates,
-- warehouses, leave types and settings) is seeded on first boot by src/db.ts.

CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Core: identity, access, settings, audit
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  module TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sequences (
  doc_type TEXT PRIMARY KEY,
  prefix TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number > 0)
);

CREATE TABLE modules (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Operations',
  is_core INTEGER NOT NULL DEFAULT 0 CHECK (is_core IN (0, 1)),
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  sort INTEGER NOT NULL DEFAULT 0,
  enabled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX ix_audit_created ON audit_log(created_at);

-- Partners: customers and suppliers share one table (AureusERP partners blueprint)
CREATE TABLE partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  is_customer INTEGER NOT NULL DEFAULT 0 CHECK (is_customer IN (0, 1)),
  is_supplier INTEGER NOT NULL DEFAULT 0 CHECK (is_supplier IN (0, 1)),
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  vat_number TEXT,
  registration_number TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  province TEXT,
  postal_code TEXT,
  country TEXT NOT NULL DEFAULT 'South Africa',
  credit_limit_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit_cents >= 0),
  payment_terms_days INTEGER NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (is_customer = 1 OR is_supplier = 1)
);

CREATE INDEX ix_partners_name ON partners(name);

-- Products & tax
CREATE TABLE product_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tax_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  rate_bp INTEGER NOT NULL CHECK (rate_bp >= 0 AND rate_bp <= 10000),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category_id INTEGER REFERENCES product_categories(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'goods' CHECK (type IN ('goods', 'service')),
  uom TEXT NOT NULL DEFAULT 'unit',
  sale_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (sale_price_cents >= 0),
  cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  tax_rate_id INTEGER REFERENCES tax_rates(id) ON DELETE SET NULL,
  track_inventory INTEGER NOT NULL DEFAULT 1 CHECK (track_inventory IN (0, 1)),
  reorder_level REAL NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_products_name ON products(name);
CREATE INDEX ix_products_category ON products(category_id);

-- Inventory: warehouses, locations, signed move ledger + current stock projection
CREATE TABLE warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE stock_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (warehouse_id, code)
);

CREATE TABLE stock_levels (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES stock_locations(id) ON DELETE CASCADE,
  quantity REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (product_id, location_id)
);

CREATE TABLE stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  location_id INTEGER NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
  quantity REAL NOT NULL CHECK (quantity <> 0),
  move_type TEXT NOT NULL CHECK (move_type IN ('opening', 'receipt', 'sale', 'adjustment', 'transfer', 'return')),
  reference_type TEXT,
  reference_id INTEGER,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_stock_moves_product ON stock_moves(product_id, created_at);
CREATE INDEX ix_stock_moves_reference ON stock_moves(reference_type, reference_id);

-- Purchases
CREATE TABLE purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'received', 'cancelled')),
  order_date TEXT NOT NULL,
  expected_date TEXT,
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX ix_purchase_orders_status ON purchase_orders(status);

CREATE TABLE purchase_order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  received_quantity REAL NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  tax_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bp >= 0),
  line_subtotal_cents INTEGER NOT NULL DEFAULT 0,
  line_tax_cents INTEGER NOT NULL DEFAULT 0,
  line_total_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE goods_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  received_date TEXT NOT NULL,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE goods_receipt_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goods_receipt_id INTEGER NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  purchase_order_line_id INTEGER NOT NULL REFERENCES purchase_order_lines(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  location_id INTEGER NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_cost_cents INTEGER NOT NULL DEFAULT 0
);

-- Sales
CREATE TABLE sales_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'fulfilled', 'invoiced', 'cancelled')),
  order_date TEXT NOT NULL,
  delivery_date TEXT,
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_sales_orders_customer ON sales_orders(customer_id);
CREATE INDEX ix_sales_orders_status ON sales_orders(status);

CREATE TABLE sales_order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sales_order_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  fulfilled_quantity REAL NOT NULL DEFAULT 0 CHECK (fulfilled_quantity >= 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  tax_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bp >= 0),
  line_subtotal_cents INTEGER NOT NULL DEFAULT 0,
  line_tax_cents INTEGER NOT NULL DEFAULT 0,
  line_total_cents INTEGER NOT NULL DEFAULT 0
);

-- Invoicing (customer invoices = sale, supplier bills = purchase)
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('sale', 'purchase')),
  partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  sales_order_id INTEGER REFERENCES sales_orders(id) ON DELETE SET NULL,
  purchase_order_id INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'paid', 'void')),
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  amount_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid_cents >= 0),
  notes TEXT,
  journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_invoices_partner ON invoices(partner_id);
CREATE INDEX ix_invoices_status ON invoices(status, direction);
CREATE INDEX ix_invoices_due ON invoices(due_date);

CREATE TABLE invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  tax_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bp >= 0),
  line_subtotal_cents INTEGER NOT NULL DEFAULT 0,
  line_tax_cents INTEGER NOT NULL DEFAULT 0,
  line_total_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  payment_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL DEFAULT 'eft' CHECK (method IN ('cash', 'bank', 'card', 'eft', 'other')),
  reference TEXT,
  notes TEXT,
  journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_payments_invoice ON payments(invoice_id);

-- Accounting: double-entry ledger
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE journals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('sale', 'purchase', 'bank', 'cash', 'general')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  journal_id INTEGER NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  entry_date TEXT NOT NULL,
  reference TEXT,
  description TEXT NOT NULL,
  source_type TEXT,
  source_id INTEGER,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft', 'posted', 'void')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  posted_at TEXT
);

CREATE INDEX ix_journal_entries_date ON journal_entries(entry_date);
CREATE UNIQUE INDEX ux_journal_source
  ON journal_entries(source_type, source_id) WHERE source_type IS NOT NULL;

CREATE TABLE journal_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL,
  description TEXT,
  debit_cents INTEGER NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
  credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  CHECK (debit_cents = 0 OR credit_cents = 0)
);

CREATE INDEX ix_journal_items_entry ON journal_items(journal_entry_id);
CREATE INDEX ix_journal_items_account ON journal_items(account_id);

-- HR
CREATE TABLE departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_number TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  id_number TEXT,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  job_title TEXT,
  employment_type TEXT NOT NULL DEFAULT 'permanent' CHECK (employment_type IN ('permanent', 'contract', 'part_time', 'intern')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_leave', 'terminated')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  salary_cents INTEGER NOT NULL DEFAULT 0 CHECK (salary_cents >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE leave_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  days_per_year REAL NOT NULL DEFAULT 0 CHECK (days_per_year >= 0),
  is_paid INTEGER NOT NULL DEFAULT 1 CHECK (is_paid IN (0, 1))
);

CREATE TABLE leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id INTEGER NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days REAL NOT NULL CHECK (days > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reason TEXT,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (end_date >= start_date)
);

CREATE INDEX ix_leave_employee ON leave_requests(employee_id);

-- Projects: plans, tasks and budgets
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'on_hold', 'completed', 'cancelled')),
  manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  start_date TEXT,
  end_date TEXT,
  budget_cents INTEGER NOT NULL DEFAULT 0 CHECK (budget_cents >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE project_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  assigned_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'blocked', 'done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_date TEXT,
  estimated_hours REAL NOT NULL DEFAULT 0 CHECK (estimated_hours >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_project_tasks_project ON project_tasks(project_id);

-- Timesheets: hours booked against an employee and optional project
CREATE TABLE timesheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  work_date TEXT NOT NULL,
  hours REAL NOT NULL CHECK (hours > 0 AND hours <= 24),
  task TEXT,
  notes TEXT,
  billable INTEGER NOT NULL DEFAULT 1 CHECK (billable IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_timesheets_employee_date ON timesheets(employee_id, work_date);
CREATE INDEX ix_timesheets_project ON timesheets(project_id);

-- Maintenance: equipment register and work requests
CREATE TABLE maintenance_equipment_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE maintenance_equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES maintenance_equipment_categories(id) ON DELETE SET NULL,
  partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL,
  location TEXT,
  model TEXT,
  serial_no TEXT,
  effective_date TEXT,
  warranty_date TEXT,
  scrap_date TEXT,
  cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  note TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_maintenance_equipment_name ON maintenance_equipment(name);

CREATE TABLE maintenance_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  equipment_id INTEGER NOT NULL REFERENCES maintenance_equipment(id) ON DELETE CASCADE,
  maintenance_type TEXT NOT NULL DEFAULT 'corrective' CHECK (maintenance_type IN ('preventive', 'corrective')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'in_progress', 'done', 'cancelled')),
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requested_at TEXT NOT NULL DEFAULT (date('now')),
  scheduled_at TEXT,
  closed_at TEXT,
  duration_hours REAL NOT NULL DEFAULT 0 CHECK (duration_hours >= 0),
  cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  description TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_maintenance_requests_status ON maintenance_requests(status);
CREATE INDEX ix_maintenance_requests_equipment ON maintenance_requests(equipment_id);

-- Recruitment: job openings, candidates and applications
CREATE TABLE recruitment_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0,
  is_hired INTEGER NOT NULL DEFAULT 0 CHECK (is_hired IN (0, 1))
);

CREATE TABLE recruitment_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  location TEXT,
  employment_type TEXT NOT NULL DEFAULT 'permanent' CHECK (employment_type IN ('permanent', 'contract', 'part_time', 'intern')),
  description TEXT,
  requirements TEXT,
  openings INTEGER NOT NULL DEFAULT 1 CHECK (openings >= 1),
  salary_min_cents INTEGER NOT NULL DEFAULT 0 CHECK (salary_min_cents >= 0),
  salary_max_cents INTEGER NOT NULL DEFAULT 0 CHECK (salary_max_cents >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'on_hold', 'closed')),
  recruiter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  posted_at TEXT,
  closes_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE recruitment_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  linkedin_profile TEXT,
  degree TEXT,
  source TEXT,
  availability_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_recruitment_candidates_name ON recruitment_candidates(name);

CREATE TABLE recruitment_applicants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES recruitment_jobs(id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL REFERENCES recruitment_candidates(id) ON DELETE CASCADE,
  stage_id INTEGER NOT NULL REFERENCES recruitment_stages(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hired', 'refused', 'withdrawn')),
  applied_at TEXT NOT NULL DEFAULT (date('now')),
  salary_expected_cents INTEGER NOT NULL DEFAULT 0 CHECK (salary_expected_cents >= 0),
  notes TEXT,
  refuse_reason TEXT,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (job_id, candidate_id)
);

CREATE INDEX ix_recruitment_applicants_job ON recruitment_applicants(job_id);
CREATE INDEX ix_recruitment_applicants_stage ON recruitment_applicants(stage_id);

-- Manufacturing: bills of materials, work centers, operations and production orders
CREATE TABLE manufacturing_work_centers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  cost_per_hour_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_per_hour_cents >= 0),
  capacity_per_day REAL NOT NULL DEFAULT 8 CHECK (capacity_per_day >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE manufacturing_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  work_center_id INTEGER REFERENCES manufacturing_work_centers(id) ON DELETE SET NULL,
  duration_minutes REAL NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE manufacturing_boms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity REAL NOT NULL DEFAULT 1 CHECK (quantity > 0),
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE manufacturing_bom_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bom_id INTEGER NOT NULL REFERENCES manufacturing_boms(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity REAL NOT NULL CHECK (quantity > 0),
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX ix_manufacturing_bom_lines_bom ON manufacturing_bom_lines(bom_id);
CREATE UNIQUE INDEX ux_manufacturing_bom_lines ON manufacturing_bom_lines(bom_id, product_id);

CREATE TABLE manufacturing_bom_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bom_id INTEGER NOT NULL REFERENCES manufacturing_boms(id) ON DELETE CASCADE,
  operation_id INTEGER NOT NULL REFERENCES manufacturing_operations(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL DEFAULT 1,
  UNIQUE (bom_id, operation_id)
);

CREATE INDEX ix_manufacturing_bom_operations_bom ON manufacturing_bom_operations(bom_id);

CREATE TABLE manufacturing_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  bom_id INTEGER REFERENCES manufacturing_boms(id) ON DELETE SET NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'in_progress', 'done', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  scheduled_date TEXT,
  started_at TEXT,
  finished_at TEXT,
  source_location_id INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL,
  destination_location_id INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  material_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (material_cost_cents >= 0),
  operation_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (operation_cost_cents >= 0),
  total_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cost_cents >= 0),
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_manufacturing_orders_status ON manufacturing_orders(status);
CREATE INDEX ix_manufacturing_orders_product ON manufacturing_orders(product_id);

CREATE TABLE manufacturing_order_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  required_quantity REAL NOT NULL CHECK (required_quantity > 0),
  consumed_quantity REAL NOT NULL DEFAULT 0 CHECK (consumed_quantity >= 0),
  unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0)
);

CREATE INDEX ix_manufacturing_order_components_order ON manufacturing_order_components(order_id);

CREATE TABLE manufacturing_order_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
  operation_id INTEGER REFERENCES manufacturing_operations(id) ON DELETE SET NULL,
  work_center_id INTEGER REFERENCES manufacturing_work_centers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done')),
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  started_at TEXT,
  finished_at TEXT,
  duration_minutes REAL NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
  notes TEXT
);

CREATE INDEX ix_manufacturing_order_operations_order ON manufacturing_order_operations(order_id);

-- Point of Sale: trade-counter registers, sessions and sales
CREATE TABLE pos_registers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE pos_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  register_id INTEGER NOT NULL REFERENCES pos_registers(id) ON DELETE CASCADE,
  opened_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  opening_float_cents INTEGER NOT NULL DEFAULT 0 CHECK (opening_float_cents >= 0),
  closed_at TEXT,
  closing_cash_cents INTEGER CHECK (closing_cash_cents >= 0),
  expected_cash_cents INTEGER NOT NULL DEFAULT 0,
  difference_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_pos_sessions_register ON pos_sessions(register_id, status);

CREATE TABLE pos_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  session_id INTEGER NOT NULL REFERENCES pos_sessions(id) ON DELETE CASCADE,
  register_id INTEGER NOT NULL REFERENCES pos_registers(id) ON DELETE RESTRICT,
  customer_id INTEGER REFERENCES partners(id) ON DELETE SET NULL,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'bank', 'card', 'eft', 'other')),
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  amount_tendered_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_tendered_cents >= 0),
  change_cents INTEGER NOT NULL DEFAULT 0 CHECK (change_cents >= 0),
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'void')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_pos_orders_session ON pos_orders(session_id);
CREATE INDEX ix_pos_orders_created ON pos_orders(created_at);

CREATE TABLE pos_order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES pos_orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  tax_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bp >= 0),
  line_subtotal_cents INTEGER NOT NULL DEFAULT 0,
  line_tax_cents INTEGER NOT NULL DEFAULT 0,
  line_total_cents INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX ix_pos_order_lines_order ON pos_order_lines(order_id);

CREATE TABLE pos_cash_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES pos_sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('in', 'out')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reason TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_pos_cash_movements_session ON pos_cash_movements(session_id);

-- Blogs: public posts, categories and tags
CREATE TABLE blog_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  meta_title TEXT,
  meta_description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE blog_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  excerpt TEXT,
  content TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES blog_categories(id) ON DELETE SET NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at TEXT,
  meta_title TEXT,
  meta_description TEXT,
  views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_blog_posts_status ON blog_posts(status, published_at);
CREATE INDEX ix_blog_posts_category ON blog_posts(category_id);

CREATE TABLE blog_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE blog_post_tags (
  post_id INTEGER NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES blog_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

-- Website: public pages and navigation menu
CREATE TABLE website_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  show_header INTEGER NOT NULL DEFAULT 1 CHECK (show_header IN (0, 1)),
  show_footer INTEGER NOT NULL DEFAULT 1 CHECK (show_footer IN (0, 1)),
  published_at TEXT,
  meta_title TEXT,
  meta_description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ix_website_pages_status ON website_pages(status, published_at);

CREATE TABLE website_menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  path TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  parent_id INTEGER REFERENCES website_menu_items(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
