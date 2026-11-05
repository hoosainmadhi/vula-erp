export interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
}

export interface Partner {
  id: number;
  name: string;
  is_customer: number;
  is_supplier: number;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  vat_number: string | null;
  registration_number: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  country: string;
  credit_limit_cents: number;
  payment_terms_days: number;
  is_active: number;
  notes: string | null;
  receivable_cents: number;
  payable_cents: number;
}

export interface Category {
  id: number;
  name: string;
  description: string | null;
  product_count?: number;
}

export interface TaxRate {
  id: number;
  name: string;
  rate_bp: number;
  is_active: number;
}

export interface Product {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  category_id: number | null;
  category_name: string | null;
  type: 'goods' | 'service';
  uom: string;
  sale_price_cents: number;
  cost_cents: number;
  tax_rate_id: number | null;
  tax_rate_bp: number | null;
  tax_rate_name: string | null;
  track_inventory: number;
  reorder_level: number;
  is_active: number;
  stock_quantity: number;
}

export interface Warehouse {
  id: number;
  code: string;
  name: string;
  address: string | null;
  is_active: number;
  locations?: StockLocation[];
}

export interface StockLocation {
  id: number;
  warehouse_id: number;
  code: string;
  name: string;
  is_default: number;
}

export interface StockRow {
  id: number;
  sku: string;
  name: string;
  uom: string;
  reorder_level: number;
  cost_cents: number;
  sale_price_cents: number;
  category_name: string | null;
  quantity: number;
  value_cents: number;
}

export interface StockMove {
  id: number;
  product_id: number;
  sku: string;
  product_name: string;
  quantity: number;
  move_type: string;
  reference_type: string | null;
  reference_id: number | null;
  note: string | null;
  created_at: string;
  location_name: string;
  warehouse_name: string;
  user_email: string | null;
}

export interface OrderLine {
  id: number;
  product_id: number | null;
  description: string;
  quantity: number;
  unit_cost_cents?: number;
  unit_price_cents?: number;
  tax_rate_bp: number;
  line_subtotal_cents: number;
  line_tax_cents: number;
  line_total_cents: number;
  received_quantity?: number;
  fulfilled_quantity?: number;
}

export interface PurchaseOrder {
  id: number;
  number: string;
  supplier_id: number;
  supplier_name: string;
  status: 'draft' | 'confirmed' | 'received' | 'cancelled';
  order_date: string;
  expected_date: string | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  notes: string | null;
  line_count?: number;
  lines?: OrderLine[];
  receipts?: GoodsReceipt[];
}

export interface GoodsReceipt {
  id: number;
  number: string;
  purchase_order_id: number;
  received_date: string;
  notes: string | null;
  created_at: string;
}

export interface SalesOrder {
  id: number;
  number: string;
  customer_id: number;
  customer_name: string;
  status: 'draft' | 'confirmed' | 'fulfilled' | 'invoiced' | 'cancelled';
  order_date: string;
  delivery_date: string | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  notes: string | null;
  line_count?: number;
  payment_terms_days?: number;
  lines?: OrderLine[];
  invoices?: {
    id: number;
    number: string;
    status: string;
    total_cents: number;
    amount_paid_cents: number;
  }[];
}

export interface InvoiceLine {
  id: number;
  product_id: number | null;
  description: string;
  quantity: number;
  unit_price_cents: number;
  tax_rate_bp: number;
  line_subtotal_cents: number;
  line_tax_cents: number;
  line_total_cents: number;
}

export interface Invoice {
  id: number;
  number: string;
  direction: 'sale' | 'purchase';
  partner_id: number;
  partner_name: string;
  status: 'draft' | 'open' | 'paid' | 'void';
  issue_date: string;
  due_date: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  amount_paid_cents: number;
  outstanding_cents?: number;
  overdue?: number;
  notes: string | null;
  journal_entry_id: number | null;
  lines?: InvoiceLine[];
}

export interface Payment {
  id: number;
  number: string;
  direction: 'in' | 'out';
  partner_id: number;
  partner_name?: string;
  invoice_id: number | null;
  invoice_number?: string | null;
  payment_date: string;
  amount_cents: number;
  method: string;
  reference: string | null;
  notes: string | null;
}

export interface Account {
  id: number;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  description: string | null;
  is_active: number;
  entry_count?: number;
}

export interface Journal {
  id: number;
  code: string;
  name: string;
  type: string;
}

export interface JournalEntry {
  id: number;
  number: string;
  journal_id: number;
  journal_code: string;
  journal_name: string;
  entry_date: string;
  reference: string | null;
  description: string;
  source_type: string | null;
  source_id: number | null;
  status: string;
  total_cents: number;
}

