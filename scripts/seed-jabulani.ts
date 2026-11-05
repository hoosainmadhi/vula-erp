import bcrypt from 'bcrypt';
import { closeDb, getDb } from '../src/db.js';
import { nextNumber } from '../src/services/sequences.js';
import { recordMove, receivePurchaseOrder, fulfilSalesOrder } from '../src/services/stock.js';
import { createInvoice, recordPayment } from '../src/services/invoices.js';
import { accountByCode, postJournalEntry } from '../src/services/accounting.js';
import { lineTotals } from '../src/utils/money.js';
import { addDays } from '../src/utils/dates.js';

const db = getDb();
const PASSWORD = 'JabulaniDemo2026!';

function setting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(key, value);
}

function roleId(name: string): number {
  return (db.prepare('SELECT id FROM roles WHERE name = ?').get(name) as { id: number }).id;
}

function createUser(email: string, first: string, last: string, role: string): number {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as
    { id: number } | undefined;
  if (existing) return existing.id;
  const result = db
    .prepare('INSERT INTO users (email, password_hash, first_name, last_name) VALUES (?, ?, ?, ?)')
    .run(email, bcrypt.hashSync(PASSWORD, 10), first, last);
  const id = Number(result.lastInsertRowid);
  db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(id, roleId(role));
  return id;
}

function partner(input: {
  name: string;
  customer?: boolean;
  supplier?: boolean;
  email?: string;
  phone?: string;
  city?: string;
  vat?: string;
  credit?: number;
  terms?: number;
}): number {
  const existing = db.prepare('SELECT id FROM partners WHERE name = ?').get(input.name) as
    { id: number } | undefined;
  if (existing) return existing.id;
  const result = db
    .prepare(
      `INSERT INTO partners
         (name, is_customer, is_supplier, email, phone, city, vat_number, credit_limit_cents,
          payment_terms_days, country)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'South Africa')`,
    )
    .run(
      input.name,
      input.customer ? 1 : 0,
      input.supplier ? 1 : 0,
      input.email ?? null,
      input.phone ?? null,
      input.city ?? null,
      input.vat ?? null,
      input.credit ?? 0,
      input.terms ?? 30,
    );
  return Number(result.lastInsertRowid);
}

function category(name: string): number {
  const existing = db.prepare('SELECT id FROM product_categories WHERE name = ?').get(name) as
    { id: number } | undefined;
  if (existing) return existing.id;
  return Number(
    db.prepare('INSERT INTO product_categories (name) VALUES (?)').run(name).lastInsertRowid,
  );
}

function department(name: string): number {
  const existing = db.prepare('SELECT id FROM departments WHERE name = ?').get(name) as
    { id: number } | undefined;
  if (existing) return existing.id;
  return Number(db.prepare('INSERT INTO departments (name) VALUES (?)').run(name).lastInsertRowid);
}

function createEmployee(input: {
  firstName: string;
  lastName: string;
  email: string;
  department: string;
  jobTitle: string;
  salaryCents: number;
  startDate: string;
  userId?: number;
}): void {
  const existing = db.prepare('SELECT id FROM employees WHERE email = ?').get(input.email) as
    { id: number } | undefined;
  if (existing) return;
  db.prepare(
    `INSERT INTO employees
       (employee_number, user_id, first_name, last_name, email, department_id, job_title,
        employment_type, status, start_date, salary_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'permanent', 'active', ?, ?)`,
  ).run(
    nextNumber('employee'),
    input.userId ?? null,
    input.firstName,
    input.lastName,
    input.email,
    department(input.department),
    input.jobTitle,
    input.startDate,
    input.salaryCents,
  );
}

interface ProductSeed {
  sku: string;
  name: string;
  category: string;
  brand: string;
  spec: string;
  cost: number;
  price: number;
  uom?: string;
  barcode: string;
  jhb: number;
  ec: number;
  reorder?: number;
}

