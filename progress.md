# Progress log

## 2026-11-03 — session 1

- Studied `~/apps/za-pos`: Express 4 + better-sqlite3 + TS backend, React 19 + Vite + Tailwind v4 frontend, JWT auth, integer-cent money, bean-style route barrels (`/api`), `{ resource }` response envelope.
- Cloned AureusERP to `/tmp/opencode/aureuserp` and extracted the module/entity map for partners, products, inventories, purchases, sales, accounts, employees, security.
- Confirmed stack conflict (Laravel/PHP vs Node/TS). User chose a fresh build with AureusERP as blueprint.
- Created planning files.

Next: scaffold the backend.

## 2026-11-03 — session 2

- Completed the backend: schema/seed, auth + RBAC, services (sequences, audit, stock, invoices, accounting) and all REST modules.
- `npx tsc --noEmit` and `npm test` pass (2 suites, 7 tests).
- Seeded demo data and smoke-tested `/health`, login, dashboard and products.
- Built the full frontend: sidebar shell, auth, dashboard, partners, products, inventory, purchase orders, sales orders, invoices/payments, accounting, employees, users/roles/audit and settings.
- Added the shared `LineItemsEditor` used by purchase, sales and invoice forms.
- `npm --prefix frontend run build` passes (tsc + Vite).
- Added `schema.sql` mirror (generated from `src/db.ts`) and `README.md` + `AGENTS.md`.
- Fixed `config.ts` default `APP_URL` to port 3280.

Next: end-to-end smoke test of API + frontend; record follow-ups (credit notes, PDFs, multi-company).

## 2026-11-03 — session 3

- Renamed the application from `za-erp` to **vula-erp** across package names, lockfiles,
  server log, UI title/logo, login helper text, localStorage keys, JWT default, DB path,
  tests and docs. The repository folder stays at `~/apps/vula-erp`.
- Migrated the demo database `data/za-erp.db` → `data/vula-erp.db` and updated the admin
  (`admin@vula-erp.local`) and demo employee (`thandi@vula-erp.local`) emails.
- `npm run typecheck`, frontend typecheck, `npm test` (7 tests) and `npm run build` pass after
  the rename.
- Phase 10 complete; remaining scope is documented follow-ups.

## 2026-11-03 — session 4

- Moved the Node/TS ERP to `~/apps/vula-erp` (the original `~/apps/za-erp` copy remains untouched).
- Added an AureusERP-style **module registry**: `modules` table, `MODULES` catalogue,
  `modules.manage` permission, `GET /modules`, enable/disable endpoints, audit logging and
  core-module protection.
- Feature routers are gated with `requireModule()`; disabled modules return
  `403 module_disabled`.
- Frontend: `ModulesProvider`, module-aware `Guard`, nav filtered by enabled modules, and a new
  **Plugins** page to enable/disable modules.
- Added integration tests for the module API (11 tests total pass), updated `schema.sql`,
  README and AGENTS.md.
- AureusERP is running separately for comparison at `http://localhost:8000/admin`.

## 2026-11-03 — session 5 (Wave 1 parity modules)

- Compared plugin catalogues: AureusERP shows **17 Apps + 3 Extra**; vula-erp covered 10 of those
  (Products, Accounts and Payments are AureusERP "Extra" tabs already mapped to products /
  accounting / invoicing), leaving **10 missing apps**.
- User chose **all 10, in waves**. Wave 1 delivered four:
  - **Time Off** — leave types, requests and approvals moved out of the HR module; new
    `/leave/types`, `/leave/employees`, `/leave/requests`, `/leave/summary` API and a Time Off
    page with Requests/Balances tabs.
  - **Timesheets** — `timesheets` table, draft → submitted → approved/rejected workflow, weekly
    and per-employee summaries, and a Timesheets page.
  - **Projects** — `projects` + `project_tasks`, `PRJ-` sequence, budgets, assignees and logged
    hours, plus a Projects page with a task detail modal.
  - **Barcode** — scan lookup by barcode or SKU with stock-by-location, and printable Code 39
    labels using a dependency-free encoder (`src/lib/barcode.ts`).
- Added module entries, `projects.view` / `projects.manage` permissions, role grants, `PRJ-`
  sequence, and mirrored all schema changes into `schema.sql`.
- Module seeding now upserts catalogue metadata so renamed descriptions and sort order reach
  existing databases without touching `is_enabled`.
- Added `src/routes/wave1.test.ts` (8 tests). Full suite: **19 tests pass**; both typechecks and
  `npm run build` pass.
- Verified in the browser: nav lists Barcode, Time Off, Timesheets and Projects; live data created
  through the API renders on each page; disabling `projects` hides it and returns
  `403 module_disabled` while `timesheets` stays available.
- Plugins page now shows **15 modules** (3 core + 12 optional), all enabled.

Next: Wave 2 — Maintenance and Recruitment.

## 2026-11-03 — session 6 (Wave 2 parity modules)

