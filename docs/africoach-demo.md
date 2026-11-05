# Africoach demo

Local demo of vula-erp prepared for Africoach / Mash Coach Supplies.

## URL

**http://africcoach.localhost:3290**

`wxyz` must be a numeric port. This demo uses **3290** because 3280/3281 are the
main vula-erp dev servers.

## Sign in

| User      | Email                       | Password             | Role       |
| --------- | --------------------------- | -------------------- | ---------- |
| Admin     | `admin@africoach.local`     | `AfricoachDemo2026!` | admin      |
| Sales     | `sales@africoach.local`     | `AfricoachDemo2026!` | sales      |
| Warehouse | `warehouse@africoach.local` | `AfricoachDemo2026!` | warehouse  |
| Accounts  | `accounts@africoach.local`  | `AfricoachDemo2026!` | accountant |

## What is seeded

- Company profile: Africoach, Johannesburg head office and Cape Town branch
- 44 bus/coach parts across Body Parts, Interior, Electrical, Engine & Chassis and Maintenance
- 2 warehouses / stock locations with opening stock
- 19 partners: 10 B2B customers and 8 suppliers
- 5 purchase orders (draft, confirmed, received), goods receipts and supplier bills
- 8 sales orders (draft, confirmed, fulfilled, invoiced)
- 35 invoices, 32 payments and 67 journal entries across June–November 2026
- 6 employees across Management, Sales, Finance and Warehouse
- 2 POS registers — Johannesburg and Cape Town
- 1 open POS session with 3 cash/card sales and cash-up data
- Public site at `/site` with an “About Africoach” page and a blog post

## Branches

This is **one deployment**, not two. Africoach’s Johannesburg and Cape Town branches
are modelled as two warehouses with their own stock locations and POS registers:

- Johannesburg HQ — `JHB Stock` / Johannesburg Register
- Cape Town Branch — `CPT Stock` / Cape Town Register

One database means one product master, one customer/supplier master, one stock ledger
and one accounting ledger. Stock is held per location, and the POS is assigned to a
branch register. Consolidated reporting is therefore possible.

Two separate deployments would duplicate the masters and ledgers and prevent a
consolidated view. Only split deployments if the branches are separate legal entities
with separate accounting, or need to operate independently/offline.

Still to build for full branch management: branch-scoped users, branch filters on
sales/purchases/reports, stock transfers between branches, and branch P&L.

## Mobile

The admin shell is responsive: mobile drawer, sticky header, bottom navigation
(Home / Sales / POS / Products / Menu), full-screen modals on phones, safe-area
padding for notched devices, and 16px mobile form fields to stop iOS zooming.
POS also has a mobile cart shortcut that jumps to the cart from the product grid.

## Run / restart

Both demos run behind a host proxy on port 3290:

```bash
cd ~/apps/vula-erp
bash scripts/start-demos.sh
```

- `http://africcoach.localhost:3290` → Africoach backend on 3291
- `http://jabulani-boards.localhost:3290` → Jabulani backend on 3292

For Africoach alone (direct, without the proxy):

```bash
cd ~/apps/vula-erp
bash scripts/start-africoach-demo.sh
```

Or manually:

```bash
cd ~/apps/vula-erp
npm run build
NODE_ENV=production \
PORT=3291 \
DB_PATH=data/africoach-demo.db \
JWT_SECRET='africoach-demo-local-secret-2026-please-change' \
APP_URL='http://africcoach.localhost:3290' \
ALLOW_LOCAL_APP_URL=true \
node dist/server.js
```

Logs: `/tmp/opencode/africoach-demo.log`

## Reset the demo data

```bash
cd ~/apps/vula-erp
rm -f data/africoach-demo.db data/africoach-demo.db-shm data/africoach-demo.db-wal
DB_PATH=data/africoach-demo.db npx tsx scripts/seed-africoach.ts
```

The seed script is in `scripts/seed-africoach.ts`. It is separate from the main
`data/vula-erp.db` database.

## Suggested demo flow

1. Dashboard — sales, receivables, payables, cash, low stock
2. Products — search by SKU/name, stock by branch
3. Purchase orders — draft, confirmed and received; goods receipts
4. Sales orders — draft, confirmed, fulfilled and invoiced
5. Invoices & payments — paid and open invoices, statements
6. Accounting — chart of accounts, trial balance, P&L, VAT
7. Point of Sale — open session, counter sale, cash-up
8. Public site — `/site` and `/blog`

## Honest caveats

- This is a **foundation demo**, not a finished K8 replacement.
- Product fitment/brand data is stored in the product description; there are no
  variants, cross-references or price lists yet.
- Multi-branch stock exists, but there is no transfer workflow or branch P&L.
- Imports, landed costs, multi-currency and credit notes are not implemented.
- The public site is a CMS, not a B2B storefront.
- K8, Antheros and Phocas are not integrated in this demo.
