# vula-erp

A South African SME ERP built on the **za-pos stack**: an Express 4 + better-sqlite3 + TypeScript API with a React 19 + Vite + Tailwind v4 frontend, backed by **SQLite only**.

AureusERP (Laravel/PHP) was used as the **domain blueprint** for entity modelling and business flows; no PHP code runs here.

## First slice

- **Core** — JWT auth, users, roles + permission catalogue, company settings, audit trail
- **Trading** — customers/suppliers, products/categories/tax rates, warehouses and stock locations
- **Inventory** — signed stock-move ledger with a maintained `stock_levels` projection
- **Purchasing** — purchase orders, goods receipts, supplier bills
- **Sales** — sales orders, fulfilment, customer invoices, payments
- **Accounting** — chart of accounts, journals, double-entry posting, trial balance, P&L, balance sheet, VAT report
- **HR** — departments and employees
- **Time Off** — leave types, requests, approvals and yearly balances
- **Timesheets** — hours booked against employees and projects, with submit/approve workflow
- **Projects** — project plans, tasks, budgets and logged time
- **Barcode** — Code 39 scan-to-find and printable product labels
- **Maintenance** — equipment register, categories and preventive/corrective work requests
- **Recruitment** — job openings, candidates, application stages and hire-to-employee
- **Manufacturing** — bills of materials, work centers, operations and production orders
- **Point of Sale** — trade-counter register, sessions, cash sales and cash-up
- **Blogs** — public posts, categories and tags
- **Website** — public pages, site menu and a simple public site at `/site`
- **Plugins** — module registry with enable/disable, core-module protection and module-gated navigation/API

Single company per database (multi-company is deliberately deferred).

## Quick start

```bash
cp .env.sample .env          # then set a real JWT_SECRET
npm install
npm --prefix frontend install
npm run seed:demo            # creates the admin + demo trading data
npm run dev
```

| Service             | URL                   |
| ------------------- | --------------------- |
| API                 | http://localhost:3280 |
| Frontend (Vite dev) | http://localhost:3281 |

Demo credentials (change immediately):

```
admin@vula-erp.local
ChangeMe123!
```

The seed script is idempotent. `npm run seed` creates only the admin user; `npm run seed:demo` also adds demo partners, products, opening stock and an employee.

## Production build

```bash
npm run build
NODE_ENV=production npm start
```

`npm run build` compiles the API to `dist/` and builds the SPA to `frontend/dist/`. In production the API serves the SPA on port **3280**, so only one process is needed. `JWT_SECRET`, `DB_PATH` and a non-localhost `APP_URL` are required when `NODE_ENV=production`.

## Scripts

| Command             | Purpose                                      |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | API (`tsx watch`) + Vite dev server together |
| `npm run dev:api`   | API only, port 3280                          |
| `npm run dev:ui`    | Vite only, port 3281                         |
| `npm run build`     | Backend `tsc` + frontend production build    |
| `npm start`         | Run the compiled API                         |
| `npm run typecheck` | TypeScript check (backend)                   |
| `npm test`          | Jest + Supertest (in-memory SQLite)          |
| `npm run seed`      | Bootstrap the admin user                     |
| `npm run seed:demo` | Admin + demo data                            |
| `npm run format`    | Prettier                                     |

## Configuration

Environment variables are read in `src/config.ts` (see `.env.sample`):

| Variable         | Default                 | Notes                                                       |
| ---------------- | ----------------------- | ----------------------------------------------------------- |
| `NODE_ENV`       | `development`           | Production enables strict env checks and static SPA serving |
| `PORT`           | `3280`                  | API port                                                    |
| `DB_PATH`        | `data/vula-erp.db`      | SQLite file; `:memory:` in tests                            |
| `JWT_SECRET`     | dev placeholder         | Must be strong in production                                |
| `JWT_EXPIRES_IN` | `7d`                    | Token lifetime                                              |
| `LOG_LEVEL`      | `info`                  | `debug`, `info`, `warn`, `error`                            |
| `TRUST_PROXY`    | `0`                     | Express trust-proxy value                                   |
| `APP_URL`        | `http://localhost:3280` | Used for absolute links / env validation                    |
| `DEMO_MODE`      | `false`                 | Optional demo flag                                          |