export interface JournalItem {
  id: number;
  account_id: number;
  account_code: string;
  account_name: string;
  partner_id: number | null;
  partner_name: string | null;
  description: string | null;
  debit_cents: number;
  credit_cents: number;
}

export interface TrialBalanceRow {
  code: string;
  name: string;
  type: string;
  debit_cents: number;
  credit_cents: number;
  balanceCents: number;
}

export interface ProfitAndLoss {
  from: string;
  to: string;
  lines: { code: string; name: string; type: string; amountCents: number }[];
  incomeCents: number;
  expenseCents: number;
  netProfitCents: number;
}

export interface BalanceSheet {
  asOf: string;
  assets: { code: string; name: string; amountCents: number }[];
  liabilities: { code: string; name: string; amountCents: number }[];
  equity: { code: string; name: string; amountCents: number }[];
  assetTotalCents: number;
  liabilityTotalCents: number;
  equityTotalCents: number;
  retainedEarningsCents: number;
}

export interface LedgerLine {
  journal_entry_id: number;
  number: string;
  entry_date: string;
  description: string;
  reference: string | null;
  debit_cents: number;
  credit_cents: number;
  line_description: string | null;
  balanceCents: number;
}

export interface Employee {
  id: number;
  employee_number: string;
  user_id: number | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  id_number: string | null;
  department_id: number | null;
  department_name: string | null;
  job_title: string | null;
  employment_type: string;
  status: string;
  start_date: string;
  end_date: string | null;
  salary_cents: number;
  notes: string | null;
}

export interface Department {
  id: number;
  name: string;
  description: string | null;
  employee_count?: number;
}

export interface LeaveType {
  id: number;
  name: string;
  days_per_year: number;
  is_paid: number;
}

export interface LeaveRequest {
  id: number;
  employee_id: number;
  employee_name: string;
  employee_number: string;
  leave_type_id: number;
  leave_type_name: string;
  start_date: string;
  end_date: string;
  days: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reason: string | null;
}

export interface Role {
  id: number;
  name: string;
  description: string | null;
  is_system: number;
  permissions: string[];
}

export interface LeaveBalance {
  employee_id: number;
  employee_number: string;
  employee_name: string;
  leave_type_id: number;
  leave_type_name: string;
  days_per_year: number;
  approved_days: number;
  pending_days: number;
}

export interface EmployeeOption {
  id: number;
  employee_number: string;
  first_name: string;
  last_name: string;
  status: string;
}

export interface Project {
  id: number;
  code: string;
  name: string;
  description: string | null;
  status: 'planned' | 'active' | 'on_hold' | 'completed' | 'cancelled';
  manager_id: number | null;
  manager_name: string | null;
  start_date: string | null;
  end_date: string | null;
  budget_cents: number;
  task_count: number;
  done_task_count: number;
  logged_hours: number;
}

export interface ProjectTask {
  id: number;
  project_id: number;
  title: string;
  description: string | null;
  assigned_employee_id: number | null;
  assignee_name: string | null;
  status: 'todo' | 'in_progress' | 'blocked' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  due_date: string | null;
  estimated_hours: number;
}

export interface Timesheet {
  id: number;
  employee_id: number;
  employee_name: string;
  employee_number: string;
  project_id: number | null;
  project_code: string | null;
  project_name: string | null;
  work_date: string;
  hours: number;
  task: string | null;
  notes: string | null;
  billable: number;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
}

export interface TimesheetSummary {
  employee_id: number;
  employee_number: string;
  employee_name: string;
  total_hours: number;
  billable_hours: number;
  entries: number;
}

export interface BarcodeLocation {
  warehouse_id: number;
  warehouse_code: string;
  warehouse_name: string;
  location_id: number;
  location_code: string;
  location_name: string;
  quantity: number;
}

export interface BarcodeProduct {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  uom: string;
  sale_price_cents: number;
  cost_cents: number;
  track_inventory: number;
  is_active: number;
  reorder_level: number;
  category_name: string | null;
  stock_quantity: number;
}

export interface Permission {
  id: number;
  key: string;
  module: string;
  description: string;
}

export interface AuditEntry {
  id: number;
  action: string;
  entity: string;
  entity_id: number | null;
  details: string | null;
  created_at: string;
  user_email: string | null;
  user_name: string | null;
}

export interface Module {
  key: string;
  name: string;
  description: string;
  category: string;
  isCore: boolean;
  enabled: boolean;
  enabledAt: string | null;
  sort: number;
}