- Delivered the second wave of AureusERP parity modules:
  - **Maintenance** — equipment categories, an equipment register (model, serial, location,
    warranty, cost, in-service flag) and preventive/corrective work requests with
    pending → scheduled → in progress → done/cancelled statuses, technician assignment,
    duration/cost capture and a request summary. New `MNT-` sequence.
  - **Recruitment** — job openings (`JOB-` sequence), reusable candidates, application stages
    (New, Screening, Interview, Offer, Hired), stage moves, refusals and a hire action that
    creates the `EMP-` employee record and links it back to the application.
- Schema added for seven tables and mirrored into `schema.sql`; migration 2 adds
  `recruitment_applicants.employee_id` for existing databases.
- Added `maintenance.*` / `recruitment.*` permissions, role grants, two module registry entries
  and option endpoints (`/maintenance/technicians`, `/recruitment/options`) so both modules work
  with the HR module disabled.
- Frontend: `MaintenancePage` (Requests / Equipment / Categories) and `RecruitmentPage`
  (Jobs / Candidates / Applications) with modals, filters and hire flow; routed in `App.tsx`
  and added to the sidebar.
- Added `src/routes/wave2.test.ts` (9 tests). Full suite: **28 tests pass**; backend and frontend
  typechecks and `npm run build` pass.
- Browser smoke test caught a real bug: the demo seed hand-wrote `EMP-00001`, so the first hire
  collided on the unique employee number and left a half-applied hire. Fixed by allocating the
  demo employee number through `nextNumber`, reconciling the employee sequence at startup, and
  wrapping the hire update + employee insert in one transaction. Re-verified hire end-to-end
  (candidate → `EMP-00002`) and the maintenance schedule action in the UI.
- Plugins page now shows **17 modules** (3 core + 14 optional), all enabled.

Next: Wave 3 — Manufacturing and Point of Sale.

## 2026-11-03 — session 7 (Wave 3 parity modules)

- Delivered the third wave:
  - **Manufacturing** — work centers, operations, bills of materials, and production orders with
    draft → confirmed → in progress → done/cancelled. Completing an order consumes components,
    produces finished goods through the stock ledger, and records material, operation and total
    cost. `MO-` sequence.
  - **Point of Sale** — trade-counter registers, sessions, cash/card/EFT sales and cash-up.
    Checkout creates the sales invoice, payment and stock issue in one transaction, so the POS
    does not maintain a second ledger. `POS-` sequence.
- Added schema for 13 tables (manufacturing + POS), mirrored into `schema.sql`, plus module
  entries, `manufacturing.*` / `pos.*` permissions, role grants and a seeded Main Register.
- Frontend: `ManufacturingPage` (Orders / BOMs / Work Centers / Operations) and `PosPage`
  (Register / Sessions), routed and added to the sidebar.
- Added `src/routes/wave3.test.ts` (6 tests). Full suite: **34 tests pass**; backend and frontend
  typechecks and `npm run build` pass.
- Browser smoke test: created a BOM and production order, ran it through confirm → start →
  operation complete → order complete, and verified component consumption and finished-goods
  receipt; opened a POS session, made a cash sale, and cashed up.
- Fixed a cash-up bug found in the smoke test: open sessions showed R0 expected cash because the
  stored value is only written on close. The sessions API now returns
  `live_expected_cash_cents` for open sessions and the UI uses it.
- Plugins page now shows **19 modules** (3 core + 16 optional), all enabled.

Next: Wave 4 — Blogs and Website, the last AureusERP parity apps.

## 2026-11-03 — session 8 (Wave 4 parity modules)

- Delivered the final AureusERP parity wave:
  - **Blogs** — public posts, categories and tags with draft/publish, slugs, excerpts, meta
    fields, view counts and public list/detail routes.
  - **Website** — public pages and navigation menu with draft/publish, header/footer toggles,
    meta fields and a public site at `/site` (page detail at `/site/:slug`).
- Added schema for six tables, mirrored into `schema.sql`, plus `blogs` / `website` module
  entries, `blogs.*` / `website.*` permissions and role grants.
- Frontend: `BlogsPage` (Posts / Categories / Tags) and `WebsitePage` (Pages / Menu), plus a
  public `PublicLayout` with `BlogListPage`, `BlogPostPage` and `PublicSitePage`. Public routes
  render outside the admin layout and do not require authentication.
- Added `src/routes/wave4.test.ts` (6 tests). Full suite: **40 tests pass**; backend and frontend
  typechecks and `npm run build` pass.
- Browser smoke test: published a post and page through the API, then verified `/site`, `/blog`,
  `/blog/:slug`, `/blogs` and `/website`, including the public menu, latest-post cards and view
  counter.
- Plugins page now shows **21 modules** (3 core + 18 optional), all enabled — AureusERP parity
  complete.

Next: Jabulani/ZNS follow-ups (product variants, workshop job cards, project costing, attendance,
bank reconciliation/expenses, Odoo import).