Company profile, VAT rate, invoice due days, fiscal year start and default warehouse live in the `settings` table and are edited from **Settings** in the UI.

## Modules (plugins)

Modules are listed on the **Plugins** page (admin only). The catalogue lives in `MODULES` in
`src/db.ts` and is stored in the `modules` table.

- Core modules — Dashboard, Users & Roles, Settings — are always enabled and cannot be disabled.
- Trading/Finance/People modules can be enabled or disabled without deleting data.
- Disabling a module hides its navigation, redirects its frontend routes and returns
  `403 module_disabled` from its API routers (`requireModule()` in `src/middleware/auth.ts`).
- Re-enabling a module restores everything; no data is lost.
- Enabling or disabling writes to `audit_log`.

## Business rules

- **Money is always integer cents** (`*_cents`). Quantities are `REAL`.
- **Document prices are VAT-exclusive**; VAT is computed per line from the line's basis-point rate (`1500` = 15%) and added to the total.
- **Document numbers** come from the `sequences` table (`PO-00001`, `GRN-00001`, `SO-00001`, `INV-00001`, `BILL-00001`, `PAY-00001`, `JE-00001`, `PRJ-00001`, `MNT-00001`, `JOB-00001`, `EMP-00001`, …), allocated inside transactions.
- **Posted accounting entries are immutable.** Draft invoices can be deleted; posted invoices are voided with a reversing journal entry.
- **Stock is a signed move ledger.** Receipts are positive, sales/issues negative, and `stock_levels` is updated in the same transaction. Overselling is rejected.
- **Double entry is enforced:** every journal entry must have at least two lines and debits must equal credits.
- **RBAC:** every route is guarded by `requirePermission('module.action')`; roles are seeded (`admin`, `accountant`, `sales`, `warehouse`, `hr`, `viewer`).
- **Audit trail:** mutating operations write to `audit_log`.

### Core flows

1. **Purchase to bill** — create PO (draft) → confirm → receive goods into a location (stock in) → create supplier bill from the PO (`POST /api/invoices/from-purchase-order/:id`), which posts to the ledger.
2. **Sale to cash** — create sales order (draft) → confirm → fulfil from a location (stock out; oversell guard) → raise invoice from the order (`POST /api/sales-orders/:id/invoice`) → record payment (`POST /api/invoices/payments`), which posts cash/bank against receivables or payables.
3. **Ledger posting** — sales invoices debit receivables and credit revenue + VAT output; purchase bills debit inventory/expense + VAT input and credit payables; payments post against cash/bank.

## Project layout

```
server.ts                 API entrypoint (assertEnv → getDb → createApp → listen)
src/
  app.ts                  Express app, security headers, health, static SPA
  config.ts               Environment configuration and production checks
  db.ts                   Schema DDL, migrations, reference-data seeding
  routes/                 One file per resource; barrel at routes/index.ts
  middleware/auth.ts      JWT authenticate + requirePermission
  services/               sequences, audit, stock, invoices, accounting
  utils/                  money, dates, validation, errors, http, logger
  test/                   Jest setup + integration tests
scripts/seed.ts           Admin bootstrap and demo data
schema.sql                Human-readable mirror of the schema in src/db.ts
frontend/
  src/api.ts              fetch wrapper with JWT + 401 handling
  src/auth.tsx            AuthProvider/useAuth
  src/modules.tsx         ModulesProvider/useModules (module gating)
  src/components/         Layout, UI primitives, shared LineItemsEditor
  src/pages/              One page per module, lazy-loaded and permission-gated
  src/types.ts            Shared entity types
```

## API overview

All endpoints are under `/api` and require `Authorization: Bearer <token>` except `/api/auth/login` and `/api/health`.