const PRODUCTS: ProductSeed[] = [
  {
    sku: 'JB-BD-1001',
    name: 'PG Bison MelaWood 16mm White 2750x1830',
    category: 'Boards',
    brand: 'PG Bison',
    spec: '16mm · White · 2750x1830',
    cost: 85000,
    price: 129900,
    uom: 'sheet',
    barcode: '6002001000011',
    jhb: 60,
    ec: 30,
    reorder: 10,
  },
  {
    sku: 'JB-BD-1002',
    name: 'PG Bison MelaWood 16mm Oak 2750x1830',
    category: 'Boards',
    brand: 'PG Bison',
    spec: '16mm · Oak · 2750x1830',
    cost: 89000,
    price: 134900,
    uom: 'sheet',
    barcode: '6002001000028',
    jhb: 45,
    ec: 22,
    reorder: 10,
  },
  {
    sku: 'JB-BD-1003',
    name: 'Sonae Novacolor 18mm Graphite 2750x1830',
    category: 'Boards',
    brand: 'Sonae Arauco',
    spec: '18mm · Graphite · 2750x1830',
    cost: 115000,
    price: 174900,
    uom: 'sheet',
    barcode: '6002001000035',
    jhb: 30,
    ec: 16,
    reorder: 8,
  },
  {
    sku: 'JB-BD-1004',
    name: 'Sonae Novacolor 18mm Cashmere 2750x1830',
    category: 'Boards',
    brand: 'Sonae Arauco',
    spec: '18mm · Cashmere · 2750x1830',
    cost: 115000,
    price: 174900,
    uom: 'sheet',
    barcode: '6002001000042',
    jhb: 28,
    ec: 14,
    reorder: 8,
  },
  {
    sku: 'JB-BD-1005',
    name: 'Arauco Pine Plywood 18mm 2440x1220',
    category: 'Boards',
    brand: 'Arauco',
    spec: '18mm · Pine · 2440x1220',
    cost: 62000,
    price: 94900,
    uom: 'sheet',
    barcode: '6002001000059',
    jhb: 50,
    ec: 25,
    reorder: 10,
  },
  {
    sku: 'JB-BD-1006',
    name: 'MDF 16mm White 2750x1830',
    category: 'Boards',
    brand: 'Local Timber',
    spec: '16mm · White · 2750x1830',
    cost: 55000,
    price: 84900,
    uom: 'sheet',
    barcode: '6002001000066',
    jhb: 40,
    ec: 20,
    reorder: 10,
  },
  {
    sku: 'JB-BD-1007',
    name: 'Meranti Solid Board 25mm 2440x1220',
    category: 'Boards',
    brand: 'Local Timber',
    spec: '25mm · Meranti · 2440x1220',
    cost: 145000,
    price: 219900,
    uom: 'sheet',
    barcode: '6002001000073',
    jhb: 18,
    ec: 9,
    reorder: 5,
  },
  {
    sku: 'JB-BD-1008',
    name: 'Supawall 9mm White 2750x1200',
    category: 'Boards',
    brand: 'PG Bison',
    spec: '9mm · White · 2750x1200',
    cost: 48000,
    price: 74900,
    uom: 'sheet',
    barcode: '6002001000080',
    jhb: 35,
    ec: 18,
    reorder: 8,
  },
  {
    sku: 'JB-ED-2001',
    name: 'ABS Edging 22mm White 50m',
    category: 'Edging',
    brand: 'Edgeband Supplies',
    spec: '22mm · White · 50m roll',
    cost: 18500,
    price: 29900,
    uom: 'roll',
    barcode: '6002001000097',
    jhb: 40,
    ec: 20,
    reorder: 10,
  },
  {
    sku: 'JB-ED-2002',
    name: 'ABS Edging 22mm Oak 50m',
    category: 'Edging',
    brand: 'Edgeband Supplies',
    spec: '22mm · Oak · 50m roll',
    cost: 19500,
    price: 31900,
    uom: 'roll',
    barcode: '6002001000103',
    jhb: 35,
    ec: 18,
    reorder: 10,
  },
  {
    sku: 'JB-ED-2003',
    name: 'ABS Edging 22mm Graphite 50m',
    category: 'Edging',
    brand: 'Edgeband Supplies',
    spec: '22mm · Graphite · 50m roll',
    cost: 19500,
    price: 31900,
    uom: 'roll',
    barcode: '6002001000110',
    jhb: 30,
    ec: 15,
    reorder: 8,
  },
  {
    sku: 'JB-ED-2004',
    name: 'Edge Banding Glue 1kg',
    category: 'Edging',
    brand: 'Kleiberit',
    spec: 'Hot melt · 1kg',
    cost: 12000,
    price: 19900,
    uom: 'unit',
    barcode: '6002001000127',
    jhb: 25,
    ec: 12,
    reorder: 5,
  },
  {
    sku: 'JB-HW-3001',
    name: 'Blum Soft Close Hinge 110°',
    category: 'Hardware',
    brand: 'Blum',
    spec: 'Clip-on · soft close',
    cost: 4500,
    price: 7900,
    uom: 'unit',
    barcode: '6002001000134',
    jhb: 200,
    ec: 100,
    reorder: 40,
  },
  {
    sku: 'JB-HW-3002',
    name: 'Hafele Drawer Runner 450mm',
    category: 'Hardware',
    brand: 'Hafele',
    spec: 'Full extension · 450mm',
    cost: 18500,
    price: 29900,
    uom: 'pair',
    barcode: '6002001000141',
    jhb: 80,
    ec: 40,
    reorder: 20,
  },
  {
    sku: 'JB-HW-3003',
    name: 'Cabinet Handle 128mm Brushed Nickel',
    category: 'Hardware',
    brand: 'Hafele',
    spec: '128mm · brushed nickel',
    cost: 3500,
    price: 6500,
    uom: 'unit',
    barcode: '6002001000158',
    jhb: 150,
    ec: 70,
    reorder: 30,
  },
  {
    sku: 'JB-HW-3004',
    name: 'Cam Lock 15mm',
    category: 'Hardware',
    brand: 'Hafele',
    spec: '15mm · zinc',
    cost: 1200,
    price: 2500,
    uom: 'unit',
    barcode: '6002001000165',
    jhb: 300,
    ec: 150,
    reorder: 50,
  },
  {
    sku: 'JB-HW-3005',
    name: 'Shelf Pin 5mm (100)',
    category: 'Hardware',
    brand: 'Hafele',
    spec: '5mm · pack of 100',
    cost: 4500,
    price: 7900,
    uom: 'pack',
    barcode: '6002001000172',
    jhb: 60,
    ec: 30,
    reorder: 15,
  },
  {
    sku: 'JB-HW-3006',
    name: 'Wood Screw 4x40 (200)',
    category: 'Hardware',
    brand: 'FastFix',
    spec: '4x40mm · pack of 200',
    cost: 5500,
    price: 9500,
    uom: 'pack',
    barcode: '6002001000189',
    jhb: 90,
    ec: 45,
    reorder: 20,
  },
  {
    sku: 'JB-DC-4001',
    name: 'Acoustic Slat Panel Oak 600x2400',
    category: 'Decorative',
    brand: 'AcousticWorx',
    spec: 'Oak · 600x2400',
    cost: 42000,
    price: 69900,
    uom: 'panel',
    barcode: '6002001000196',
    jhb: 24,
    ec: 12,
    reorder: 6,
  },
  {
    sku: 'JB-DC-4002',
    name: 'Decorative Wall Panel Marble 600x2400',
    category: 'Decorative',
    brand: 'DecoWall',
    spec: 'Marble · 600x2400',
    cost: 38000,
    price: 62900,
    uom: 'panel',
    barcode: '6002001000202',
    jhb: 20,
    ec: 10,
    reorder: 5,
  },
  {
    sku: 'JB-DC-4003',
    name: 'Mirror 600x800 Bevel Edge',
    category: 'Decorative',
    brand: 'GlassCo',
    spec: '600x800 · bevel edge',
    cost: 22000,
    price: 37900,
    uom: 'unit',
    barcode: '6002001000219',
    jhb: 18,
    ec: 9,
    reorder: 4,
  },
  {
    sku: 'JB-DC-4004',
    name: 'LED Strip Light 5m Warm White',
    category: 'Decorative',
    brand: 'Lumex',
    spec: '5m · 12V · warm white',
    cost: 12000,
    price: 21900,
    uom: 'roll',
    barcode: '6002001000226',
    jhb: 35,
    ec: 18,
    reorder: 8,
  },
  {
    sku: 'JB-FU-5001',
    name: 'Custom Kitchen Cabinet (per linear metre)',
    category: 'Furniture',
    brand: 'Jabulani',
    spec: 'Made to order · per linear metre',
    cost: 180000,
    price: 295000,
    uom: 'metre',
    barcode: '6002001000233',
    jhb: 0,
    ec: 0,
    reorder: 0,
  },
  {
    sku: 'JB-FU-5002',
    name: 'Floating Shelf 900mm Oak',
    category: 'Furniture',
    brand: 'Jabulani',
    spec: '900mm · oak veneer',
    cost: 42000,
    price: 69900,
    uom: 'unit',
    barcode: '6002001000240',
    jhb: 12,
    ec: 6,
    reorder: 3,
  },
  {
    sku: 'JB-FU-5003',
    name: 'Vanity Unit 900mm White',
    category: 'Furniture',
    brand: 'Jabulani',
    spec: '900mm · white · assembled',
    cost: 145000,
    price: 239900,
    uom: 'unit',
    barcode: '6002001000257',
    jhb: 6,
    ec: 3,
    reorder: 2,
  },
  {
    sku: 'JB-FU-5004',
    name: 'Granite Countertop (per m²)',
    category: 'Furniture',
    brand: 'StoneWorks',
    spec: 'Per square metre · installed',
    cost: 185000,
    price: 289900,
    uom: 'm2',
    barcode: '6002001000264',
    jhb: 0,
    ec: 0,
    reorder: 0,
  },
  {
    sku: 'JB-SV-6001',
    name: 'Cutting & Edging Service (per sheet)',
    category: 'Services',
    brand: 'Jabulani',
    spec: 'Cut and edge one sheet',
    cost: 4500,
    price: 8900,
    uom: 'sheet',
    barcode: '6002001000271',
    jhb: 0,
    ec: 0,
    reorder: 0,
  },
  {
    sku: 'JB-SV-6002',
    name: 'Kitchen Installation Service',
    category: 'Services',
    brand: 'Jabulani',
    spec: 'On-site installation',
    cost: 250000,
    price: 450000,
    uom: 'job',
    barcode: '6002001000288',
    jhb: 0,
    ec: 0,
    reorder: 0,
  },
  {
    sku: 'JB-SV-6003',
    name: 'Board Cutting Optimisation',
    category: 'Services',
    brand: 'Jabulani',
    spec: 'Cutting list optimisation',
    cost: 15000,
    price: 29900,
    uom: 'job',
    barcode: '6002001000295',
    jhb: 0,
    ec: 0,
    reorder: 0,
  },
];

const products = new Map<string, number>();
const productCosts = new Map<string, number>();
const productPrices = new Map<string, number>();

function productAttributes(product: ProductSeed): {
  brand: string | null;
  colour: string | null;
  size: string | null;
  thickness: string | null;
} {
  if (product.category === 'Services') {
    return { brand: product.brand || null, colour: null, size: null, thickness: null };
  }
  let colour: string | null = null;
  let size: string | null = null;
  let thickness: string | null = null;
  for (const part of product.spec.split('·').map((value) => value.trim())) {
    if (!part) continue;
    if (/^\d+(?:\.\d+)?mm$/i.test(part)) {
      thickness = part;
    } else if (/^\d+\s*[x×]\s*\d+/i.test(part)) {
      size = part.replace(/\s*[x×]\s*/i, 'x');
    } else if (
      !colour &&
      !/^(pack of|per |made to order|clip-on|cut |cutting |on-site|full extension|hot melt)/i.test(
        part,
      )
    ) {
      colour = part;
    }
  }
  return { brand: product.brand || null, colour, size, thickness };
}

