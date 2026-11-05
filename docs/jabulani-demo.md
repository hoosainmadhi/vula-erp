# Jabulani Boards demo

Local demo of vula-erp prepared for Jabulani Boards.

## URL

**http://jabulani-boards.localhost:3290**

The host proxy on port 3290 routes:

- `africcoach.localhost` → Africoach backend on 3291
- `jabulani-boards.localhost` → Jabulani backend on 3292

## Sign in

| User          | Email                          | Password            | Role       |
| ------------- | ------------------------------ | ------------------- | ---------- |
| Admin         | `admin@jabulani.local`         | `JabulaniDemo2026!` | admin      |
| Sales         | `sales@jabulani.local`         | `JabulaniDemo2026!` | sales      |
| Workshop      | `workshop@jabulani.local`      | `JabulaniDemo2026!` | warehouse  |
| Accounts      | `accounts@jabulani.local`      | `JabulaniDemo2026!` | accountant |
| Employee      | `thabo@jabulani.local`         | `EmployeeDemo2026!` | employee   |
| Workshop lead | `workshop.lead@jabulani.local` | `WorkshopDemo2026!` | workshop   |

## What is seeded

- Company profile: Jabulani Boards, Johannesburg HQ and Eastern Cape branch
- 29 products across Boards, Edging, Hardware, Decorative, Furniture and Services
- 2 warehouses / stock locations with opening stock
- 14 partners: 7 trade customers and 6 suppliers
- 5 purchase orders (draft, confirmed, received), goods receipts and supplier bills
- 7 sales orders (draft, confirmed, fulfilled, invoiced)
- 22 invoices, 20 payments and 42 journal entries across June–November 2026
- 6 employees across Management, Sales, Finance and Workshop
- Attendance register for the last three working days
- 5 operating expenses (rent, utilities, transport, consumables, repairs)
- 1 bank account with 5 statement lines ready to reconcile
- 3 projects: Sandton kitchen renovation, Rosebank walk-in wardrobe, East London office fit-out
- 1 BOM and 4 manufacturing orders for a cut-and-edge workshop job
- 2 POS registers — Johannesburg and Eastern Cape
- 1 open POS session with 3 cash/card sales
- Public site at `/site` with an “About Jabulani Boards” page and a blog post

## Branches

One deployment, two branches:

| Branch          | Warehouse           | Stock location | POS register          |
| --------------- | ------------------- | -------------- | --------------------- |
| Johannesburg HQ | Johannesburg HQ     | JHB Stock      | Johannesburg Register |
| Eastern Cape    | Eastern Cape Branch | EC Stock       | Eastern Cape Register |

## Workshop and branches

The **Workshop** module has two demo jobs:

- `WS-00001` — paid invoice, ready for collection, with a cutting-list file
- `WS-00002` — open invoice, awaiting payment (the payment gate blocks release)

The workshop user lands on **Workshop** and can open jobs, progress operations, upload
cutting lists and mark jobs collected. The admin can also see all jobs.

Branches are modelled as warehouses:

- **Inventory → Stock on hand** has an All branches / Johannesburg HQ / Eastern Cape filter
- **Sales orders**, **purchase orders** and **invoices** now have a Branch column and filter
- New orders can be captured against a branch

## Employee self-service

Sign in as `thabo@jabulani.local` / `EmployeeDemo2026!` to see **My Leave**:
own balances, apply for leave, and cancel a pending request. Employees do not see
the company dashboard or other employees’ leave.

## Suggested demo flow

1. Dashboard — sales, receivables, payables, cash
2. Products — boards, edging, hardware, decorative, furniture
3. Inventory — stock by JHB and EC
4. Purchase orders — draft, confirmed, received
5. Sales orders — draft, confirmed, fulfilled, invoiced
6. Quotations — branded quote, print/PDF, convert to a sales order
7. Invoices — credit note against an invoice, AR/AP aging under Accounting → Reports
8. Expenses — capture and post an operating cost
9. Bank reconciliation — match a statement line to a posted ledger entry
10. Projects — kitchen, wardrobe and office fit-out jobs, costs and margin
11. Attendance — daily register and clock-in/out
12. Manufacturing — cut-and-edge BOM and production orders
13. POS — open session, counter sale, cash-up
14. Data import — paste a product or partner CSV (Odoo column names work)
15. Public site — `/site` and `/blog`

## Run / restart

```bash
cd ~/apps/vula-erp
bash scripts/start-demos.sh
```

This starts both demo backends and the host proxy. Logs:

- `/tmp/opencode/africoach-demo.log`
- `/tmp/opencode/jabulani-demo.log`
- `/tmp/opencode/demo-proxy.log`

## Reset Jabulani data

```bash
cd ~/apps/vula-erp
rm -f data/jabulani-demo.db data/jabulani-demo.db-shm data/jabulani-demo.db-wal
DB_PATH=data/jabulani-demo.db npx tsx scripts/seed-jabulani.ts
DB_PATH=data/jabulani-demo.db npx tsx scripts/seed-demo-extras.ts
```

## Honest caveats

- This is a **foundation demo**, not a finished Odoo replacement.
- Products are flat SKUs with brand/colour/size/thickness fields, not full variants.
- The workshop has a dedicated job-card workflow; the Manufacturing module still
  exists separately for BOMs and production orders.
- Bank reconciliation matches statement lines to posted journal entries; it does
  not import OFX/QIF or auto-suggest matches yet.
- The public site is a CMS, not an e-commerce storefront.