| Area          | Endpoints                                                                                                                                                                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth          | `POST /auth/login`, `GET /auth/me`, `POST /auth/change-password`                                                                                                                                                                                                     |
| Users / roles | `/users`, `/roles` (CRUD), `GET /audit`                                                                                                                                                                                                                              |
| Settings      | `GET /settings`, `PUT /settings`                                                                                                                                                                                                                                     |
| Modules       | `GET /modules`, `POST /modules/:key/enable`, `POST /modules/:key/disable`                                                                                                                                                                                            |
| Dashboard     | `GET /dashboard`                                                                                                                                                                                                                                                     |
| Partners      | `/partners` CRUD, `GET /partners/:id/statement`                                                                                                                                                                                                                      |
| Products      | `/products` CRUD, `/product-categories` CRUD, `/tax-rates` CRUD                                                                                                                                                                                                      |
| Inventory     | `/inventory/warehouses` CRUD, `/inventory/locations/:id`, `GET /inventory/stock`, `GET /inventory/stock/moves`, `POST /inventory/stock/adjust`                                                                                                                       |
| Purchases     | `/purchase-orders` CRUD, `POST /:id/confirm`, `/cancel`, `/receive`, `GET /goods-receipts`                                                                                                                                                                           |
| Sales         | `/sales-orders` CRUD, `POST /:id/confirm`, `/cancel`, `/fulfil`, `/invoice`                                                                                                                                                                                          |
| Invoices      | `/invoices` CRUD/draft, `POST /:id/post`, `POST /:id/void`, `POST /from-purchase-order/:id`, `/payments`                                                                                                                                                             |
| Accounting    | `/accounting/accounts` CRUD, `/journals`, `/journal-entries`, `/reports/{trial-balance,profit-and-loss,balance-sheet,ledger/:id,vat}`                                                                                                                                |
| HR            | `/employees` CRUD, `/departments` CRUD                                                                                                                                                                                                                               |
| Time Off      | `/leave/types`, `/leave/employees`, `/leave/requests` CRUD, `POST /leave/requests/:id/approve` / `reject` / `cancel`, `GET /leave/summary`                                                                                                                           |
| Timesheets    | `/timesheets` CRUD, `/timesheets/employees`, `/timesheets/projects`, `POST /timesheets/:id/submit` / `approve` / `reject`, `GET /summary`                                                                                                                            |
| Projects      | `/projects` CRUD, `/projects/:id/tasks` CRUD, `/projects/employees`                                                                                                                                                                                                  |
| Barcode       | `GET /barcode/lookup?code=…`, `GET /barcode/labels?q=…`                                                                                                                                                                                                              |
| Maintenance   | `/maintenance/categories` CRUD, `/maintenance/equipment` CRUD, `/maintenance/requests` CRUD, `POST /requests/:id/status`, `GET /requests/summary`, `GET /technicians`                                                                                                |
| Recruitment   | `/recruitment/jobs` CRUD, `/recruitment/candidates` CRUD, `/recruitment/applicants` CRUD, `POST /applicants/:id/hire`, `GET /stages`, `GET /options`                                                                                                                 |
| Manufacturing | `/manufacturing/boms` CRUD, `/manufacturing/work-centers` CRUD, `/manufacturing/operations` CRUD, `/manufacturing/orders` CRUD, `POST /orders/:id/confirm` / `start` / `complete` / `cancel`, `POST /orders/:id/operations/:opId/start` / `complete`, `GET /summary` |
| Point of Sale | `/pos/registers` CRUD, `/pos/sessions` + `POST /sessions/:id/close`, `/pos/orders` + `GET /orders/:id`, `/pos/products`, `/pos/customers`, `/pos/summary`                                                                                                            |
| Blogs         | `/blogs/posts` CRUD, `/blogs/categories` CRUD, `/blogs/tags` CRUD; public `/public/blogs/posts`, `/public/blogs/posts/:slug`, `/public/blogs/categories`, `/public/blogs/tags`                                                                                       |
| Website       | `/website/pages` CRUD, `/website/menu` CRUD; public `/public/website/site`, `/public/website/pages/:slug`, `/public/website/menu`                                                                                                                                    |