function insertProducts(): void {
  const standardTax = (
    db.prepare("SELECT id FROM tax_rates WHERE name = 'Standard VAT 15%'").get() as { id: number }
  ).id;
  const insert = db.prepare(
    `INSERT INTO products
       (sku, barcode, name, description, brand, colour, size, thickness, category_id, type, uom,
        sale_price_cents, cost_cents, tax_rate_id, track_inventory, reorder_level, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  );
  const updateAttributes = db.prepare(
    `UPDATE products SET brand = ?, colour = ?, size = ?, thickness = ? WHERE id = ?`,
  );
  for (const product of PRODUCTS) {
    const existing = db.prepare('SELECT id FROM products WHERE sku = ?').get(product.sku) as
      { id: number } | undefined;
    const type = product.category === 'Services' ? 'service' : 'goods';
    const track = type === 'service' || product.jhb + product.ec === 0 ? 0 : 1;
    const attributes = productAttributes(product);
    const id = existing
      ? existing.id
      : Number(
          insert.run(
            product.sku,
            product.barcode,
            product.name,
            `Brand: ${product.brand}. ${product.spec}.`,
            attributes.brand,
            attributes.colour,
            attributes.size,
            attributes.thickness,
            category(product.category),
            type,
            product.uom ?? 'unit',
            product.price,
            product.cost,
            standardTax,
            track,
            product.reorder ?? 5,
          ).lastInsertRowid,
        );
    updateAttributes.run(
      attributes.brand,
      attributes.colour,
      attributes.size,
      attributes.thickness,
      id,
    );
    products.set(product.sku, id);
    productCosts.set(product.sku, product.cost);
    productPrices.set(product.sku, product.price);
  }
}

function stockLocations(): { jhb: number; ec: number } {
  const main = db.prepare("SELECT id FROM warehouses WHERE code = 'MAIN'").get() as
    { id: number } | undefined;
  const mainId = main
    ? main.id
    : Number(
        db.prepare("INSERT INTO warehouses (code, name) VALUES ('MAIN', 'Johannesburg HQ')").run()
          .lastInsertRowid,
      );
  db.prepare(
    "UPDATE warehouses SET name = 'Johannesburg HQ', address = '14 Booysens Road, Selby, Johannesburg' WHERE id = ?",
  ).run(mainId);
  const jhb = db
    .prepare("SELECT id FROM stock_locations WHERE warehouse_id = ? AND code = 'STOCK'")
    .get(mainId) as { id: number } | undefined;
  const jhbId = jhb
    ? jhb.id
    : Number(
        db
          .prepare(
            "INSERT INTO stock_locations (warehouse_id, code, name, is_default) VALUES (?, 'STOCK', 'JHB Stock', 1)",
          )
          .run(mainId).lastInsertRowid,
      );
  db.prepare("UPDATE stock_locations SET name = 'JHB Stock', is_default = 1 WHERE id = ?").run(
    jhbId,
  );

  const ecWarehouse = db.prepare("SELECT id FROM warehouses WHERE code = 'EC'").get() as
    { id: number } | undefined;
  const ecWarehouseId = ecWarehouse
    ? ecWarehouse.id
    : Number(
        db
          .prepare(
            "INSERT INTO warehouses (code, name, address) VALUES ('EC', 'Eastern Cape Branch', '14 Bismark Street, Gqeberha, Eastern Cape')",
          )
          .run().lastInsertRowid,
      );
  const ec = db
    .prepare("SELECT id FROM stock_locations WHERE warehouse_id = ? AND code = 'STOCK'")
    .get(ecWarehouseId) as { id: number } | undefined;
  const ecId = ec
    ? ec.id
    : Number(
        db
          .prepare(
            "INSERT INTO stock_locations (warehouse_id, code, name, is_default) VALUES (?, 'STOCK', 'EC Stock', 1)",
          )
          .run(ecWarehouseId).lastInsertRowid,
      );

  db.prepare(
    "UPDATE pos_registers SET name = 'Johannesburg Register', warehouse_id = ?, location_id = ? WHERE code = 'MAIN'",
  ).run(mainId, jhbId);
  const ecRegister = db.prepare("SELECT id FROM pos_registers WHERE code = 'EC'").get() as
    { id: number } | undefined;
  if (!ecRegister) {
    db.prepare(
      "INSERT INTO pos_registers (name, code, warehouse_id, location_id) VALUES ('Eastern Cape Register', 'EC', ?, ?)",
    ).run(ecWarehouseId, ecId);
  }

  return { jhb: jhbId, ec: ecId };
}

function openingStock(jhb: number, ec: number, userId: number): void {
  for (const product of PRODUCTS) {
    const productId = products.get(product.sku);
    if (!productId) continue;
    if (product.jhb > 0) {
      recordMove({
        productId,
        locationId: jhb,
        quantity: product.jhb,
        moveType: 'opening',
        referenceType: 'seed',
        note: 'Opening stock — Johannesburg',
        userId,
      });
    }
    if (product.ec > 0) {
      recordMove({
        productId,
        locationId: ec,
        quantity: product.ec,
        moveType: 'opening',
        referenceType: 'seed',
        note: 'Opening stock — Eastern Cape',
        userId,
      });
    }
  }
}

function createPurchaseOrder(input: {
  supplierId: number;
  orderDate: string;
  expectedDate: string;
  status: 'draft' | 'confirmed' | 'received';
  lines: { sku: string; quantity: number }[];
  userId: number;
  locationId: number;
  pay: 'full' | 'partial' | 'none';
}): number {
  const lines = input.lines.map((line) => {
    const unitCost = productCosts.get(line.sku) ?? 0;
    const totals = lineTotals(line.quantity, unitCost, 1500);
    return { ...line, productId: products.get(line.sku)!, unitCost, totals };
  });
  const subtotal = lines.reduce((total, line) => total + line.totals.subtotalCents, 0);
  const tax = lines.reduce((total, line) => total + line.totals.taxCents, 0);
  const total = subtotal + tax;
  const warehouseId = (
    db.prepare('SELECT warehouse_id FROM stock_locations WHERE id = ?').get(input.locationId) as {
      warehouse_id: number;
    }
  ).warehouse_id;
  const poId = db.transaction(() => {
    const number = nextNumber('purchase_order');
    const result = db
      .prepare(
        `INSERT INTO purchase_orders
           (number, supplier_id, warehouse_id, status, order_date, expected_date, subtotal_cents,
            tax_cents, total_cents, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        number,
        input.supplierId,
        warehouseId,
        input.status === 'draft' ? 'draft' : 'confirmed',
        input.orderDate,
        input.expectedDate,
        subtotal,
        tax,
        total,
        `Jabulani demo purchase order ${number}`,
        input.userId,
      );
    const id = Number(result.lastInsertRowid);
    const insertLine = db.prepare(
      `INSERT INTO purchase_order_lines
         (purchase_order_id, product_id, description, quantity, unit_cost_cents, tax_rate_bp,
          line_subtotal_cents, line_tax_cents, line_total_cents)
       VALUES (?, ?, ?, ?, ?, 1500, ?, ?, ?)`,
    );
    for (const line of lines) {
      insertLine.run(
        id,
        line.productId,
        PRODUCTS.find((p) => p.sku === line.sku)?.name ?? line.sku,
        line.quantity,
        line.unitCost,
        line.totals.subtotalCents,
        line.totals.taxCents,
        line.totals.totalCents,
      );
    }
    return id;
  })();
  if (input.status === 'received') {
    receivePurchaseOrder(poId, {
      locationId: input.locationId,
      receivedDate: input.expectedDate,
      userId: input.userId,
    });
    const bill = createInvoice({
      direction: 'purchase',
      partnerId: input.supplierId,
      issueDate: input.expectedDate,
      dueDate: addDays(input.expectedDate, 30),
      purchaseOrderId: poId,
      notes: `Supplier bill for PO ${poId}`,
      lines: lines.map((line) => ({
        productId: line.productId,
        description: PRODUCTS.find((p) => p.sku === line.sku)?.name ?? line.sku,
        quantity: line.quantity,
        unitPriceCents: line.unitCost,
        taxRateBp: 1500,
      })),
      post: true,
      userId: input.userId,
    }) as unknown as { id: number; total_cents: number };
    if (input.pay !== 'none') {
      recordPayment({
        partnerId: input.supplierId,
        invoiceId: bill.id,
        direction: 'out',
        paymentDate: input.expectedDate,
        amountCents: input.pay === 'full' ? total : Math.round(total / 2),
        method: 'eft',
        reference: `PAY-${bill.id}`,
        userId: input.userId,
      });
    }
  }
  return poId;
}