export interface Dashboard {
  asOf: string;
  kpis: {
    salesThisMonthCents: number;
    purchasesThisMonthCents: number;
    receivablesCents: number;
    payablesCents: number;
    cashAndBankCents: number;
    openPurchaseOrders: number;
    openSalesOrders: number;
    productCount: number;
    partnerCount: number;
    employeeCount: number;
  };
  lowStock: { id: number; sku: string; name: string; reorder_level: number; quantity: number }[];
  recentInvoices: (Invoice & { partner_name: string })[];
  salesByMonth: { month: string; totalCents: number }[];
  topProducts: { name: string; total_cents: number; quantity: number }[];
}

export interface MaintenanceCategory {
  id: number;
  name: string;
  note: string | null;
  equipment_count?: number;
}

export interface MaintenanceEquipment {
  id: number;
  name: string;
  category_id: number | null;
  category_name: string | null;
  partner_id: number | null;
  vendor_name: string | null;
  location: string | null;
  model: string | null;
  serial_no: string | null;
  effective_date: string | null;
  warranty_date: string | null;
  scrap_date: string | null;
  cost_cents: number;
  note: string | null;
  is_active: number;
  request_count: number;
  open_request_count: number;
}

export interface MaintenanceRequest {
  id: number;
  number: string;
  subject: string;
  equipment_id: number;
  equipment_name: string;
  serial_no: string | null;
  maintenance_type: 'preventive' | 'corrective';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'scheduled' | 'in_progress' | 'done' | 'cancelled';
  assigned_to: number | null;
  assignee_name: string | null;
  requested_at: string;
  scheduled_at: string | null;
  closed_at: string | null;
  duration_hours: number;
  cost_cents: number;
  description: string | null;
  resolution: string | null;
}

export interface Technician {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}

export interface RecruitmentStage {
  id: number;
  name: string;
  sort: number;
  is_hired: number;
}

export interface RecruitmentJob {
  id: number;
  number: string;
  title: string;
  department_id: number | null;
  department_name: string | null;
  location: string | null;
  employment_type: string;
  description: string | null;
  requirements: string | null;
  openings: number;
  salary_min_cents: number;
  salary_max_cents: number;
  status: 'draft' | 'open' | 'on_hold' | 'closed';
  recruiter_id: number | null;
  recruiter_name: string | null;
  posted_at: string | null;
  closes_at: string | null;
  applicant_count: number;
  hired_count: number;
}

export interface RecruitmentCandidate {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  linkedin_profile: string | null;
  degree: string | null;
  source: string | null;
  availability_date: string | null;
  notes: string | null;
  application_count?: number;
}

export interface RecruitmentApplicant {
  id: number;
  job_id: number;
  job_number: string;
  job_title: string;
  candidate_id: number;
  candidate_name: string;
  candidate_email: string | null;
  candidate_phone: string | null;
  stage_id: number;
  stage_name: string;
  is_hired: number;
  status: 'active' | 'hired' | 'refused' | 'withdrawn';
  applied_at: string;
  salary_expected_cents: number;
  notes: string | null;
  refuse_reason: string | null;
  employee_id: number | null;
  hired_employee_number: string | null;
  closed_at: string | null;
}

export interface ManufacturingWorkCenter {
  id: number;
  name: string;
  code: string;
  cost_per_hour_cents: number;
  capacity_per_day: number;
  is_active: number;
  notes: string | null;
  operation_count?: number;
}

export interface ManufacturingOperation {
  id: number;
  name: string;
  work_center_id: number | null;
  work_center_name: string | null;
  cost_per_hour_cents: number | null;
  duration_minutes: number;
  notes: string | null;
}

export interface ManufacturingBomLine {
  id: number;
  bom_id: number;
  product_id: number;
  product_sku: string;
  product_name: string;
  quantity: number;
  cost_cents: number;
  uom: string;
}

export interface ManufacturingBomOperation {
  id: number;
  bom_id: number;
  operation_id: number;
  operation_name: string;
  sequence: number;
  duration_minutes: number;
  work_center_name: string | null;
  cost_per_hour_cents: number | null;
}

export interface ManufacturingBom {
  id: number;
  code: string;
  product_id: number;
  product_sku: string;
  product_name: string;
  quantity: number;
  notes: string | null;
  is_active: number;
  line_count: number;
  operation_count: number;
  lines?: ManufacturingBomLine[];
  operations?: ManufacturingBomOperation[];
}

