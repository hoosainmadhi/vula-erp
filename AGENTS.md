# AGENTS.md — working in vula-erp

Guidance for AI coding agents. Read this before changing code.

## What this is

A South African SME ERP built fresh on the **za-pos stack**:

- Backend: Express 4 + better-sqlite3 + TypeScript (ESM, `NodeNext`), port **3280**
- Frontend: React 19 + Vite + Tailwind v4 + React Router, dev port **3281**
- Database: **SQLite only** (`data/vula-erp.db`)
- `../za-pos` is read-only reference. **Never modify `~/apps/za-pos`.**
- AureusERP is only a domain blueprint; do not port PHP code.

## Commands

```bash
npm run dev                 # API + UI together
npm run dev:api             # API only
npm run dev:ui              # UI only
npm run build               # backend tsc + frontend build
npm run typecheck           # backend typecheck (npx tsc --noEmit)
npm --prefix frontend run typecheck
npm test                    # jest (needs --experimental-vm-modules; script sets it)
npm run seed:demo           # admin + demo data (idempotent)
npm start                   # compiled API; NODE_ENV=production serves frontend/dist
```

There is no linter; Prettier is the formatter (`npm run format`). Keep the existing style: single quotes, trailing commas, 2-space indent, ~100 col width.

## Architecture map

- `server.ts` — boot order: `assertEnv()` → `getDb()` → `createApp()` → listen; graceful shutdown.
- `src/app.ts` — security headers, `/health` + `/api/health`, JSON body, `/api` router, production SPA fallback, error handlers.
- `src/config.ts` — all env access. Production requires `JWT_SECRET`, `DB_PATH`, non-localhost `APP_URL`.
- `src/db.ts` — **source of truth for the schema**, reference-data seeding (modules, permissions, roles, chart of accounts, journals, tax rates, warehouse/location, leave types, settings) and numbered migrations. Mirror schema changes into `schema.sql`.
- `src/routes/` — one file per resource, exported `xRouter`, mounted in `src/routes/index.ts`. Every route uses `asyncHandler` and `requirePermission`.
- `src/middleware/auth.ts` — `authenticate`, `requirePermission`, `requireModule`, rate limiting on login.
- `src/services/` — cross-cutting domain logic:
  - `sequences.ts` — document numbers (`PO-`, `GRN-`, `SO-`, `INV-`, `BILL-`, `PAY-`, `JE-`, `PRJ-`)
  - `accounting.ts` — journal posting, invoice/payment journals, reports, reversal
  - `invoices.ts` — invoice creation, posting, payments, draft delete
  - POS checkout composes `createInvoice`, `recordPayment` and `recordMove` inside one transaction so the sale, ledger and stock stay consistent.
  - `stock.ts` — stock moves, PO receiving, sales fulfilment, oversell guard
  - `audit.ts` — audit log writes
- `src/utils/` — `money.ts`, `dates.ts`, `validate.ts`, `http.ts`, `errors.ts`, `logger.ts`.
- `frontend/src/api.ts` — fetch wrapper: `/api` prefix, bearer token, 401 handling.
- `frontend/src/lib/useFetch.ts` — GET hook with `reload()`; pass a `null` path to skip fetching.
- `frontend/src/modules.tsx` — `ModulesProvider`/`useModules`; fetches `/modules`, exposes `isEnabled(key)` and `reload()`.
- `frontend/src/components/LineItemsEditor.tsx` — shared draft-line editor for POs, sales orders and invoices (`priceKind: 'cost' | 'price'`).
- `frontend/src/components/Barcode.tsx` + `src/lib/barcode.ts` — dependency-free Code 39 encoder and SVG label renderer.
- `frontend/src/pages/` — lazy-loaded module pages. Add new pages to `App.tsx` with a `Guard permission="..." module="..."`.
- `frontend/src/components/PublicLayout.tsx` + `BlogListPage`/`BlogPostPage`/`PublicSitePage` — public, unauthenticated site at `/site` and `/blog`. They render outside the admin `Layout`; public API routes live under `/api/public/*` and must not use `authenticate`.
- `frontend/src/pages/PluginsPage.tsx` — module/plugin manager (admin only).
- `frontend/src/types.ts` — shared entity shapes; update when the API shape changes.

## Routes and permissions

Every non-auth route is permission-gated. Permission catalogue lives in `PERMISSIONS` in `src/db.ts`; roles are seeded from `ROLE_PERMISSIONS`. Current keys:

```
dashboard.view
users.manage
settings.manage
modules.manage
partners.view | partners.manage
products.view | products.manage | inventory.adjust
purchases.view | purchases.manage
sales.view | sales.manage
invoices.view | invoices.manage
accounting.view | accounting.manage
hr.view | hr.manage
projects.view | projects.manage
maintenance.view | maintenance.manage
recruitment.view | recruitment.manage
manufacturing.view | manufacturing.manage
pos.view | pos.manage
blogs.view | blogs.manage
website.view | website.manage
```