function createSalesOrder(input: {
  customerId: number;
  orderDate: string;
  status: 'draft' | 'confirmed' | 'fulfilled' | 'invoiced';
  lines: { sku: string; quantity: number }[];
  userId: number;
  locationId: number;
  pay: 'full' | 'partial' | 'none';
}): number {
  const lines = input.lines.map((line) => {
    const unitPrice = productPrices.get(line.sku) ?? 0;
    const totals = lineTotals(line.quantity, unitPrice, 1500);
    return { ...line, productId: products.get(line.sku)!, unitPrice, totals };
  });
  const subtotal = lines.reduce((total, line) => total + line.totals.subtotalCents, 0);
  const tax = lines.reduce((total, line) => total + line.totals.taxCents, 0);
  const total = subtotal + tax;
  const warehouseId = (
    db.prepare('SELECT warehouse_id FROM stock_locations WHERE id = ?').get(input.locationId) as {
      warehouse_id: number;
    }
  ).warehouse_id;
  const soId = db.transaction(() => {
    const number = nextNumber('sales_order');
    const result = db
      .prepare(
        `INSERT INTO sales_orders
           (number, customer_id, warehouse_id, status, order_date, delivery_date, subtotal_cents,
            tax_cents, total_cents, notes, created_by)
         VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        number,
        input.customerId,
        warehouseId,
        input.orderDate,
        input.orderDate,
        subtotal,
        tax,
        total,
        `Jabulani demo sales order ${number}`,
        input.userId,
      );
    const id = Number(result.lastInsertRowid);
    const insertLine = db.prepare(
      `INSERT INTO sales_order_lines
         (sales_order_id, product_id, description, quantity, unit_price_cents, tax_rate_bp,
          line_subtotal_cents, line_tax_cents, line_total_cents)
       VALUES (?, ?, ?, ?, ?, 1500, ?, ?, ?)`,
    );
    for (const line of lines) {
      insertLine.run(
        id,
        line.productId,
        PRODUCTS.find((p) => p.sku === line.sku)?.name ?? line.sku,
        line.quantity,
        line.unitPrice,
        line.totals.subtotalCents,
        line.totals.taxCents,
        line.totals.totalCents,
      );
    }
    return id;
  })();
  if (input.status === 'confirmed') {
    db.prepare("UPDATE sales_orders SET status = 'confirmed' WHERE id = ?").run(soId);
  }
  if (input.status === 'fulfilled' || input.status === 'invoiced') {
    db.prepare("UPDATE sales_orders SET status = 'confirmed' WHERE id = ?").run(soId);
    fulfilSalesOrder(soId, { locationId: input.locationId, userId: input.userId });
  }
  if (input.status === 'invoiced') {
    const invoice = createInvoice({
      direction: 'sale',
      partnerId: input.customerId,
      issueDate: input.orderDate,
      dueDate: addDays(input.orderDate, 30),
      salesOrderId: soId,
      notes: `Tax invoice for sales order ${soId}`,
      lines: lines.map((line) => ({
        productId: line.productId,
        description: PRODUCTS.find((p) => p.sku === line.sku)?.name ?? line.sku,
        quantity: line.quantity,
        unitPriceCents: line.unitPrice,
        taxRateBp: 1500,
      })),
      post: true,
      userId: input.userId,
    }) as unknown as { id: number; total_cents: number };
    if (input.pay !== 'none') {
      recordPayment({
        partnerId: input.customerId,
        invoiceId: invoice.id,
        direction: 'in',
        paymentDate: input.orderDate,
        amountCents: input.pay === 'full' ? total : Math.round(total / 2),
        method: input.pay === 'full' ? 'eft' : 'card',
        reference: `RCPT-${invoice.id}`,
        userId: input.userId,
      });
    }
  }
  return soId;
}

function seedOpeningBalance(adminId: number): void {
  const existing = db
    .prepare("SELECT id FROM journal_entries WHERE reference = 'JB-OPENING'")
    .get() as { id: number } | undefined;
  if (existing) return;
  const bank = accountByCode('1000');
  const equity = accountByCode('3000');
  postJournalEntry({
    journalCode: 'GEN',
    entryDate: '2026-06-01',
    description: 'Opening bank balance',
    reference: 'JB-OPENING',
    userId: adminId,
    items: [
      { accountId: bank.id, debitCents: 25_000_000, description: 'Opening bank balance' },
      { accountId: equity.id, creditCents: 25_000_000, description: 'Owner capital' },
    ],
  });
}

function seedHistoricalInvoices(adminId: number): void {
  const customers = db
    .prepare(
      "SELECT id FROM partners WHERE is_customer = 1 AND name <> 'Walk-in Customer' ORDER BY id",
    )
    .all() as { id: number }[];
  const suppliers = db
    .prepare('SELECT id FROM partners WHERE is_supplier = 1 ORDER BY id')
    .all() as { id: number }[];
  if (customers.length === 0 || suppliers.length === 0) return;
  const months = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
  for (const [index, month] of months.entries()) {
    const customer = customers[index % customers.length]!;
    const picks = [
      PRODUCTS[(index * 2) % PRODUCTS.length]!,
      PRODUCTS[(index * 2 + 5) % PRODUCTS.length]!,
    ];
    const date = `${month}-${index === months.length - 1 ? '03' : '15'}`;
    const invoice = createInvoice({
      direction: 'sale',
      partnerId: customer.id,
      issueDate: date,
      dueDate: addDays(date, 30),
      notes: 'Jabulani demo historical sale',
      lines: picks.map((product, lineIndex) => ({
        productId: products.get(product.sku)!,
        description: product.name,
        quantity: lineIndex + 1 + (index % 3),
        unitPriceCents: product.price,
        taxRateBp: 1500,
      })),
      post: true,
      userId: adminId,
    }) as unknown as { id: number; total_cents: number };
    if (index < months.length - 1) {
      recordPayment({
        partnerId: customer.id,
        invoiceId: invoice.id,
        direction: 'in',
        paymentDate: addDays(date, 4),
        amountCents: invoice.total_cents,
        method: 'eft',
        reference: `RCPT-${invoice.id}`,
        userId: adminId,
      });
    }
    const supplier = suppliers[index % suppliers.length]!;
    const purchasePicks = [
      PRODUCTS[(index * 2 + 1) % PRODUCTS.length]!,
      PRODUCTS[(index * 2 + 7) % PRODUCTS.length]!,
    ];
    const bill = createInvoice({
      direction: 'purchase',
      partnerId: supplier.id,
      issueDate: `${month}-${index === months.length - 1 ? '02' : '12'}`,
      dueDate: addDays(`${month}-${index === months.length - 1 ? '02' : '12'}`, 30),
      notes: 'Jabulani demo historical purchase',
      lines: purchasePicks.map((product, lineIndex) => ({
        productId: products.get(product.sku)!,
        description: product.name,
        quantity: 2 + lineIndex + (index % 3),
        unitPriceCents: product.cost,
        taxRateBp: 1500,
      })),
      post: true,
      userId: adminId,
    }) as unknown as { id: number; total_cents: number };
    if (index < months.length - 1) {
      recordPayment({
        partnerId: supplier.id,
        invoiceId: bill.id,
        direction: 'out',
        paymentDate: addDays(`${month}-12`, 5),
        amountCents: bill.total_cents,
        method: 'eft',
        reference: `PAY-${bill.id}`,
        userId: adminId,
      });
    }
  }
}

function seedProjects(adminId: number): void {
  const projects = [
    {
      code: 'PRJ-JB-001',
      name: 'Sandton kitchen renovation',
      description: 'Custom kitchen with oak melamine carcasses and granite tops.',
      status: 'active',
      budget: 18500000,
    },
    {
      code: 'PRJ-JB-002',
      name: 'Rosebank walk-in wardrobe',
      description: 'Custom wardrobe with sliding doors and interior fittings.',
      status: 'active',
      budget: 7200000,
    },
    {
      code: 'PRJ-JB-003',
      name: 'East London office fit-out',
      description: 'Reception counter, boardroom table and storage.',
      status: 'planned',
      budget: 12500000,
    },
  ];
  for (const project of projects) {
    const existing = db.prepare('SELECT id FROM projects WHERE code = ?').get(project.code) as
      { id: number } | undefined;
    const id = existing
      ? existing.id
      : Number(
          db
            .prepare(
              `INSERT INTO projects (code, name, description, status, manager_id, start_date, end_date, budget_cents)
             VALUES (?, ?, ?, ?, ?, date('now', '-20 days'), date('now', '+40 days'), ?)`,
            )
            .run(
              project.code,
              project.name,
              project.description,
              project.status,
              adminId,
              project.budget,
            ).lastInsertRowid,
        );
    const taskCount = (
      db.prepare('SELECT COUNT(*) c FROM project_tasks WHERE project_id = ?').get(id) as {
        c: number;
      }
    ).c;
    if (taskCount === 0) {
      const insertTask = db.prepare(
        `INSERT INTO project_tasks (project_id, title, description, status, priority, due_date, estimated_hours)
         VALUES (?, ?, ?, ?, ?, date('now', '+14 days'), ?)`,
      );
      insertTask.run(id, 'Site measurement', 'Confirm dimensions and services.', 'done', 'high', 4);
      insertTask.run(
        id,
        'Cutting list & materials',
        'Prepare cutting list and issue materials.',
        'in_progress',
        'high',
        8,
      );
      insertTask.run(id, 'Installation', 'Install on site and snag.', 'todo', 'medium', 16);
    }
  }
}

function seedManufacturing(adminId: number, locationId: number): void {
  const workCenter = db
    .prepare("SELECT id FROM manufacturing_work_centers WHERE code = 'CNC'")
    .get() as { id: number } | undefined;
  const workCenterId = workCenter
    ? workCenter.id
    : Number(
        db
          .prepare(
            "INSERT INTO manufacturing_work_centers (name, code, cost_per_hour_cents, capacity_per_day) VALUES ('CNC & Edgebander', 'CNC', 45000, 8)",
          )
          .run().lastInsertRowid,
      );
  const operationNames = ['Cutting', 'Edging', 'Quality check'];
  const operationIds: number[] = [];
  for (const name of operationNames) {
    const existing = db
      .prepare('SELECT id FROM manufacturing_operations WHERE name = ?')
      .get(name) as { id: number } | undefined;
    const id = existing
      ? existing.id
      : Number(
          db
            .prepare(
              'INSERT INTO manufacturing_operations (name, work_center_id, duration_minutes) VALUES (?, ?, ?)',
            )
            .run(name, workCenterId, name === 'Quality check' ? 10 : 20).lastInsertRowid,
        );
    operationIds.push(id);
  }
  const finished = products.get('JB-FU-5002')!;
  const board = products.get('JB-BD-1001')!;
  const edging = products.get('JB-ED-2001')!;
  const bom = db.prepare("SELECT id FROM manufacturing_boms WHERE code = 'BOM-CUT-EDGE'").get() as
    { id: number } | undefined;
  const bomId = bom
    ? bom.id
    : Number(
        db
          .prepare(
            "INSERT INTO manufacturing_boms (code, product_id, quantity, notes) VALUES ('BOM-CUT-EDGE', ?, 1, 'Cut and edge materials for one floating shelf')",
          )
          .run(finished).lastInsertRowid,
      );
  if (!bom) {
    db.prepare(
      'INSERT INTO manufacturing_bom_lines (bom_id, product_id, quantity, sort) VALUES (?, ?, 1, 1)',
    ).run(bomId, board);
    db.prepare(
      'INSERT INTO manufacturing_bom_lines (bom_id, product_id, quantity, sort) VALUES (?, ?, 10, 2)',
    ).run(bomId, edging);
    operationIds.forEach((operationId, index) => {
      db.prepare(
        'INSERT INTO manufacturing_bom_operations (bom_id, operation_id, sequence) VALUES (?, ?, ?)',
      ).run(bomId, operationId, index + 1);
    });
  }
  const statuses = ['draft', 'confirmed', 'in_progress', 'done'] as const;
  for (const [index, status] of statuses.entries()) {
    const number = nextNumber('manufacturing_order');
    const order = db
      .prepare(
        `INSERT INTO manufacturing_orders
           (number, product_id, bom_id, quantity, status, priority, scheduled_date,
            source_location_id, destination_location_id, assigned_to, created_by)
         VALUES (?, ?, ?, 1, ?, 'high', date('now', '+2 days'), ?, ?, ?, ?)`,
      )
      .run(number, finished, bomId, status, locationId, locationId, adminId, adminId);
    const orderId = Number(order.lastInsertRowid);
    db.prepare(
      'INSERT INTO manufacturing_order_components (order_id, product_id, required_quantity, unit_cost_cents) VALUES (?, ?, 1, ?)',
    ).run(orderId, board, productCosts.get('JB-BD-1001')!);
    db.prepare(
      'INSERT INTO manufacturing_order_components (order_id, product_id, required_quantity, unit_cost_cents) VALUES (?, ?, 10, ?)',
    ).run(orderId, edging, productCosts.get('JB-ED-2001')!);
    operationIds.forEach((operationId, opIndex) => {
      db.prepare(
        `INSERT INTO manufacturing_order_operations (order_id, operation_id, work_center_id, name, sequence, status, duration_minutes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        orderId,
        operationId,
        workCenterId,
        operationNames[opIndex],
        opIndex + 1,
        status === 'done' ? 'done' : 'pending',
        opIndex === 0 ? 20 : opIndex === 1 ? 20 : 10,
      );
    });
    if (status === 'done') {
      recordMove({
        productId: board,
        locationId,
        quantity: -1,
        moveType: 'adjustment',
        referenceType: 'manufacturing_order',
        referenceId: orderId,
        unitCostCents: productCosts.get('JB-BD-1001')!,
        note: `Consumed by ${number}`,
        userId: adminId,
      });
      recordMove({
        productId: edging,
        locationId,
        quantity: -10,
        moveType: 'adjustment',
        referenceType: 'manufacturing_order',
        referenceId: orderId,
        unitCostCents: productCosts.get('JB-ED-2001')!,
        note: `Consumed by ${number}`,
        userId: adminId,
      });
      recordMove({
        productId: finished,
        locationId,
        quantity: 1,
        moveType: 'receipt',
        referenceType: 'manufacturing_order',
        referenceId: orderId,
        unitCostCents: productCosts.get('JB-BD-1001')! + productCosts.get('JB-ED-2001')! * 10,
        note: `Produced by ${number}`,
        userId: adminId,
      });
      db.prepare(
        "UPDATE manufacturing_orders SET started_at = datetime('now', '-1 day'), finished_at = datetime('now'), material_cost_cents = ?, operation_cost_cents = 37500, total_cost_cents = ? WHERE id = ?",
      ).run(
        productCosts.get('JB-BD-1001')! + productCosts.get('JB-ED-2001')! * 10,
        productCosts.get('JB-BD-1001')! + productCosts.get('JB-ED-2001')! * 10 + 37500,
        orderId,
      );
    }
  }
}

