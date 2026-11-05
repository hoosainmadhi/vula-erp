# Jabulani Boards demo

Local demo of vula-erp prepared for Jabulani Boards.

## URL

**http://jabulani-boards.localhost:3290**

The host proxy on port 3290 routes:

- `africcoach.localhost` → Africoach backend on 3291
- `jabulani-boards.localhost` → Jabulani backend on 3292

## Sign in

| User     | Email                     | Password            | Role       |
| -------- | ------------------------- | ------------------- | ---------- |
| Admin    | `admin@jabulani.local`    | `JabulaniDemo2026!` | admin      |
| Sales    | `sales@jabulani.local`    | `JabulaniDemo2026!` | sales      |
| Workshop | `workshop@jabulani.local` | `JabulaniDemo2026!` | warehouse  |
| Accounts | `accounts@jabulani.local` | `JabulaniDemo2026!` | accountant |

## What is seeded

- Company profile: Jabulani Boards, Johannesburg HQ and Eastern Cape branch
- 29 products across Boards, Edging, Hardware, Decorative, Furniture and Services
- 2 warehouses / stock locations with opening stock
- 14 partners: 7 trade customers and 6 suppliers
- 5 purchase orders (draft, confirmed, received), goods receipts and supplier bills
- 7 sales orders (draft, confirmed, fulfilled, invoiced)
- 22 invoices, 20 payments and 42 journal entries across June–November 2026
- 6 employees across Management, Sales, Finance and Workshop
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

## Suggested demo flow

1. Dashboard — sales, receivables, payables, cash
2. Products — boards, edging, hardware, decorative, furniture
3. Inventory — stock by JHB and EC
4. Purchase orders — draft, confirmed, received
5. Sales orders — draft, confirmed, fulfilled, invoiced
6. Projects — kitchen, wardrobe and office fit-out jobs
7. Manufacturing — cut-and-edge BOM and production orders
8. POS — open session, counter sale, cash-up
9. Public site — `/site` and `/blog`

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
```

## Honest caveats

- This is a **foundation demo**, not a finished Odoo replacement.
- Products are flat SKUs; brand/colour/size/thickness are in the description, not
  variants or attributes.
- The workshop is modelled with the Manufacturing module (BOM + production orders),
  not a dedicated cutting-list/edge-banding job-card workflow yet.
- Quotes, credit notes, bank reconciliation and purchase/sales price lists are not
  implemented.
- The public site is a CMS, not an e-commerce storefront.