Responses use a singular resource envelope, e.g. `{ "products": [...] }`, `{ "invoice": {...}, "payments": [...] }`, `{ "ok": true }`. Errors are `{ "error": "message" }` with an appropriate status code.

## Data model

`schema.sql` is a readable mirror; `src/db.ts` is the source of truth.

- **Core:** `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `settings`, `sequences`, `modules`, `audit_log`, `schema_migrations`
- **Trading:** `partners`, `product_categories`, `tax_rates`, `products`
- **Inventory:** `warehouses`, `stock_locations`, `stock_levels`, `stock_moves`
- **Purchasing:** `purchase_orders`, `purchase_order_lines`, `goods_receipts`, `goods_receipt_lines`
- **Sales:** `sales_orders`, `sales_order_lines`
- **Invoicing:** `invoices`, `invoice_lines`, `payments`
- **Accounting:** `accounts`, `journals`, `journal_entries`, `journal_items`
- **HR:** `departments`, `employees`, `leave_types`, `leave_requests`
- **Time Off:** `leave_types`, `leave_requests` (Time Off owns them; HR owns employees/departments)
- **Timesheets:** `timesheets`
- **Projects:** `projects`, `project_tasks`
- **Maintenance:** `maintenance_equipment_categories`, `maintenance_equipment`, `maintenance_requests`
- **Recruitment:** `recruitment_stages`, `recruitment_jobs`, `recruitment_candidates`, `recruitment_applicants`
- **Manufacturing:** `manufacturing_boms`, `manufacturing_bom_lines`, `manufacturing_bom_operations`, `manufacturing_work_centers`, `manufacturing_operations`, `manufacturing_orders`, `manufacturing_order_components`, `manufacturing_order_operations`
- **Point of Sale:** `pos_registers`, `pos_sessions`, `pos_orders`, `pos_order_lines`, `pos_cash_movements`
- **Blogs:** `blog_posts`, `blog_categories`, `blog_tags`, `blog_post_tags`
- **Website:** `website_pages`, `website_menu_items`

## Testing

```bash
npm test
```

Tests run against `DB_PATH=:memory:` and cover auth/RBAC, the module registry, the end-to-end purchase → receive → bill and sale → fulfil → invoice → payment flow, the Wave 1 modules (projects, timesheets, time off, barcode), the Wave 2 modules (maintenance, recruitment including hire-to-employee), the Wave 3 modules (manufacturing BOM → production order → stock, and POS sale → invoice/payment/cash-up) and the Wave 4 modules (blogs and website public routes). Jest needs `NODE_OPTIONS=--experimental-vm-modules`; the `npm test` script already sets it.

## Limitations / next steps

- Single company and single currency per database.
- No credit notes yet (void reverses the whole invoice), no partial payment allocation across invoices beyond explicit invoice links.
- Stock valuation is a simple moving cost; no FIFO/lot tracking.
- No PDF rendering, email delivery or bank statement import.
- Payroll is out of scope for this slice (employees, time off and timesheets only).
- Barcode labels use Code 39 only; no symbology switching or hardware scanner integration beyond keyboard-wedge input.
- Maintenance tracks requests and costs but does not post them to the ledger or schedule recurring services.
- Recruitment covers the pipeline and hire-to-employee; there is no emailing, interview scheduling or offer-letter generation.
- Manufacturing covers BOMs, work centers, operations and production orders; it does not include MRP, capacity planning, OEE, lot tracking, splits or backorders.
- Point of Sale is a trade-counter register (sessions, cash/card/EFT, cash-up), not a full retail POS. Offline trading, lay-bys, multi-store and device leases stay in `za-pos`.
- Blogs and Website use a simple plain-text/markdown-style content editor. The public site is client-rendered (`/site`, `/blog`), so SEO is limited; server-rendered public pages are a future enhancement.
- Multi-company, approvals/workflow and attachments are natural follow-ups.