function seedPos(adminId: number, locationId: number): void {
  const register = db
    .prepare("SELECT id, location_id FROM pos_registers WHERE code = 'MAIN'")
    .get() as { id: number; location_id: number | null } | undefined;
  if (!register) return;
  const walkIn = partner({ name: 'Walk-in Customer', customer: true });
  const session = db
    .prepare(
      `INSERT INTO pos_sessions (register_id, opened_by, opened_at, opening_float_cents, expected_cash_cents, difference_cents, status, notes)
     VALUES (?, ?, datetime('now', '-2 hours'), 50000, 0, 0, 'open', 'Jabulani demo session')`,
    )
    .run(register.id, adminId);
  const sessionId = Number(session.lastInsertRowid);
  const orders = [
    {
      method: 'cash' as const,
      lines: [
        { sku: 'JB-BD-1001', quantity: 2 },
        { sku: 'JB-ED-2001', quantity: 1 },
      ],
    },
    {
      method: 'card' as const,
      lines: [
        { sku: 'JB-HW-3001', quantity: 10 },
        { sku: 'JB-HW-3003', quantity: 4 },
      ],
    },
    { method: 'cash' as const, lines: [{ sku: 'JB-DC-4001', quantity: 2 }] },
  ];
  let cashSales = 0;
  for (const order of orders) {
    const lines = order.lines.map((line) => {
      const product = PRODUCTS.find((candidate) => candidate.sku === line.sku)!;
      const totals = lineTotals(line.quantity, product.price, 1500);
      return { product, quantity: line.quantity, totals };
    });
    const subtotal = lines.reduce((total, line) => total + line.totals.subtotalCents, 0);
    const tax = lines.reduce((total, line) => total + line.totals.taxCents, 0);
    const total = subtotal + tax;
    const number = nextNumber('pos_order');
    const result = db
      .prepare(
        `INSERT INTO pos_orders (number, session_id, register_id, customer_id, payment_method, subtotal_cents, tax_cents, total_cents, amount_tendered_cents, change_cents, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'paid', ?)`,
      )
      .run(
        number,
        sessionId,
        register.id,
        walkIn,
        order.method,
        subtotal,
        tax,
        total,
        total,
        adminId,
      );
    const orderId = Number(result.lastInsertRowid);
    const invoice = createInvoice({
      direction: 'sale',
      partnerId: walkIn,
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date().toISOString().slice(0, 10),
      notes: `POS sale ${number}`,
      lines: lines.map((line) => ({
        productId: products.get(line.product.sku)!,
        description: line.product.name,
        quantity: line.quantity,
        unitPriceCents: line.product.price,
        taxRateBp: 1500,
      })),
      post: true,
      userId: adminId,
    }) as unknown as { id: number };
    const payment = recordPayment({
      partnerId: walkIn,
      invoiceId: invoice.id,
      direction: 'in',
      paymentDate: new Date().toISOString().slice(0, 10),
      amountCents: total,
      method: order.method,
      reference: number,
      userId: adminId,
    }) as unknown as { id: number };
    const insertLine = db.prepare(
      `INSERT INTO pos_order_lines (order_id, product_id, description, quantity, unit_price_cents, tax_rate_bp, line_subtotal_cents, line_tax_cents, line_total_cents)
       VALUES (?, ?, ?, ?, ?, 1500, ?, ?, ?)`,
    );
    for (const line of lines) {
      insertLine.run(
        orderId,
        products.get(line.product.sku)!,
        line.product.name,
        line.quantity,
        line.product.price,
        line.totals.subtotalCents,
        line.totals.taxCents,
        line.totals.totalCents,
      );
      recordMove({
        productId: products.get(line.product.sku)!,
        locationId: register.location_id ?? locationId,
        quantity: -line.quantity,
        moveType: 'sale',
        referenceType: 'pos_order',
        referenceId: orderId,
        unitCostCents: line.product.cost,
        note: `POS sale ${number}`,
        userId: adminId,
      });
    }
    db.prepare('UPDATE pos_orders SET invoice_id = ?, payment_id = ? WHERE id = ?').run(
      invoice.id,
      payment.id,
      orderId,
    );
    if (order.method === 'cash') cashSales += total;
  }
  db.prepare('UPDATE pos_sessions SET expected_cash_cents = ? WHERE id = ?').run(
    50000 + cashSales,
    sessionId,
  );
}

