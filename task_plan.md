# vula-erp — build plan

## Goal

A South African SME ERP on the **za-pos stack** (Express 4 + better-sqlite3 + TypeScript API,
React 19 + Vite + Tailwind v4 frontend, **SQLite only**), with AureusERP
(https://github.com/aureuserp/aureuserp) used as the **domain blueprint** — not as code.

Scope of first slice (user-selected): core auth/RBAC/settings, inventory + products,
purchases + suppliers, sales + customers + invoicing, accounting/ledger, HR/employees.

Hard constraint: **do not touch `~/apps/za-pos`**. All work happens in `~/apps/vula-erp`.

## Decisions

| #   | Decision                                                                                      | Rationale                                                       |
| --- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | Fresh Node/TS build, AureusERP only as schema/flow reference                                  | AureusERP is Laravel/PHP; user wants the za-pos stack           |
| 2   | SQLite via better-sqlite3, WAL, FK on, one file per deployment                                | User requirement + za-pos convention                            |
| 3   | Money = integer cents (`*_cents`); quantities = REAL                                          | za-pos money rule; ERP stock needs decimals                     |
| 4   | Prices are **VAT-exclusive** on purchase/sales lines (VAT added)                              | Standard ERP/Odoo/AureusERP behaviour, unlike POS gross pricing |
| 5   | Document numbers via `sequences` table (`PO-00001`, `INV-00001`, …)                           | AureusERP sequence behaviour, safe inside transactions          |
| 6   | RBAC = roles + permissions tables (seeded), `requirePermission()` middleware                  | Wider module surface than za-pos's 3 fixed roles                |
| 7   | Single company per database (company profile in `settings`)                                   | Keeps v1 tractable; multi-company can add `company_id` later    |
| 8   | Double-entry ledger: `journal_entries` + `journal_items`, auto-posted from invoices/payments  | AureusERP accounts plugin blueprint                             |
| 9   | Posted documents cannot be edited/deleted; invoices are voided with a reversing entry         | Auditability invariant                                          |
| 10  | Stock is a signed move ledger + maintained `stock_levels` projection, both in one transaction | Fast reads, auditable history                                   |

## Phases

| #   | Phase                                                                      | Status   |
| --- | -------------------------------------------------------------------------- | -------- |
| 0   | Research za-pos conventions + AureusERP domain model                       | complete |
| 1   | Scaffold backend (package, tsconfig, config, db, app, utils, middleware)   | complete |
| 2   | Core schema + auth/RBAC/settings/users                                     | complete |
| 3   | Partners, products, inventory (warehouses, locations, stock moves)         | complete |
| 4   | Purchases (POs, goods receipts)                                            | complete |
| 5   | Sales (orders) + invoices + payments                                       | complete |
| 6   | Accounting (chart, journals, auto-posting, reports)                        | complete |
| 7   | HR (departments, employees, leave)                                         | complete |
| 8   | Backend integration tests + seed script + schema.sql mirror                | complete |
| 9   | Frontend shell, auth, dashboard + module pages                             | complete |
| 10  | Docs, vula-erp rename, typecheck, build, smoke test                        | complete |
| 11  | Move to ~/apps/vula-erp + AureusERP-style module registry and Plugins page | complete |
| 12  | Wave 1 parity modules: Time Off, Timesheets, Projects, Barcode             | complete |
| 13  | Wave 2 parity modules: Maintenance, Recruitment                            | complete |
| 14  | Wave 3 parity modules: Manufacturing, Point of Sale                        | complete |
| 15  | Parity modules: Blogs, Website                                             | complete |

## Next Step

AureusERP parity is complete: **21 modules** (3 core + 18 optional), all four waves delivered.
Next: the Jabulani/ZNS follow-ups — product variants, workshop job cards, project costing,
attendance, bank reconciliation/expenses, Odoo import — plus the earlier commercial follow-ups
(credit notes, PDF documents, multi-company, stock valuation reports, payroll, per-module
permissions UI).

## Errors Encountered

| Error                                                                  | Attempt | Resolution                                                                                                                                                               |
| ---------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Subagent for AureusERP schema hit free usage limit                     | 1       | Extracted schema directly from migrations with shell/grep                                                                                                                |
| Hire failed with `UNIQUE constraint failed: employees.employee_number` | 1       | Demo seed hand-wrote `EMP-00001`; seed now uses `nextNumber`, startup reconciles the employee sequence, and hire writes the employee + applicant link in one transaction |
| POS cash-up showed R0 expected for an open session                     | 1       | The stored `expected_cash_cents` is only written on close; the sessions API now returns `live_expected_cash_cents` for open sessions and the UI uses it                  |
