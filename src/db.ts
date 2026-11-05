import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

export type Db = Database.Database;

export const SCHEMA = `
-- Core: identity, access, settings, audit
CREATE TABLE IF NOT EXISTS users (
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

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  module TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sequences (
  doc_type TEXT PRIMARY KEY,
  prefix TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number > 0)
);

-- Module registry: mirrors AureusERP's plugin manager. Core modules cannot be disabled.
CREATE TABLE IF NOT EXISTS modules (
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

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_log(created_at);

-- Partners: customers and suppliers share one table (AureusERP partners blueprint)
CREATE TABLE IF NOT EXISTS partners (
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

CREATE INDEX IF NOT EXISTS ix_partners_name ON partners(name);

-- Products & tax
CREATE TABLE IF NOT EXISTS product_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tax_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  rate_bp INTEGER NOT NULL CHECK (rate_bp >= 0 AND rate_bp <= 10000),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
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

CREATE INDEX IF NOT EXISTS ix_products_name ON products(name);
CREATE INDEX IF NOT EXISTS ix_products_category ON products(category_id);

-- Inventory: warehouses, locations, signed move ledger + current stock projection
CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (warehouse_id, code)
);

CREATE TABLE IF NOT EXISTS stock_levels (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES stock_locations(id) ON DELETE CASCADE,
  quantity REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (product_id, location_id)
);

CREATE TABLE IF NOT EXISTS stock_moves (
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

CREATE INDEX IF NOT EXISTS ix_stock_moves_product ON stock_moves(product_id, created_at);
CREATE INDEX IF NOT EXISTS ix_stock_moves_reference ON stock_moves(reference_type, reference_id);

-- Purchases
CREATE TABLE IF NOT EXISTS purchase_orders (
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

CREATE INDEX IF NOT EXISTS ix_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS ix_purchase_orders_status ON purchase_orders(status);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
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

CREATE TABLE IF NOT EXISTS goods_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  received_date TEXT NOT NULL,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS goods_receipt_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goods_receipt_id INTEGER NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  purchase_order_line_id INTEGER NOT NULL REFERENCES purchase_order_lines(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  location_id INTEGER NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_cost_cents INTEGER NOT NULL DEFAULT 0
);

-- Sales
CREATE TABLE IF NOT EXISTS sales_orders (
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

CREATE INDEX IF NOT EXISTS ix_sales_orders_customer ON sales_orders(customer_id);
CREATE INDEX IF NOT EXISTS ix_sales_orders_status ON sales_orders(status);

CREATE TABLE IF NOT EXISTS sales_order_lines (
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
CREATE TABLE IF NOT EXISTS invoices (
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

CREATE INDEX IF NOT EXISTS ix_invoices_partner ON invoices(partner_id);
CREATE INDEX IF NOT EXISTS ix_invoices_status ON invoices(status, direction);
CREATE INDEX IF NOT EXISTS ix_invoices_due ON invoices(due_date);

CREATE TABLE IF NOT EXISTS invoice_lines (
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

CREATE TABLE IF NOT EXISTS payments (
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

CREATE INDEX IF NOT EXISTS ix_payments_invoice ON payments(invoice_id);

-- Accounting: double-entry ledger
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS journals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('sale', 'purchase', 'bank', 'cash', 'general')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS journal_entries (
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

CREATE INDEX IF NOT EXISTS ix_journal_entries_date ON journal_entries(entry_date);
CREATE UNIQUE INDEX IF NOT EXISTS ux_journal_source
  ON journal_entries(source_type, source_id) WHERE source_type IS NOT NULL;

CREATE TABLE IF NOT EXISTS journal_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL,
  description TEXT,
  debit_cents INTEGER NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
  credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  CHECK (debit_cents = 0 OR credit_cents = 0)
);

CREATE INDEX IF NOT EXISTS ix_journal_items_entry ON journal_items(journal_entry_id);
CREATE INDEX IF NOT EXISTS ix_journal_items_account ON journal_items(account_id);

-- HR
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employees (
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

CREATE TABLE IF NOT EXISTS leave_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  days_per_year REAL NOT NULL DEFAULT 0 CHECK (days_per_year >= 0),
  is_paid INTEGER NOT NULL DEFAULT 1 CHECK (is_paid IN (0, 1))
);

CREATE TABLE IF NOT EXISTS leave_requests (
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

CREATE INDEX IF NOT EXISTS ix_leave_employee ON leave_requests(employee_id);

-- Projects: plans, tasks and budgets
CREATE TABLE IF NOT EXISTS projects (
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

CREATE TABLE IF NOT EXISTS project_tasks (
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

CREATE INDEX IF NOT EXISTS ix_project_tasks_project ON project_tasks(project_id);

-- Timesheets: hours booked against an employee and optional project
CREATE TABLE IF NOT EXISTS timesheets (
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

CREATE INDEX IF NOT EXISTS ix_timesheets_employee_date ON timesheets(employee_id, work_date);
CREATE INDEX IF NOT EXISTS ix_timesheets_project ON timesheets(project_id);

-- Maintenance: equipment register and work requests
CREATE TABLE IF NOT EXISTS maintenance_equipment_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS maintenance_equipment (
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

CREATE INDEX IF NOT EXISTS ix_maintenance_equipment_name ON maintenance_equipment(name);

CREATE TABLE IF NOT EXISTS maintenance_requests (
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

CREATE INDEX IF NOT EXISTS ix_maintenance_requests_status ON maintenance_requests(status);
CREATE INDEX IF NOT EXISTS ix_maintenance_requests_equipment ON maintenance_requests(equipment_id);

-- Recruitment: job openings, candidates and applications
CREATE TABLE IF NOT EXISTS recruitment_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0,
  is_hired INTEGER NOT NULL DEFAULT 0 CHECK (is_hired IN (0, 1))
);

CREATE TABLE IF NOT EXISTS recruitment_jobs (
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

CREATE TABLE IF NOT EXISTS recruitment_candidates (
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

CREATE INDEX IF NOT EXISTS ix_recruitment_candidates_name ON recruitment_candidates(name);

CREATE TABLE IF NOT EXISTS recruitment_applicants (
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

CREATE INDEX IF NOT EXISTS ix_recruitment_applicants_job ON recruitment_applicants(job_id);
CREATE INDEX IF NOT EXISTS ix_recruitment_applicants_stage ON recruitment_applicants(stage_id);

-- Manufacturing: bills of materials, work centers, operations and production orders
CREATE TABLE IF NOT EXISTS manufacturing_work_centers (
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

CREATE TABLE IF NOT EXISTS manufacturing_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  work_center_id INTEGER REFERENCES manufacturing_work_centers(id) ON DELETE SET NULL,
  duration_minutes REAL NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS manufacturing_boms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity REAL NOT NULL DEFAULT 1 CHECK (quantity > 0),
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS manufacturing_bom_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bom_id INTEGER NOT NULL REFERENCES manufacturing_boms(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity REAL NOT NULL CHECK (quantity > 0),
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ix_manufacturing_bom_lines_bom ON manufacturing_bom_lines(bom_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_manufacturing_bom_lines
  ON manufacturing_bom_lines(bom_id, product_id);

CREATE TABLE IF NOT EXISTS manufacturing_bom_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bom_id INTEGER NOT NULL REFERENCES manufacturing_boms(id) ON DELETE CASCADE,
  operation_id INTEGER NOT NULL REFERENCES manufacturing_operations(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL DEFAULT 1,
  UNIQUE (bom_id, operation_id)
);

CREATE INDEX IF NOT EXISTS ix_manufacturing_bom_operations_bom
  ON manufacturing_bom_operations(bom_id);

CREATE TABLE IF NOT EXISTS manufacturing_orders (
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

CREATE INDEX IF NOT EXISTS ix_manufacturing_orders_status ON manufacturing_orders(status);
CREATE INDEX IF NOT EXISTS ix_manufacturing_orders_product ON manufacturing_orders(product_id);

CREATE TABLE IF NOT EXISTS manufacturing_order_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  required_quantity REAL NOT NULL CHECK (required_quantity > 0),
  consumed_quantity REAL NOT NULL DEFAULT 0 CHECK (consumed_quantity >= 0),
  unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0)
);

CREATE INDEX IF NOT EXISTS ix_manufacturing_order_components_order
  ON manufacturing_order_components(order_id);

CREATE TABLE IF NOT EXISTS manufacturing_order_operations (
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

CREATE INDEX IF NOT EXISTS ix_manufacturing_order_operations_order
  ON manufacturing_order_operations(order_id);

-- Point of Sale: trade-counter registers, sessions and sales
CREATE TABLE IF NOT EXISTS pos_registers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pos_sessions (
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

CREATE INDEX IF NOT EXISTS ix_pos_sessions_register ON pos_sessions(register_id, status);

CREATE TABLE IF NOT EXISTS pos_orders (
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

CREATE INDEX IF NOT EXISTS ix_pos_orders_session ON pos_orders(session_id);
CREATE INDEX IF NOT EXISTS ix_pos_orders_created ON pos_orders(created_at);

CREATE TABLE IF NOT EXISTS pos_order_lines (
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

CREATE INDEX IF NOT EXISTS ix_pos_order_lines_order ON pos_order_lines(order_id);

CREATE TABLE IF NOT EXISTS pos_cash_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES pos_sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('in', 'out')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reason TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_pos_cash_movements_session ON pos_cash_movements(session_id);

-- Blogs: public posts, categories and tags
CREATE TABLE IF NOT EXISTS blog_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  meta_title TEXT,
  meta_description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blog_posts (
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

CREATE INDEX IF NOT EXISTS ix_blog_posts_status ON blog_posts(status, published_at);
CREATE INDEX IF NOT EXISTS ix_blog_posts_category ON blog_posts(category_id);

CREATE TABLE IF NOT EXISTS blog_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blog_post_tags (
  post_id INTEGER NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES blog_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

-- Website: public pages and navigation menu
CREATE TABLE IF NOT EXISTS website_pages (
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

CREATE INDEX IF NOT EXISTS ix_website_pages_status ON website_pages(status, published_at);

CREATE TABLE IF NOT EXISTS website_menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  path TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  parent_id INTEGER REFERENCES website_menu_items(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export const MIGRATIONS: readonly { version: number; name: string; run: (db: Db) => void }[] = [
  {
    version: 2,
    name: 'recruitment_applicants_employee_link',
    run: (db) => {
      const columns = db.prepare('PRAGMA table_info(recruitment_applicants)').all() as {
        name: string;
      }[];
      if (!columns.some((column) => column.name === 'employee_id')) {
        db.exec(
          'ALTER TABLE recruitment_applicants ADD COLUMN employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL',
        );
      }
    },
  },
];

let db: Db | null = null;

export function getDb(): Db {
  if (db) return db;

  if (config.dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });
  }

  const instance = new Database(config.dbPath);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  instance.exec(SCHEMA);
  runNumberedMigrations(instance);
  ensureReferenceData(instance);
  db = instance;
  return instance;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Test helper: drop the singleton without closing the underlying handle twice. */
export function resetDbForTests(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function runNumberedMigrations(instance: Db): number {
  instance.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = instance
    .prepare('SELECT MAX(version) AS version FROM schema_migrations')
    .get() as { version: number | null } | undefined;
  if (applied?.version == null) {
    instance.prepare("INSERT INTO schema_migrations (version, name) VALUES (1, 'baseline')").run();
  }

  let current =
    (
      instance.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
        version: number | null;
      }
    ).version ?? 1;

  for (const migration of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (migration.version <= current) continue;
    if (migration.version <= 1)
      throw new Error('Migration versions start at 2 (1 is the baseline)');
    instance.transaction(() => {
      migration.run(instance);
      instance
        .prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
        .run(migration.version, migration.name);
    })();
    current = migration.version;
  }

  instance.pragma(`user_version = ${current}`);
  return current;
}

export interface ModuleDefinition {
  key: string;
  name: string;
  description: string;
  category: string;
  isCore: boolean;
}

/** Module catalogue. Feature routers and navigation are gated by these keys. */
export const MODULES: readonly ModuleDefinition[] = [
  {
    key: 'dashboard',
    name: 'Dashboard',
    description: 'Company KPIs, low stock and recent activity',
    category: 'Core',
    isCore: true,
  },
  {
    key: 'partners',
    name: 'Partners',
    description: 'Customers and suppliers with statements',
    category: 'Trading',
    isCore: false,
  },
  {
    key: 'products',
    name: 'Products',
    description: 'Product catalogue, categories and tax rates',
    category: 'Trading',
    isCore: false,
  },
  {
    key: 'inventory',
    name: 'Inventory',
    description: 'Warehouses, locations, stock levels and adjustments',
    category: 'Trading',
    isCore: false,
  },
  {
    key: 'purchases',
    name: 'Purchases',
    description: 'Purchase orders, goods receipts and supplier bills',
    category: 'Trading',
    isCore: false,
  },
  {
    key: 'sales',
    name: 'Sales',
    description: 'Sales orders, fulfilment and customer invoicing',
    category: 'Trading',
    isCore: false,
  },
  {
    key: 'invoicing',
    name: 'Invoicing',
    description: 'Invoices, supplier bills and payments',
    category: 'Finance',
    isCore: false,
  },
  {
    key: 'pos',
    name: 'Point of Sale',
    description: 'Trade-counter register, sessions and cash-up',
    category: 'Trading',
    isCore: false,
  },
  {
    key: 'accounting',
    name: 'Accounting',
    description: 'Chart of accounts, journals, ledger and reports',
    category: 'Finance',
    isCore: false,
  },
  {
    key: 'hr',
    name: 'Human Resources',
    description: 'Employees and departments',
    category: 'People',
    isCore: false,
  },
  {
    key: 'time-off',
    name: 'Time Off',
    description: 'Leave requests, approvals and balances',
    category: 'People',
    isCore: false,
  },
  {
    key: 'timesheets',
    name: 'Timesheets',
    description: 'Employee work-hour tracking and approvals',
    category: 'People',
    isCore: false,
  },
  {
    key: 'projects',
    name: 'Projects',
    description: 'Project plans, tasks, budgets and progress',
    category: 'Operations',
    isCore: false,
  },
  {
    key: 'barcode',
    name: 'Barcode',
    description: 'Scan products, look up stock and print labels',
    category: 'Operations',
    isCore: false,
  },
  {
    key: 'maintenance',
    name: 'Maintenance',
    description: 'Equipment register and maintenance work requests',
    category: 'Operations',
    isCore: false,
  },
  {
    key: 'recruitment',
    name: 'Recruitment',
    description: 'Job openings, candidates and applications',
    category: 'People',
    isCore: false,
  },
  {
    key: 'manufacturing',
    name: 'Manufacturing',
    description: 'Bills of materials, work centers and production orders',
    category: 'Operations',
    isCore: false,
  },
  {
    key: 'blogs',
    name: 'Blogs',
    description: 'Public blog posts, categories and tags',
    category: 'Website',
    isCore: false,
  },
  {
    key: 'website',
    name: 'Website',
    description: 'Public pages and site navigation',
    category: 'Website',
    isCore: false,
  },
  {
    key: 'users',
    name: 'Users & Roles',
    description: 'User accounts, roles and the audit trail',
    category: 'Core',
    isCore: true,
  },
  {
    key: 'settings',
    name: 'Settings',
    description: 'Company profile, VAT and accounting defaults',
    category: 'Core',
    isCore: true,
  },
];

export const PERMISSIONS: readonly { key: string; module: string; description: string }[] = [
  { key: 'dashboard.view', module: 'core', description: 'View dashboard and reports' },
  { key: 'users.manage', module: 'core', description: 'Manage users and roles' },
  { key: 'settings.manage', module: 'core', description: 'Manage company settings' },
  { key: 'modules.manage', module: 'core', description: 'Enable and disable modules' },
  { key: 'partners.view', module: 'partners', description: 'View customers and suppliers' },
  {
    key: 'partners.manage',
    module: 'partners',
    description: 'Create and edit customers and suppliers',
  },
  { key: 'products.view', module: 'inventory', description: 'View products and stock' },
  { key: 'products.manage', module: 'inventory', description: 'Create and edit products' },
  { key: 'inventory.adjust', module: 'inventory', description: 'Adjust stock levels' },
  { key: 'purchases.view', module: 'purchases', description: 'View purchase orders' },
  {
    key: 'purchases.manage',
    module: 'purchases',
    description: 'Create and receive purchase orders',
  },
  { key: 'sales.view', module: 'sales', description: 'View sales orders' },
  { key: 'sales.manage', module: 'sales', description: 'Create and fulfil sales orders' },
  { key: 'invoices.view', module: 'invoicing', description: 'View invoices, bills and payments' },
  {
    key: 'invoices.manage',
    module: 'invoicing',
    description: 'Issue invoices and record payments',
  },
  { key: 'accounting.view', module: 'accounting', description: 'View ledger and trial balance' },
  { key: 'accounting.manage', module: 'accounting', description: 'Post journal entries' },
  { key: 'hr.view', module: 'hr', description: 'View employees and leave' },
  { key: 'hr.manage', module: 'hr', description: 'Manage employees and leave' },
  {
    key: 'leave.self',
    module: 'time-off',
    description: 'View and apply for your own leave',
  },
  { key: 'projects.view', module: 'projects', description: 'View projects and tasks' },
  { key: 'projects.manage', module: 'projects', description: 'Manage projects and tasks' },
  {
    key: 'maintenance.view',
    module: 'maintenance',
    description: 'View equipment and maintenance requests',
  },
  {
    key: 'maintenance.manage',
    module: 'maintenance',
    description: 'Manage equipment and maintenance requests',
  },
  {
    key: 'recruitment.view',
    module: 'recruitment',
    description: 'View jobs, candidates and applicants',
  },
  {
    key: 'recruitment.manage',
    module: 'recruitment',
    description: 'Manage jobs, candidates and applicants',
  },
  {
    key: 'manufacturing.view',
    module: 'manufacturing',
    description: 'View BOMs, work centers and production orders',
  },
  {
    key: 'manufacturing.manage',
    module: 'manufacturing',
    description: 'Manage BOMs, work centers and production orders',
  },
  { key: 'pos.view', module: 'pos', description: 'View registers, sessions and POS sales' },
  { key: 'pos.manage', module: 'pos', description: 'Open sessions, sell and cash up' },
  { key: 'blogs.view', module: 'blogs', description: 'View blog posts and categories' },
  { key: 'blogs.manage', module: 'blogs', description: 'Write, publish and delete blog content' },
  { key: 'website.view', module: 'website', description: 'View website pages and menu' },
  { key: 'website.manage', module: 'website', description: 'Manage website pages and menu' },
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: PERMISSIONS.map((p) => p.key),
  accountant: [
    'dashboard.view',
    'partners.view',
    'partners.manage',
    'products.view',
    'purchases.view',
    'sales.view',
    'invoices.view',
    'invoices.manage',
    'accounting.view',
    'accounting.manage',
    'projects.view',
  ],
  sales: [
    'dashboard.view',
    'partners.view',
    'partners.manage',
    'products.view',
    'sales.view',
    'sales.manage',
    'invoices.view',
    'projects.view',
    'projects.manage',
    'pos.view',
    'pos.manage',
  ],
  warehouse: [
    'dashboard.view',
    'partners.view',
    'products.view',
    'products.manage',
    'inventory.adjust',
    'purchases.view',
    'purchases.manage',
    'maintenance.view',
    'maintenance.manage',
    'manufacturing.view',
    'manufacturing.manage',
  ],
  hr: [
    'dashboard.view',
    'hr.view',
    'hr.manage',
    'projects.view',
    'recruitment.view',
    'recruitment.manage',
    'maintenance.view',
  ],
  employee: ['leave.self'],
  viewer: [
    'dashboard.view',
    'partners.view',
    'products.view',
    'purchases.view',
    'sales.view',
    'invoices.view',
    'accounting.view',
    'hr.view',
    'projects.view',
    'maintenance.view',
    'recruitment.view',
    'manufacturing.view',
    'pos.view',
    'blogs.view',
    'website.view',
  ],
};

const ACCOUNTS: readonly [string, string, string][] = [
  ['1000', 'Bank', 'asset'],
  ['1010', 'Cash', 'asset'],
  ['1100', 'Accounts Receivable', 'asset'],
  ['1200', 'Inventory', 'asset'],
  ['1300', 'VAT Input', 'asset'],
  ['1500', 'Equipment', 'asset'],
  ['2000', 'Accounts Payable', 'liability'],
  ['2100', 'VAT Output', 'liability'],
  ['3000', 'Owner’s Equity', 'equity'],
  ['4000', 'Sales Revenue', 'income'],
  ['4100', 'Other Income', 'income'],
  ['5000', 'Cost of Goods Sold', 'expense'],
  ['6000', 'Rent', 'expense'],
  ['6100', 'Salaries', 'expense'],
  ['6200', 'Utilities', 'expense'],
  ['6300', 'General Expenses', 'expense'],
];

const JOURNALS: readonly [string, string, string][] = [
  ['SAL', 'Sales', 'sale'],
  ['PUR', 'Purchases', 'purchase'],
  ['BNK', 'Bank', 'bank'],
  ['CSH', 'Cash', 'cash'],
  ['GEN', 'General', 'general'],
];

const SEQUENCES: readonly [string, string][] = [
  ['purchase_order', 'PO'],
  ['goods_receipt', 'GRN'],
  ['sales_order', 'SO'],
  ['sales_invoice', 'INV'],
  ['purchase_bill', 'BILL'],
  ['payment', 'PAY'],
  ['journal_entry', 'JE'],
  ['employee', 'EMP'],
  ['project', 'PRJ'],
  ['maintenance', 'MNT'],
  ['job', 'JOB'],
  ['manufacturing_order', 'MO'],
  ['pos_order', 'POS'],
];

export function ensureReferenceData(instance: Db): void {
  const insertRole = instance.prepare(
    'INSERT OR IGNORE INTO roles (name, description, is_system) VALUES (?, ?, 1)',
  );
  const roleDescriptions: Record<string, string> = {
    admin: 'Full access to every module',
    accountant: 'Invoicing, payments and the general ledger',
    sales: 'Customers, sales orders and invoices',
    warehouse: 'Products, stock and purchasing',
    hr: 'Employees and leave',
    employee: 'Self-service access for employees',
    viewer: 'Read-only access',
  };
  for (const [role, description] of Object.entries(roleDescriptions))
    insertRole.run(role, description);

  const insertPermission = instance.prepare(
    'INSERT OR IGNORE INTO permissions (key, module, description) VALUES (?, ?, ?)',
  );
  for (const permission of PERMISSIONS) {
    insertPermission.run(permission.key, permission.module, permission.description);
  }

  const roleId = instance.prepare('SELECT id FROM roles WHERE name = ?');
  const permId = instance.prepare('SELECT id FROM permissions WHERE key = ?');
  const link = instance.prepare(
    'INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
  );
  for (const [role, keys] of Object.entries(ROLE_PERMISSIONS)) {
    const roleRow = roleId.get(role) as { id: number } | undefined;
    if (!roleRow) continue;
    for (const key of keys) {
      const permRow = permId.get(key) as { id: number } | undefined;
      if (permRow) link.run(roleRow.id, permRow.id);
    }
  }

  const insertModule = instance.prepare(
    `INSERT INTO modules (key, name, description, category, is_core, is_enabled, sort)
     VALUES (?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       category = excluded.category,
       is_core = excluded.is_core,
       sort = excluded.sort,
       updated_at = datetime('now')`,
  );
  MODULES.forEach((module, index) =>
    insertModule.run(
      module.key,
      module.name,
      module.description,
      module.category,
      module.isCore ? 1 : 0,
      index + 1,
    ),
  );

  const insertAccount = instance.prepare(
    'INSERT OR IGNORE INTO accounts (code, name, type) VALUES (?, ?, ?)',
  );
  for (const [code, name, type] of ACCOUNTS) insertAccount.run(code, name, type);

  const insertJournal = instance.prepare(
    'INSERT OR IGNORE INTO journals (code, name, type) VALUES (?, ?, ?)',
  );
  for (const [code, name, type] of JOURNALS) insertJournal.run(code, name, type);

  const insertTax = instance.prepare(
    'INSERT OR IGNORE INTO tax_rates (name, rate_bp) VALUES (?, ?)',
  );
  insertTax.run('Standard VAT 15%', 1500);
  insertTax.run('Zero-rated', 0);

  const insertSequence = instance.prepare(
    'INSERT OR IGNORE INTO sequences (doc_type, prefix, next_number) VALUES (?, ?, 1)',
  );
  for (const [docType, prefix] of SEQUENCES) insertSequence.run(docType, prefix);

  // Demo data and older imports may have inserted employee numbers by hand. Keep the
  // sequence ahead of them so hiring never collides with an existing EMP- number.
  const employeeSequence = instance
    .prepare("SELECT next_number FROM sequences WHERE doc_type = 'employee'")
    .get() as { next_number: number } | undefined;
  if (employeeSequence) {
    const highest = instance
      .prepare(
        `SELECT MAX(CAST(SUBSTR(employee_number, 5) AS INTEGER)) AS max_number
         FROM employees WHERE employee_number LIKE 'EMP-%'`,
      )
      .get() as { max_number: number | null };
    const next = (highest.max_number ?? 0) + 1;
    if (next > employeeSequence.next_number) {
      instance
        .prepare("UPDATE sequences SET next_number = ? WHERE doc_type = 'employee'")
        .run(next);
    }
  }

  const insertSetting = instance.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
  );
  const defaults: Record<string, string> = {
    company_name: 'My Company (Pty) Ltd',
    company_registration: '',
    company_vat_number: '',
    company_email: '',
    company_phone: '',
    company_address: '',
    currency: 'ZAR',
    vat_rate_bp: '1500',
    invoice_due_days: '30',
    fiscal_year_start: '03-01',
    default_warehouse_id: '1',
    website_tagline: 'News and updates from our team',
  };
  for (const [key, value] of Object.entries(defaults)) insertSetting.run(key, value);

  const warehouse = instance.prepare('SELECT id FROM warehouses ORDER BY id LIMIT 1').get() as
    { id: number } | undefined;
  if (!warehouse) {
    const result = instance
      .prepare("INSERT INTO warehouses (code, name) VALUES ('MAIN', 'Main Warehouse')")
      .run();
    instance
      .prepare(
        "INSERT INTO stock_locations (warehouse_id, code, name, is_default) VALUES (?, 'STOCK', 'Stock', 1)",
      )
      .run(Number(result.lastInsertRowid));
  }

  const register = instance.prepare('SELECT id FROM pos_registers LIMIT 1').get();
  if (!register) {
    const location = instance
      .prepare('SELECT id, warehouse_id FROM stock_locations ORDER BY is_default DESC, id LIMIT 1')
      .get() as { id: number; warehouse_id: number } | undefined;
    if (location) {
      instance
        .prepare(
          `INSERT INTO pos_registers (name, code, warehouse_id, location_id)
           VALUES ('Main Register', 'MAIN', ?, ?)`,
        )
        .run(location.warehouse_id, location.id);
    }
  }

  const department = instance.prepare('SELECT id FROM departments LIMIT 1').get();
  if (!department) {
    instance.prepare("INSERT INTO departments (name) VALUES ('General')").run();
  }

  const leaveType = instance.prepare('SELECT id FROM leave_types LIMIT 1').get();
  if (!leaveType) {
    const insertLeave = instance.prepare(
      'INSERT INTO leave_types (name, days_per_year, is_paid) VALUES (?, ?, ?)',
    );
    insertLeave.run('Annual Leave', 21, 1);
    insertLeave.run('Sick Leave', 30, 1);
    insertLeave.run('Family Responsibility', 3, 1);
    insertLeave.run('Unpaid Leave', 0, 0);
  }

  const stage = instance.prepare('SELECT id FROM recruitment_stages LIMIT 1').get();
  if (!stage) {
    const insertStage = instance.prepare(
      'INSERT INTO recruitment_stages (name, sort, is_hired) VALUES (?, ?, ?)',
    );
    insertStage.run('New', 1, 0);
    insertStage.run('Screening', 2, 0);
    insertStage.run('Interview', 3, 0);
    insertStage.run('Offer', 4, 0);
    insertStage.run('Hired', 5, 1);
  }
}