export interface ManufacturingOrderComponent {
  id: number;
  order_id: number;
  product_id: number;
  product_sku: string;
  product_name: string;
  required_quantity: number;
  consumed_quantity: number;
  unit_cost_cents: number;
  available_quantity: number;
}

export interface ManufacturingOrderOperation {
  id: number;
  order_id: number;
  operation_id: number | null;
  work_center_id: number | null;
  work_center_name: string | null;
  cost_per_hour_cents: number | null;
  name: string;
  sequence: number;
  status: 'pending' | 'in_progress' | 'done';
  assigned_to: number | null;
  started_at: string | null;
  finished_at: string | null;
  duration_minutes: number;
  notes: string | null;
}

export interface ManufacturingOrder {
  id: number;
  number: string;
  product_id: number;
  product_sku: string;
  product_name: string;
  bom_id: number | null;
  bom_code: string | null;
  quantity: number;
  status: 'draft' | 'confirmed' | 'in_progress' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  scheduled_date: string | null;
  started_at: string | null;
  finished_at: string | null;
  source_location_id: number | null;
  source_location_code: string | null;
  destination_location_id: number | null;
  destination_location_code: string | null;
  assigned_to: number | null;
  assignee_name: string | null;
  material_cost_cents: number;
  operation_cost_cents: number;
  total_cost_cents: number;
  notes: string | null;
  components?: ManufacturingOrderComponent[];
  operations?: ManufacturingOrderOperation[];
}

export interface PosRegister {
  id: number;
  name: string;
  code: string;
  warehouse_id: number | null;
  warehouse_name: string | null;
  location_id: number | null;
  location_code: string | null;
  location_name: string | null;
  is_active: number;
  open_session_id: number | null;
}

export interface PosSession {
  id: number;
  register_id: number;
  register_name: string;
  register_code: string;
  opened_by: number | null;
  cashier_name: string | null;
  opened_at: string;
  opening_float_cents: number;
  closed_at: string | null;
  closing_cash_cents: number | null;
  expected_cash_cents: number;
  live_expected_cash_cents?: number;
  difference_cents: number;
  status: 'open' | 'closed';
  order_count?: number;
  sales_cents?: number;
  notes: string | null;
}

export interface PosProduct {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  type: 'goods' | 'service';
  uom: string;
  sale_price_cents: number;
  cost_cents: number;
  track_inventory: number;
  tax_rate_bp: number;
  stock_quantity: number;
}

export interface PosCustomer {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  credit_limit_cents: number;
}

export interface PosOrderLine {
  id: number;
  order_id: number;
  product_id: number | null;
  description: string;
  quantity: number;
  unit_price_cents: number;
  tax_rate_bp: number;
  line_subtotal_cents: number;
  line_tax_cents: number;
  line_total_cents: number;
}

export interface PosOrder {
  id: number;
  number: string;
  session_id: number;
  register_id: number;
  register_name: string;
  register_code: string;
  customer_id: number | null;
  customer_name: string | null;
  invoice_id: number | null;
  invoice_number: string | null;
  payment_id: number | null;
  payment_number: string | null;
  payment_method: 'cash' | 'bank' | 'card' | 'eft' | 'other';
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  amount_tendered_cents: number;
  change_cents: number;
  status: 'paid' | 'void';
  cashier_name: string | null;
  created_at: string;
  lines?: PosOrderLine[];
}

export interface BlogCategory {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  meta_title: string | null;
  meta_description: string | null;
  post_count?: number;
}

export interface BlogTag {
  id: number;
  name: string;
  slug: string;
  post_count?: number;
}

export interface BlogPost {
  id: number;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  category_id: number | null;
  category_name: string | null;
  category_slug: string | null;
  author_id: number | null;
  author_name: string | null;
  status: 'draft' | 'published';
  published_at: string | null;
  meta_title: string | null;
  meta_description: string | null;
  views: number;
  tag_names?: string | null;
  tags?: BlogTag[];
}

export interface WebsitePage {
  id: number;
  title: string;
  slug: string;
  content: string;
  status: 'draft' | 'published';
  show_header: number;
  show_footer: number;
  published_at: string | null;
  meta_title: string | null;
  meta_description: string | null;
}

export interface WebsiteMenuItem {
  id: number;
  label: string;
  path: string;
  sort: number;
  is_active: number;
  parent_id: number | null;
}

export interface PublicSite {
  site: {
    companyName: string;
    tagline: string;
    email: string;
    phone: string;
    address: string;
  };
  menu: WebsiteMenuItem[];
  pages: { id: number; title: string; slug: string; published_at: string | null }[];
}