function seedWebsite(adminId: number): void {
  const page = db.prepare("SELECT id FROM website_pages WHERE slug = 'about-us'").get() as
    { id: number } | undefined;
  if (!page) {
    db.prepare(
      `INSERT INTO website_pages (title, slug, content, status, published_at, meta_title)
       VALUES ('About Jabulani Boards', 'about-us', ?, 'published', date('now'), 'About Jabulani Boards')`,
    ).run(
      `Jabulani Boards supplies boards, hardware and decorative products from our Johannesburg and Eastern Cape branches.\n\nWe cut and edge boards to size, and design and install custom furniture, kitchens and shopfitting. From a single shelf to a full kitchen, our team handles the cutting list, materials, manufacturing and installation.`,
    );
  }
  const menu = db
    .prepare("SELECT id FROM website_menu_items WHERE path = '/site/about-us'")
    .get() as { id: number } | undefined;
  if (!menu) {
    db.prepare(
      "INSERT INTO website_menu_items (label, path, sort) VALUES ('About', '/site/about-us', 1)",
    ).run();
    db.prepare(
      "INSERT INTO website_menu_items (label, path, sort) VALUES ('Blog', '/blog', 2)",
    ).run();
  }
  const categoryRow = db
    .prepare("SELECT id FROM blog_categories WHERE slug = 'product-news'")
    .get() as { id: number } | undefined;
  const categoryId = categoryRow
    ? categoryRow.id
    : Number(
        db
          .prepare(
            "INSERT INTO blog_categories (name, slug) VALUES ('Product news', 'product-news')",
          )
          .run().lastInsertRowid,
      );
  const post = db
    .prepare("SELECT id FROM blog_posts WHERE slug = 'new-oak-melamine-range'")
    .get() as { id: number } | undefined;
  if (!post) {
    db.prepare(
      `INSERT INTO blog_posts (title, slug, excerpt, content, category_id, author_id, status, published_at)
       VALUES ('New oak melamine range', 'new-oak-melamine-range', 'Warm oak tones for kitchens and built-in cupboards.', ?, ?, ?, 'published', date('now'))`,
    ).run(
      'Our new oak melamine range is now in stock at both branches. Pair it with matching ABS edging for a durable, consistent finish on kitchen carcasses, wardrobes and shopfitting.',
      categoryId,
      adminId,
    );
  }
}

