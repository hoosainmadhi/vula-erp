# Findings

## za-pos conventions to mirror (read from `~/apps/za-pos`)

- Root `server.ts` boots: `assertEnv()` → `getDb()` → `createApp()` → listen; SIGTERM/SIGINT graceful close.
- `src/app.ts`: security headers, `/health` + `/api/health` with `SELECT 1`, `express.json`, `/api` router, static SPA, `notFoundHandler`/`errorHandler`.
- `src/config.ts`: plain exported object, defaults, `envProblems()` / `assertEnv()` fail-fast.
- `src/db.ts`: lazy singleton, WAL + FK pragmas, giant `SCHEMA` DDL string, probe-based `migrate()`, numbered `MIGRATIONS` + `schema_migrations`, mirror `schema.sql`.
- Response envelope: `{ categories: rows }`, `{ category: row }`, `{ ok: true }`, errors `{ error, code? }`.
- Routes: one file per resource, `export const xRouter = Router()`, REST, `asyncHandler`, hand-rolled validators in `utils/validate.ts`.
- Auth: JWT bearer, bcrypt, `authenticate`, role gates, `rateLimit`.
- Money: integer cents; dates: SQLite UTC text; IDs: INTEGER PK AUTOINCREMENT.
- Tests: jest + ts-jest ESM + supertest, `src/test/setup.ts` env, `freshDb()`/`seedUser`/`authHeader`.
- Frontend: relative `/api` + Vite proxy, `api.ts` fetch wrapper, `AuthProvider`, React Router, Tailwind v4 CSS-first, `ui.tsx` primitives.

## AureusERP domain model (blueprint summary)

- **Partners**: `partners_partners` with account_type, sub_type, name, tax_id, phone, email, parent_id, addresses, bank accounts, industry, title.
- **Products**: `products_products` (type, name, reference/sku, barcode, price, cost, weight, volume, uom, category, enable_sales/enable_purchase), categories, tags, attributes, packagings, price lists, product suppliers.
- **Inventory**: warehouses, locations, operation types, lots, product quantities (qty, reserved), moves + move lines, packages, scraps, order points, routes/rules.
- **Purchases**: order groups, requisitions + lines, orders + lines + line taxes, `purchases_order_operations`, receive against PO.
- **Sales**: teams, order templates, orders + lines + line taxes, delivery status, order-to-invoice links, advance payments.
- **Accounts**: accounts (chart), journals, account moves (journal entries) + move lines (debit/credit, balance, residual), taxes + partition lines, payment terms, payment registers, partial/full reconciles, bank statements, fiscal positions.
- **Payments**: payment methods, tokens, transactions; links to account payments.
- **Employees/HR**: departments, work locations, job positions, employment types, skills, calendars (attendance/leave), employee resumes, departure reasons.
- **Security**: users, teams, roles/permissions (Filament Shield), invitations, MFA columns.

## Porting notes

- AureusERP uses `decimal(15,4)` money → we use integer cents.
- It uses polymorphic/multi-company FKs (`company_id`) everywhere → v1 single company via settings.
- MySQL/Postgres JSON columns and `jsonb` → SQLite TEXT/JSON where needed (we avoid for v1).
- Filament resources/policies → our REST routes + permission middleware.
- Odoo-style double entry: `account_move` = journal entry, `account_move_line` = debit/credit line.
- Purchase receipt = inventory operation + moves; sale delivery = moves; invoice separate.