Add a permission in `src/db.ts`, grant it to roles, then use `requirePermission('...')`. The frontend checks with `can('...')`; hide actions the user cannot perform.

Module gating is separate from permissions. The catalogue lives in `MODULES` (`src/db.ts`) and
seeds the `modules` table; routers are mounted with `requireModule('<key>')`, which returns
`403 module_disabled` when the module is off. Core modules (`dashboard`, `users`, `settings`)
cannot be disabled. When adding a feature module, add it to `MODULES`, gate its routers, add the
`module` field to the nav item, and pass `module="<key>"` to the route `Guard`.

Current optional modules: `partners`, `products`, `inventory`, `purchases`, `sales`, `invoicing`,
`pos`, `accounting`, `hr`, `time-off`, `timesheets`, `projects`, `barcode`, `maintenance`,
`recruitment`, `manufacturing`, `blogs`, `website`. Feature routers that need people data
(`/leave/employees`, `/timesheets/employees`, `/projects/employees`,
`/maintenance/technicians`, `/recruitment/options`) expose their own option endpoint so they
keep working when the `hr` module is disabled.

## Invariants — do not break

1. **Money is integer cents** in `*_cents` columns and API payloads. Quantities are `REAL`.
2. **Document prices are VAT-exclusive.** Tax is computed per line from `tax_rate_bp` (basis points; `1500` = 15%) via `utils/money.ts`.
3. **Balanced double entry.** `postJournalEntry` rejects fewer than two items and unequal debits/credits. Never write `journal_items` directly.
4. **Posted documents are immutable.** Invoices: delete only `draft`; void an `open` invoice with `POST /invoices/:id/void`, which posts a reversing entry. POs/SOs cannot be edited after `draft`.
5. **Stock and ledger writes happen in one transaction.** Stock changes go through `services/stock.ts` (`recordMove`, `receivePurchaseOrder`, `fulfilSalesOrder`, `adjustStock`), which keeps `stock_levels` in sync.
6. **Sequence allocation is transactional** (`nextNumber`). Do not hand-roll document numbers.
7. **Single company, single currency.** Company profile lives in `settings`; there is no `company_id` column yet.
8. **`schema.sql` is a mirror.** Update it whenever `src/db.ts` changes.
9. **API response envelope:** keyed objects, e.g. `{ product }`, `{ products, total }`, `{ ok: true }`. Errors: `{ error }` via `utils/errors.ts` helpers.
10. **Core modules stay enabled.** Never allow `dashboard`, `users` or `settings` to be disabled; `POST /modules/:key/disable` rejects core modules.

## Adding a feature — checklist

1. Schema: edit `SCHEMA` in `src/db.ts`; if the change must apply to existing DBs, add a numbered migration to `MIGRATIONS` (versions start at 2). Mirror `schema.sql`.
2. Seed any new reference data in `ensureReferenceData`.
3. Service logic in `src/services/` when it touches money, stock, accounting or sequences.
4. Route in `src/routes/`, register in `src/routes/index.ts`, add permission checks.
5. Frontend types in `types.ts`, page in `frontend/src/pages/`, lazy route in `App.tsx`, nav item in `components/Layout.tsx`.
6. Tests: add to `src/routes/*.test.ts` using `src/test/helpers.ts`; run `npm test` and both typechecks.
7. Update README/AGENTS when behaviour or setup changes.

## Testing

- Jest + Supertest, ESM (ts-jest). Setup in `src/test/setup.ts` forces `DB_PATH=:memory:`, fixed `JWT_SECRET`, `LOG_LEVEL=error`.
- `npm test` must always pass. Existing coverage: auth/RBAC, the module registry, the purchase→receive→bill and sale→fulfil→invoice→payment integration flow, and the Wave 1/2/3/4 feature modules (projects, timesheets, time off, barcode, maintenance, recruitment, manufacturing, point of sale, blogs, website).
- Prefer integration tests through the API over unit tests of internals.

## Known gotchas

- `better-sqlite3` is synchronous; keep transactions small and avoid nesting. Allocate sequence numbers and insert the row they belong to inside the same transaction.
- Dates are stored as SQLite UTC text (`YYYY-MM-DD`). Use helpers in `utils/dates.ts` / `lib/format.ts`.
- Vite proxies `/api` to `http://localhost:3280`; the dev UI is at `3281`. Ports 3240/3241 are used by other local apps — do not change to them.
- Cloudflare/Vite/Tailwind major versions are new; keep config minimal and verify with a real build after changing dependencies.
- The SPA is only served by Express when `NODE_ENV=production` and `frontend/dist` exists.
- Running `npm run seed` twice is safe; it reports the existing admin instead of duplicating.
- The API health response is `{ status, uptime }` (not `{ ok: true }`).