function seedOperations(adminId: number): void {
  const expenseCount = db.prepare('SELECT COUNT(*) AS count FROM expenses').get() as {
    count: number;
  };
  if (expenseCount.count === 0) {
    const insertExpense = db.prepare(
      `INSERT INTO expenses
         (number, expense_date, category, description, amount_cents, tax_cents, total_cents,
          payment_method, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const expenses: [string, string, number, string, string][] = [
      ['2026-10-01', 'Rent', 1_800_000, 'bank', 'Workshop and yard rent — October'],
      ['2026-10-03', 'Utilities', 420_000, 'bank', 'City Power and water — October'],
      ['2026-10-08', 'Transport', 185_000, 'card', 'Deliveries to Rosebank and Sandton sites'],
      ['2026-10-15', 'Consumables', 96_500, 'cash', 'Glue, screws and workshop consumables'],
      ['2026-10-25', 'Repairs', 240_000, 'bank', 'Edgebander service and blade replacement'],
    ];
    for (const [date, category, net, method, description] of expenses) {
      const tax = Math.round(net * 0.15);
      insertExpense.run(
        nextNumber('expense'),
        date,
        category,
        description,
        net,
        tax,
        net + tax,
        method,
        'draft',
        adminId,
      );
    }
  }

  const attendanceCount = db.prepare('SELECT COUNT(*) AS count FROM attendance').get() as {
    count: number;
  };
  if (attendanceCount.count === 0) {
    const employees = db
      .prepare("SELECT id, email FROM employees WHERE status <> 'terminated'")
      .all() as { id: number; email: string | null }[];
    const insertAttendance = db.prepare(
      `INSERT OR IGNORE INTO attendance
         (employee_id, work_date, clock_in, clock_out, status, hours)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const days = ['2026-11-03', '2026-11-04', '2026-11-05'];
    for (const employee of employees) {
      days.forEach((date, index) => {
        const late = index === 1 && employee.email === 'thabo@jabulani.local';
        insertAttendance.run(
          employee.id,
          date,
          late ? '08:22' : '07:55',
          '17:05',
          late ? 'late' : 'present',
          9,
        );
      });
    }
  }

  const bankCount = db.prepare('SELECT COUNT(*) AS count FROM bank_accounts').get() as {
    count: number;
  };
  if (bankCount.count === 0) {
    const bank = accountByCode('1000');
    const result = db
      .prepare(
        `INSERT INTO bank_accounts (name, bank_name, account_number, gl_account_id, opening_balance_cents)
         VALUES ('FNB Business Current', 'FNB', '62710001234', ?, ?)`,
      )
      .run(bank.id, 25_000_000);
    const bankAccountId = Number(result.lastInsertRowid);
    const insertTransaction = db.prepare(
      `INSERT INTO bank_transactions
         (bank_account_id, transaction_date, description, reference, amount_cents)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const transactions: [string, string, string, number][] = [
      ['2026-10-28', 'EFT — Highveld Shopfitters', 'INV-00021', 2_150_000],
      ['2026-10-30', 'EFT — Sandton Interiors', 'INV-00022', 890_000],
      ['2026-11-01', 'Bank charges', 'FNB-FEE', -18_500],
      ['2026-11-02', 'EFT — City Power', 'ELEC-OCT', -483_000],
      ['2026-11-04', 'Card settlement', 'POS-BATCH', 1_245_000],
    ];
    for (const [date, description, reference, amount] of transactions) {
      insertTransaction.run(bankAccountId, date, description, reference, amount);
    }
  }
}

function main(): void {
  const adminId = createUser('admin@jabulani.local', 'Jabulani', 'Admin', 'admin');
  const salesUserId = createUser('sales@jabulani.local', 'Thabo', 'Sales', 'sales');
  const warehouseUserId = createUser('workshop@jabulani.local', 'Sipho', 'Workshop', 'warehouse');
  const accountsUserId = createUser('accounts@jabulani.local', 'Naledi', 'Accounts', 'accountant');
  const employeeUserId = createUser('thabo@jabulani.local', 'Thabo', 'Mokoena', 'employee');
  createUser('workshop.lead@jabulani.local', 'Sipho', 'Workshop', 'workshop');

  createEmployee({
    firstName: 'Jabulani',
    lastName: 'Admin',
    email: 'admin@jabulani.local',
    department: 'Management',
    jobTitle: 'Managing Director',
    salaryCents: 4_800_000,
    startDate: '2023-01-10',
    userId: adminId,
  });
  createEmployee({
    firstName: 'Thabo',
    lastName: 'Mokoena',
    email: 'thabo@jabulani.local',
    department: 'Sales',
    jobTitle: 'Sales Manager',
    salaryCents: 3_500_000,
    startDate: '2023-03-01',
    userId: employeeUserId,
  });
  createEmployee({
    firstName: 'Sipho',
    lastName: 'Dlamini',
    email: 'sipho@jabulani.local',
    department: 'Workshop',
    jobTitle: 'Workshop Manager',
    salaryCents: 3_200_000,
    startDate: '2023-04-01',
    userId: warehouseUserId,
  });
  createEmployee({
    firstName: 'Naledi',
    lastName: 'Khumalo',
    email: 'naledi@jabulani.local',
    department: 'Finance',
    jobTitle: 'Finance Manager',
    salaryCents: 3_400_000,
    startDate: '2023-05-01',
    userId: accountsUserId,
  });
  createEmployee({
    firstName: 'Lerato',
    lastName: 'Mahlangu',
    email: 'lerato@jabulani.local',
    department: 'Workshop',
    jobTitle: 'CNC Operator',
    salaryCents: 2_600_000,
    startDate: '2024-02-01',
  });
  createEmployee({
    firstName: 'Andile',
    lastName: 'Ndlovu',
    email: 'andile@jabulani.local',
    department: 'Workshop',
    jobTitle: 'Installer',
    salaryCents: 2_400_000,
    startDate: '2024-06-01',
  });

  setting('company_name', 'Jabulani Boards');
  setting('company_logo', '/jabulani-logo.svg');
  setting('company_registration', '2019/123456/07');
  setting('company_vat_number', '4987654321');
  setting('company_email', 'info@jabulaniboards.co.za');
  setting('company_phone', '+27 11 555 0199');
  setting('company_address', '14 Booysens Road, Selby, Johannesburg, 2001');
  setting('website_tagline', 'Boards, cutting, edging and custom interiors.');
  setting('invoice_due_days', '30');
  setting('vat_rate_bp', '1500');

  insertProducts();
  const locations = stockLocations();
  openingStock(locations.jhb, locations.ec, adminId);

  const customers = [
    partner({
      name: 'Sandton Builders',
      customer: true,
      email: 'orders@sandtonbuilders.test',
      phone: '011 555 3101',
      city: 'Johannesburg',
      vat: '4210101010',
      credit: 3500000,
      terms: 30,
    }),
    partner({
      name: 'Rosebank Interiors',
      customer: true,
      email: 'projects@rosebankinteriors.test',
      phone: '011 555 3102',
      city: 'Johannesburg',
      vat: '4220202020',
      credit: 4500000,
      terms: 30,
    }),
    partner({
      name: 'Kitchen Studio JHB',
      customer: true,
      email: 'orders@kitchenstudio.test',
      phone: '011 555 3103',
      city: 'Johannesburg',
      vat: '4230303030',
      credit: 6000000,
      terms: 45,
    }),
    partner({
      name: 'East London Contractors',
      customer: true,
      email: 'buying@elcontractors.test',
      phone: '043 555 3104',
      city: 'East London',
      vat: '4240404040',
      credit: 3000000,
      terms: 30,
    }),
    partner({
      name: 'Mthatha Furniture',
      customer: true,
      email: 'info@mthathafurniture.test',
      phone: '047 555 3105',
      city: 'Mthatha',
      vat: '4250505050',
      credit: 2000000,
      terms: 30,
    }),
    partner({
      name: 'Gqeberha Installations',
      customer: true,
      email: 'install@gqeberhainstall.test',
      phone: '041 555 3106',
      city: 'Gqeberha',
      vat: '4260606060',
      credit: 2500000,
      terms: 30,
    }),
    partner({
      name: 'Highveld Shopfitters',
      customer: true,
      email: 'projects@highveldshopfitters.test',
      phone: '011 555 3107',
      city: 'Johannesburg',
      vat: '4270707070',
      credit: 5000000,
      terms: 45,
    }),
    partner({ name: 'Walk-in Customer', customer: true }),
  ];

  const suppliers = [
    partner({
      name: 'PG Bison',
      supplier: true,
      email: 'orders@pgbison.test',
      phone: '011 555 4101',
      city: 'Johannesburg',
      vat: '5110101010',
      terms: 30,
    }),
    partner({
      name: 'Sonae Arauco',
      supplier: true,
      email: 'orders@sonae.test',
      phone: '011 555 4102',
      city: 'Johannesburg',
      vat: '5120202020',
      terms: 30,
    }),
    partner({
      name: 'Arauco South Africa',
      supplier: true,
      email: 'sales@arauco.test',
      phone: '031 555 4103',
      city: 'Durban',
      vat: '5130303030',
      terms: 30,
    }),
    partner({
      name: 'Hafele South Africa',
      supplier: true,
      email: 'orders@hafele.test',
      phone: '011 555 4104',
      city: 'Johannesburg',
      vat: '5140404040',
      terms: 30,
    }),
    partner({
      name: 'Blum South Africa',
      supplier: true,
      email: 'orders@blum.test',
      phone: '011 555 4105',
      city: 'Johannesburg',
      vat: '5150505050',
      terms: 30,
    }),
    partner({
      name: 'Edgeband Supplies',
      supplier: true,
      email: 'sales@edgeband.test',
      phone: '011 555 4106',
      city: 'Johannesburg',
      vat: '5160606060',
      terms: 30,
    }),
  ];

  const [sandton, rosebank, kitchenStudio, eastLondon, mthatha, gqeberha, highveld] = customers;
  const [pgBison, sonae, arauco, hafele, blum, edgeband] = suppliers;

  createPurchaseOrder({
    supplierId: pgBison!,
    orderDate: '2026-10-18',
    expectedDate: '2026-10-22',
    status: 'received',
    lines: [
      { sku: 'JB-BD-1001', quantity: 30 },
      { sku: 'JB-BD-1002', quantity: 20 },
      { sku: 'JB-BD-1008', quantity: 15 },
    ],
    userId: adminId,
    locationId: locations.jhb,
    pay: 'full',
  });
  createPurchaseOrder({
    supplierId: sonae!,
    orderDate: '2026-10-24',
    expectedDate: '2026-10-29',
    status: 'received',
    lines: [
      { sku: 'JB-BD-1003', quantity: 15 },
      { sku: 'JB-BD-1004', quantity: 15 },
    ],
    userId: adminId,
    locationId: locations.jhb,
    pay: 'partial',
  });
  createPurchaseOrder({
    supplierId: hafele!,
    orderDate: '2026-10-30',
    expectedDate: '2026-11-05',
    status: 'confirmed',
    lines: [
      { sku: 'JB-HW-3001', quantity: 100 },
      { sku: 'JB-HW-3002', quantity: 40 },
      { sku: 'JB-HW-3003', quantity: 60 },
    ],
    userId: adminId,
    locationId: locations.jhb,
    pay: 'none',
  });
  createPurchaseOrder({
    supplierId: edgeband!,
    orderDate: '2026-11-02',
    expectedDate: '2026-11-06',
    status: 'draft',
    lines: [
      { sku: 'JB-ED-2001', quantity: 20 },
      { sku: 'JB-ED-2002', quantity: 20 },
    ],
    userId: adminId,
    locationId: locations.ec,
    pay: 'none',
  });
  createPurchaseOrder({
    supplierId: arauco!,
    orderDate: '2026-10-20',
    expectedDate: '2026-10-25',
    status: 'received',
    lines: [
      { sku: 'JB-BD-1005', quantity: 25 },
      { sku: 'JB-BD-1006', quantity: 20 },
    ],
    userId: adminId,
    locationId: locations.ec,
    pay: 'full',
  });

  createSalesOrder({
    customerId: sandton!,
    orderDate: '2026-11-03',
    status: 'draft',
    lines: [
      { sku: 'JB-BD-1001', quantity: 10 },
      { sku: 'JB-ED-2001', quantity: 2 },
    ],
    userId: adminId,
    locationId: locations.jhb,
    pay: 'none',
  });
  createSalesOrder({
    customerId: rosebank!,
    orderDate: '2026-11-02',
    status: 'confirmed',
    lines: [
      { sku: 'JB-BD-1002', quantity: 6 },
      { sku: 'JB-HW-3001', quantity: 20 },
    ],
    userId: adminId,
    locationId: locations.jhb,
    pay: 'none',
  });
  createSalesOrder({
    customerId: kitchenStudio!,
    orderDate: '2026-10-28',
    status: 'fulfilled',
    lines: [
      { sku: 'JB-BD-1003', quantity: 4 },
      { sku: 'JB-ED-2003', quantity: 2 },
    ],
    userId: adminId,
    locationId: locations.jhb,
    pay: 'none',
  });
  createSalesOrder({
    customerId: eastLondon!,
    orderDate: '2026-10-29',
    status: 'fulfilled',
    lines: [
      { sku: 'JB-BD-1005', quantity: 8 },
      { sku: 'JB-HW-3002', quantity: 4 },
    ],
    userId: adminId,
    locationId: locations.ec,
    pay: 'none',
  });
  createSalesOrder({
    customerId: mthatha!,
    orderDate: '2026-10-25',
    status: 'invoiced',
    lines: [
      { sku: 'JB-BD-1006', quantity: 6 },
      { sku: 'JB-ED-2001', quantity: 2 },
    ],
    userId: adminId,
    locationId: locations.ec,
    pay: 'full',
  });
  createSalesOrder({
    customerId: gqeberha!,
    orderDate: '2026-10-27',
    status: 'invoiced',
    lines: [
      { sku: 'JB-DC-4001', quantity: 3 },
      { sku: 'JB-DC-4004', quantity: 2 },
    ],
    userId: adminId,
    locationId: locations.ec,
    pay: 'partial',
  });
  createSalesOrder({
    customerId: highveld!,
    orderDate: '2026-10-30',
    status: 'invoiced',
    lines: [
      { sku: 'JB-BD-1002', quantity: 8 },
      { sku: 'JB-HW-3001', quantity: 30 },
    ],
    userId: adminId,
    locationId: locations.jhb,
    pay: 'full',
  });

  const counter = createInvoice({
    direction: 'sale',
    partnerId: customers[7]!,
    issueDate: '2026-11-04',
    dueDate: '2026-11-18',
    notes: 'Counter sale — cut and edge',
    lines: [
      {
        productId: products.get('JB-SV-6001')!,
        description: 'Cutting & Edging Service (per sheet)',
        quantity: 4,
        unitPriceCents: productPrices.get('JB-SV-6001')!,
        taxRateBp: 1500,
      },
      {
        productId: products.get('JB-ED-2001')!,
        description: 'ABS Edging 22mm White 50m',
        quantity: 1,
        unitPriceCents: productPrices.get('JB-ED-2001')!,
        taxRateBp: 1500,
      },
    ],
    post: true,
    userId: adminId,
  }) as unknown as { id: number; total_cents: number };
  recordPayment({
    partnerId: customers[7]!,
    invoiceId: counter.id,
    direction: 'in',
    paymentDate: '2026-11-04',
    amountCents: counter.total_cents,
    method: 'card',
    reference: `RCPT-${counter.id}`,
    userId: adminId,
  });

  seedOpeningBalance(adminId);
  seedHistoricalInvoices(adminId);
  seedProjects(adminId);
  seedManufacturing(adminId, locations.jhb);
  seedPos(adminId, locations.jhb);
  seedWebsite(adminId);
  seedOperations(adminId);

  console.log('Jabulani Boards demo data ready.');
  console.log(`Login: admin@jabulani.local / ${PASSWORD}`);
  console.log('Also: sales@, workshop@, accounts@ with the same password.');
}

main();
closeDb();
