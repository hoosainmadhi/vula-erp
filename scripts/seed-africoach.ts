import bcrypt from 'bcrypt';
import { closeDb, getDb } from '../src/db.js';
import { nextNumber } from '../src/services/sequences.js';
import { recordMove, receivePurchaseOrder, fulfilSalesOrder } from '../src/services/stock.js';
import { createInvoice, recordPayment } from '../src/services/invoices.js';
import { accountByCode } from '../src/services/accounting.js';
import { lineTotals } from '../src/utils/money.js';
import { addDays } from '../src/utils/dates.js';

const db = getDb();
const PASSWORD = 'AfricoachDemo2026!';

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
  const result = db.prepare('INSERT INTO product_categories (name) VALUES (?)').run(name);
  return Number(result.lastInsertRowid);
}

interface ProductSeed {
  sku: string;
  name: string;
  category: string;
  brand: string;
  fit: string;
  cost: number;
  price: number;
  uom?: string;
  barcode: string;
  jhb: number;
  cpt: number;
  reorder?: number;
}

const PRODUCTS: ProductSeed[] = [
  {
    sku: 'AC-BP-1001',
    name: 'MIRROR ARM LONG LH 640x442mm',
    category: 'Body Parts',
    brand: 'Hella',
    fit: 'Marcopolo, Busscar, Irizar',
    cost: 48500,
    price: 79900,
    barcode: '6001001000011',
    jhb: 24,
    cpt: 10,
  },
  {
    sku: 'AC-BP-1002',
    name: 'MIRROR ARM EXTRA LONG LH 780x630mm',
    category: 'Body Parts',
    brand: 'Hella',
    fit: 'Marcopolo, Volvo',
    cost: 62000,
    price: 104900,
    barcode: '6001001000028',
    jhb: 12,
    cpt: 6,
  },
  {
    sku: 'AC-BP-1003',
    name: 'MIRROR HEAD 220x320mm',
    category: 'Body Parts',
    brand: 'Farba',
    fit: 'Universal bus',
    cost: 21000,
    price: 36500,
    barcode: '6001001000035',
    jhb: 30,
    cpt: 14,
  },
  {
    sku: 'AC-BP-1004',
    name: 'DOOR LOCK LH HEAVY DUTY',
    category: 'Body Parts',
    brand: 'Seger',
    fit: 'Busscar, Caio',
    cost: 18500,
    price: 32900,
    barcode: '6001001000042',
    jhb: 18,
    cpt: 8,
  },
  {
    sku: 'AC-BP-1005',
    name: 'LUGGAGE LOCK WITH KEY',
    category: 'Body Parts',
    brand: 'Seger',
    fit: 'Marcopolo, Irizar',
    cost: 12500,
    price: 22900,
    barcode: '6001001000059',
    jhb: 40,
    cpt: 15,
  },
  {
    sku: 'AC-BP-1006',
    name: 'WHEEL CAP 22.5" CHROME',
    category: 'Body Parts',
    brand: 'Africoach',
    fit: '22.5 inch wheels',
    cost: 28000,
    price: 49900,
    barcode: '6001001000066',
    jhb: 16,
    cpt: 8,
  },
  {
    sku: 'AC-BP-1007',
    name: 'WHEEL CAP 19.5" CHROME',
    category: 'Body Parts',
    brand: 'Africoach',
    fit: '19.5 inch wheels',
    cost: 24000,
    price: 42900,
    barcode: '6001001000073',
    jhb: 20,
    cpt: 9,
  },
  {
    sku: 'AC-BP-1008',
    name: 'ALUMINIUM STEP PROFILE 3m',
    category: 'Body Parts',
    brand: 'AluPro',
    fit: 'Bus entry steps',
    cost: 16500,
    price: 28900,
    uom: 'length',
    barcode: '6001001000080',
    jhb: 35,
    cpt: 18,
  },
  {
    sku: 'AC-BP-1009',
    name: 'WINDSCREEN RUBBER 12m ROLL',
    category: 'Body Parts',
    brand: 'Rubbertec',
    fit: 'Universal bus',
    cost: 32000,
    price: 54900,
    uom: 'roll',
    barcode: '6001001000097',
    jhb: 10,
    cpt: 5,
  },
  {
    sku: 'AC-BP-1010',
    name: 'BUMPER MARCOPOLO FRONT',
    category: 'Body Parts',
    brand: 'Marcopolo',
    fit: 'Marcopolo G7',
    cost: 145000,
    price: 239900,
    barcode: '6001001000103',
    jhb: 4,
    cpt: 2,
  },
  {
    sku: 'AC-IN-2001',
    name: 'LED INTERIOR LIGHT 12-24V',
    category: 'Interior',
    brand: 'Lumex',
    fit: 'Universal bus',
    cost: 9500,
    price: 17900,
    barcode: '6001001000110',
    jhb: 80,
    cpt: 40,
  },
  {
    sku: 'AC-IN-2002',
    name: 'STANDARD INTERIOR LIGHT',
    category: 'Interior',
    brand: 'Lumex',
    fit: 'Universal bus',
    cost: 6500,
    price: 11900,
    barcode: '6001001000127',
    jhb: 60,
    cpt: 30,
  },
  {
    sku: 'AC-IN-2003',
    name: 'USB CHARGER 12-24V DUAL',
    category: 'Interior',
    brand: 'VoltEdge',
    fit: 'Universal bus',
    cost: 8500,
    price: 15900,
    barcode: '6001001000134',
    jhb: 45,
    cpt: 20,
  },
  {
    sku: 'AC-IN-2004',
    name: 'REVERSE CAMERA 7" MONITOR KIT',
    category: 'Interior',
    brand: 'RoadVision',
    fit: 'Universal bus',
    cost: 68000,
    price: 119900,
    uom: 'set',
    barcode: '6001001000141',
    jhb: 12,
    cpt: 6,
  },
  {
    sku: 'AC-IN-2005',
    name: 'DRIVER SEAT HIGH BACK',
    category: 'Interior',
    brand: 'Sege',
    fit: 'Marcopolo, Busscar',
    cost: 210000,
    price: 349900,
    barcode: '6001001000158',
    jhb: 6,
    cpt: 3,
  },
  {
    sku: 'AC-IN-2006',
    name: 'PASSENGER SEAT WITH ARMREST',
    category: 'Interior',
    brand: 'Sege',
    fit: 'Coach interior',
    cost: 165000,
    price: 279900,
    barcode: '6001001000165',
    jhb: 10,
    cpt: 4,
  },
  {
    sku: 'AC-IN-2007',
    name: 'SAFETY BELT 3-POINT',
    category: 'Interior',
    brand: 'SafeRide',
    fit: 'Universal bus',
    cost: 12500,
    price: 22900,
    barcode: '6001001000172',
    jhb: 50,
    cpt: 25,
  },
  {
    sku: 'AC-IN-2008',
    name: 'RUBBER FLOORING 1.4m WIDTH',
    category: 'Interior',
    brand: 'Rubbertec',
    fit: 'Bus aisle',
    cost: 18500,
    price: 32900,
    uom: 'metre',
    barcode: '6001001000189',
    jhb: 100,
    cpt: 50,
  },
  {
    sku: 'AC-IN-2009',
    name: 'MANUAL ROLLER BLIND',
    category: 'Interior',
    brand: 'ShadePro',
    fit: 'Coach windows',
    cost: 14500,
    price: 25900,
    barcode: '6001001000196',
    jhb: 22,
    cpt: 11,
  },
  {
    sku: 'AC-IN-2010',
    name: 'ROOF VENT WITH FAN',
    category: 'Interior',
    brand: 'VentAir',
    fit: 'Universal bus',
    cost: 42000,
    price: 74900,
    barcode: '6001001000202',
    jhb: 9,
    cpt: 4,
  },
  {
    sku: 'AC-EL-3001',
    name: 'HEADLIGHT GLOBE H4 24V',
    category: 'Electrical',
    brand: 'Hella',
    fit: 'Universal bus',
    cost: 3500,
    price: 6900,
    barcode: '6001001000219',
    jhb: 120,
    cpt: 60,
  },
  {
    sku: 'AC-EL-3002',
    name: 'LED WORK LAMP 12-24V 27W',
    category: 'Electrical',
    brand: 'Lumex',
    fit: 'Universal bus',
    cost: 12500,
    price: 22900,
    barcode: '6001001000226',
    jhb: 55,
    cpt: 25,
  },
  {
    sku: 'AC-EL-3003',
    name: 'WIPER MOTOR 24V',
    category: 'Electrical',
    brand: 'Bosch',
    fit: 'Marcopolo, Busscar',
    cost: 78000,
    price: 134900,
    barcode: '6001001000233',
    jhb: 8,
    cpt: 4,
  },
  {
    sku: 'AC-EL-3004',
    name: 'WIPER BLADE 700mm',
    category: 'Electrical',
    brand: 'Bosch',
    fit: 'Universal bus',
    cost: 5500,
    price: 9900,
    uom: 'pair',
    barcode: '6001001000240',
    jhb: 70,
    cpt: 35,
  },
  {
    sku: 'AC-EL-3005',
    name: 'ALTERNATOR 24V 80A',
    category: 'Electrical',
    brand: 'Valeo',
    fit: 'Yutong, Volvo',
    cost: 285000,
    price: 479900,
    barcode: '6001001000257',
    jhb: 5,
    cpt: 2,
  },
  {
    sku: 'AC-EL-3006',
    name: 'STARTER MOTOR 24V',
    category: 'Electrical',
    brand: 'Valeo',
    fit: 'Yutong, MAN',
    cost: 245000,
    price: 419900,
    barcode: '6001001000264',
    jhb: 4,
    cpt: 2,
  },
  {
    sku: 'AC-EL-3007',
    name: 'RELAY 24V 40A',
    category: 'Electrical',
    brand: 'Hella',
    fit: 'Universal bus',
    cost: 3200,
    price: 5900,
    barcode: '6001001000271',
    jhb: 90,
    cpt: 45,
  },
  {
    sku: 'AC-EL-3008',
    name: 'BLADE FUSE KIT 24V',
    category: 'Electrical',
    brand: 'Hella',
    fit: 'Universal bus',
    cost: 4500,
    price: 8500,
    uom: 'set',
    barcode: '6001001000288',
    jhb: 40,
    cpt: 20,
  },
  {
    sku: 'AC-EL-3009',
    name: 'AIR HORN CHROME',
    category: 'Electrical',
    brand: 'Hella',
    fit: 'Universal bus',
    cost: 22000,
    price: 38900,
    barcode: '6001001000295',
    jhb: 18,
    cpt: 9,
  },
  {
    sku: 'AC-EL-3010',
    name: 'ROCKER SWITCH 24V',
    category: 'Electrical',
    brand: 'Hella',
    fit: 'Universal bus',
    cost: 2800,
    price: 5200,
    barcode: '6001001000301',
    jhb: 100,
    cpt: 50,
  },
  {
    sku: 'AC-EC-4001',
    name: 'PARABOLIC SPRING 3-LEAF',
    category: 'Engine & Chassis',
    brand: 'SpringWorks',
    fit: 'Bus rear axle',
    cost: 165000,
    price: 279900,
    barcode: '6001001000318',
    jhb: 6,
    cpt: 3,
  },
  {
    sku: 'AC-EC-4002',
    name: 'STEERING WHEEL 450mm',
    category: 'Engine & Chassis',
    brand: 'Marcopolo',
    fit: 'Marcopolo, Busscar',
    cost: 95000,
    price: 164900,
    barcode: '6001001000325',
    jhb: 7,
    cpt: 3,
  },
  {
    sku: 'AC-EC-4003',
    name: 'KINGPIN KIT',
    category: 'Engine & Chassis',
    brand: 'SKF',
    fit: 'Bus front axle',
    cost: 42000,
    price: 74900,
    uom: 'set',
    barcode: '6001001000332',
    jhb: 14,
    cpt: 7,
  },
  {
    sku: 'AC-EC-4004',
    name: 'TOW BAR HEAVY DUTY',
    category: 'Engine & Chassis',
    brand: 'Africoach',
    fit: 'Coach chassis',
    cost: 135000,
    price: 224900,
    barcode: '6001001000349',
    jhb: 5,
    cpt: 2,
  },
  {
    sku: 'AC-EC-4005',
    name: 'TRAILER PLUG 7-PIN',
    category: 'Engine & Chassis',
    brand: 'Hella',
    fit: 'Universal',
    cost: 4500,
    price: 8500,
    barcode: '6001001000356',
    jhb: 60,
    cpt: 30,
  },
  {
    sku: 'AC-EC-4006',
    name: 'TYRE 295/80R22.5',
    category: 'Engine & Chassis',
    brand: 'Michelin',
    fit: 'Coach drive axle',
    cost: 385000,
    price: 549900,
    barcode: '6001001000363',
    jhb: 8,
    cpt: 4,
  },
  {
    sku: 'AC-MT-5001',
    name: 'WARNING TRIANGLE',
    category: 'Maintenance',
    brand: 'SafeRoad',
    fit: 'Universal',
    cost: 4500,
    price: 8500,
    barcode: '6001001000370',
    jhb: 40,
    cpt: 20,
  },
  {
    sku: 'AC-MT-5002',
    name: 'FIRE EXTINGUISHER 1kg',
    category: 'Maintenance',
    brand: 'FireSafe',
    fit: 'Universal',
    cost: 18500,
    price: 31900,
    barcode: '6001001000387',
    jhb: 25,
    cpt: 12,
  },
  {
    sku: 'AC-MT-5003',
    name: 'FIRST AID KIT',
    category: 'Maintenance',
    brand: 'MedKit',
    fit: 'Universal',
    cost: 12500,
    price: 21900,
    barcode: '6001001000394',
    jhb: 30,
    cpt: 15,
  },
  {
    sku: 'AC-MT-5004',
    name: 'SIKAFLEX 221 WHITE',
    category: 'Maintenance',
    brand: 'Sika',
    fit: 'Body sealing',
    cost: 9500,
    price: 16900,
    barcode: '6001001000400',
    jhb: 80,
    cpt: 40,
  },
  {
    sku: 'AC-MT-5005',
    name: 'MASKING TAPE 48mm',
    category: 'Maintenance',
    brand: 'TapeCo',
    fit: 'Workshop',
    cost: 1800,
    price: 3500,
    barcode: '6001001000417',
    jhb: 120,
    cpt: 60,
  },
  {
    sku: 'AC-MT-5006',
    name: 'CABLE TIES 300mm (100)',
    category: 'Maintenance',
    brand: 'TapeCo',
    fit: 'Workshop',
    cost: 3500,
    price: 6500,
    uom: 'pack',
    barcode: '6001001000424',
    jhb: 70,
    cpt: 35,
  },
  {
    sku: 'AC-MT-5007',
    name: 'HOSE CLAMP KIT',
    category: 'Maintenance',
    brand: 'ClampCo',
    fit: 'Universal',
    cost: 6500,
    price: 11900,
    uom: 'set',
    barcode: '6001001000431',
    jhb: 45,
    cpt: 22,
  },
  {
    sku: 'AC-MT-5008',
    name: 'HAND TOOL KIT 40-PIECE',
    category: 'Maintenance',
    brand: 'ToolPro',
    fit: 'Workshop',
    cost: 42000,
    price: 69900,
    uom: 'set',
    barcode: '6001001000448',
    jhb: 12,
    cpt: 6,
  },
];

const products = new Map<string, number>();
const productCosts = new Map<string, number>();
const productPrices = new Map<string, number>();
const productTax = new Map<string, number>();

function insertProducts(): void {
  const standardTax = (
    db.prepare("SELECT id FROM tax_rates WHERE name = 'Standard VAT 15%'").get() as { id: number }
  ).id;
  const insert = db.prepare(
    `INSERT INTO products
       (sku, barcode, name, description, category_id, type, uom, sale_price_cents, cost_cents,
        tax_rate_id, track_inventory, reorder_level, is_active)
     VALUES (?, ?, ?, ?, ?, 'goods', ?, ?, ?, ?, 1, ?, 1)`,
  );
  for (const product of PRODUCTS) {
    const existing = db.prepare('SELECT id FROM products WHERE sku = ?').get(product.sku) as
      { id: number } | undefined;
    const id = existing
      ? existing.id
      : Number(
          insert.run(
            product.sku,
            product.barcode,
            product.name,
            `Brand: ${product.brand}. Fits: ${product.fit}.`,
            category(product.category),
            product.uom ?? 'unit',
            product.price,
            product.cost,
            standardTax,
            product.reorder ?? 5,
          ).lastInsertRowid,
        );
    products.set(product.sku, id);
    productCosts.set(product.sku, product.cost);
    productPrices.set(product.sku, product.price);
    productTax.set(product.sku, 1500);
  }
}

function stockLocations(): { jhb: number; cpt: number } {
  const main = db.prepare("SELECT id FROM warehouses WHERE code = 'MAIN'").get() as
    { id: number } | undefined;
  const mainId = main
    ? main.id
    : Number(
        db.prepare("INSERT INTO warehouses (code, name) VALUES ('MAIN', 'Johannesburg HQ')").run()
          .lastInsertRowid,
      );
  db.prepare(
    "UPDATE warehouses SET name = 'Johannesburg HQ', address = '6 Lathe Street, Amalgam, Johannesburg' WHERE id = ?",
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

  const cptWarehouse = db.prepare("SELECT id FROM warehouses WHERE code = 'CPT'").get() as
    { id: number } | undefined;
  const cptWarehouseId = cptWarehouse
    ? cptWarehouse.id
    : Number(
        db
          .prepare(
            "INSERT INTO warehouses (code, name, address) VALUES ('CPT', 'Cape Town Branch', 'Unit 6 Trippessa Park, Epping 2, Cape Town')",
          )
          .run().lastInsertRowid,
      );
  const cpt = db
    .prepare("SELECT id FROM stock_locations WHERE warehouse_id = ? AND code = 'STOCK'")
    .get(cptWarehouseId) as { id: number } | undefined;
  const cptId = cpt
    ? cpt.id
    : Number(
        db
          .prepare(
            "INSERT INTO stock_locations (warehouse_id, code, name, is_default) VALUES (?, 'STOCK', 'CPT Stock', 1)",
          )
          .run(cptWarehouseId).lastInsertRowid,
      );

  db.prepare(
    "UPDATE pos_registers SET name = 'Johannesburg Register', warehouse_id = ?, location_id = ? WHERE code = 'MAIN'",
  ).run(mainId, jhbId);
  const cptRegister = db.prepare("SELECT id FROM pos_registers WHERE code = 'CPT'").get() as
    { id: number } | undefined;
  if (!cptRegister) {
    db.prepare(
      "INSERT INTO pos_registers (name, code, warehouse_id, location_id) VALUES ('Cape Town Register', 'CPT', ?, ?)",
    ).run(cptWarehouseId, cptId);
  }

  return { jhb: jhbId, cpt: cptId };
}

function openingStock(jhb: number, cpt: number, userId: number): void {
  for (const product of PRODUCTS) {
    const productId = products.get(product.sku);
    if (!productId) continue;
    recordMove({
      productId,
      locationId: jhb,
      quantity: product.jhb,
      moveType: 'opening',
      referenceType: 'seed',
      note: 'Opening stock — Johannesburg',
      userId,
    });
    recordMove({
      productId,
      locationId: cpt,
      quantity: product.cpt,
      moveType: 'opening',
      referenceType: 'seed',
      note: 'Opening stock — Cape Town',
      userId,
    });
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
    const totals = lineTotals(line.quantity, unitCost, productTax.get(line.sku) ?? 1500);
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
        `Africoach demo purchase order ${number}`,
        input.userId,
      );
    const id = Number(result.lastInsertRowid);
    const insertLine = db.prepare(
      `INSERT INTO purchase_order_lines
         (purchase_order_id, product_id, description, quantity, unit_cost_cents, tax_rate_bp,
          line_subtotal_cents, line_tax_cents, line_total_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const line of lines) {
      insertLine.run(
        id,
        line.productId,
        PRODUCTS.find((product) => product.sku === line.sku)?.name ?? line.sku,
        line.quantity,
        line.unitCost,
        productTax.get(line.sku) ?? 1500,
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
      notes: 'Received into Johannesburg HQ',
    });
    const bill = createInvoice({
      direction: 'purchase',
      partnerId: input.supplierId,
      issueDate: input.expectedDate,
      dueDate: input.expectedDate,
      purchaseOrderId: poId,
      notes: `Supplier bill for PO ${poId}`,
      lines: lines.map((line) => ({
        productId: line.productId,
        description: PRODUCTS.find((product) => product.sku === line.sku)?.name ?? line.sku,
        quantity: line.quantity,
        unitPriceCents: line.unitCost,
        taxRateBp: productTax.get(line.sku) ?? 1500,
      })),
      post: true,
      userId: input.userId,
    }) as unknown as { id: number };
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
    const totals = lineTotals(line.quantity, unitPrice, productTax.get(line.sku) ?? 1500);
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
        `Africoach demo sales order ${number}`,
        input.userId,
      );
    const id = Number(result.lastInsertRowid);
    const insertLine = db.prepare(
      `INSERT INTO sales_order_lines
         (sales_order_id, product_id, description, quantity, unit_price_cents, tax_rate_bp,
          line_subtotal_cents, line_tax_cents, line_total_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const line of lines) {
      insertLine.run(
        id,
        line.productId,
        PRODUCTS.find((product) => product.sku === line.sku)?.name ?? line.sku,
        line.quantity,
        line.unitPrice,
        productTax.get(line.sku) ?? 1500,
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
      dueDate: input.orderDate,
      salesOrderId: soId,
      notes: `Tax invoice for sales order ${soId}`,
      lines: lines.map((line) => ({
        productId: line.productId,
        description: PRODUCTS.find((product) => product.sku === line.sku)?.name ?? line.sku,
        quantity: line.quantity,
        unitPriceCents: line.unitPrice,
        taxRateBp: productTax.get(line.sku) ?? 1500,
      })),
      post: true,
      userId: input.userId,
    }) as unknown as { id: number };
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

function seedWebsite(adminId: number): void {
  const page = db.prepare("SELECT id FROM website_pages WHERE slug = 'about-us'").get() as
    { id: number } | undefined;
  if (!page) {
    db.prepare(
      `INSERT INTO website_pages (title, slug, content, status, published_at, meta_title)
       VALUES ('About Africoach', 'about-us', ?, 'published', date('now'), 'About Africoach')`,
    ).run(
      `Africoach is Southern Africa's leading distributor of parts for all makes of buses and coaches.\n\nWe stock over 4,000 part numbers across body parts, interior, electrical, engine and chassis, and maintenance categories. Our Johannesburg head office and Cape Town branch serve OEMs, refurbishers and fleet operators across the region.\n\nOur parts are imported directly from manufacturers around the world, with a special-orders team ready to source the parts you cannot find.`,
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
  const category = db
    .prepare("SELECT id FROM blog_categories WHERE slug = 'product-news'")
    .get() as { id: number } | undefined;
  const categoryId = category
    ? category.id
    : Number(
        db
          .prepare(
            "INSERT INTO blog_categories (name, slug, description) VALUES ('Product news', 'product-news', 'New ranges and product updates')",
          )
          .run().lastInsertRowid,
      );
  const post = db
    .prepare("SELECT id FROM blog_posts WHERE slug = 'new-led-work-lamp-range'")
    .get() as { id: number } | undefined;
  if (!post) {
    db.prepare(
      `INSERT INTO blog_posts (title, slug, excerpt, content, category_id, author_id, status, published_at)
       VALUES ('New LED work lamp range', 'new-led-work-lamp-range', 'Brighter, tougher and more efficient.', ?, ?, ?, 'published', date('now'))`,
    ).run(
      'We have expanded our LED work lamp range for buses and coaches. The new 12-24V lamps are brighter, draw less power and are built for South African road conditions.',
      categoryId,
      adminId,
    );
  }
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

  const months = [
    { key: '2026-06', days: [5, 15, 25] },
    { key: '2026-07', days: [5, 15, 25] },
    { key: '2026-08', days: [5, 15, 25] },
    { key: '2026-09', days: [5, 15, 25] },
    { key: '2026-10', days: [5, 15, 25] },
    { key: '2026-11', days: [1, 3, 5] },
  ];

  let cursor = 0;
  for (const [monthIndex, month] of months.entries()) {
    for (const [dayIndex, day] of month.days.entries()) {
      const customer = customers[cursor % customers.length]!;
      cursor += 1;
      const picks = [
        PRODUCTS[(monthIndex * 3 + dayIndex) % PRODUCTS.length]!,
        PRODUCTS[(monthIndex * 3 + dayIndex + 7) % PRODUCTS.length]!,
      ];
      const date = `${month.key}-${String(day).padStart(2, '0')}`;
      const invoice = createInvoice({
        direction: 'sale',
        partnerId: customer.id,
        issueDate: date,
        dueDate: addDays(date, 30),
        notes: 'Africoach demo historical sale',
        lines: picks.map((product, index) => ({
          productId: products.get(product.sku)!,
          description: product.name,
          quantity: index + 1 + ((monthIndex + dayIndex) % 3),
          unitPriceCents: product.price,
          taxRateBp: 1500,
        })),
        post: true,
        userId: adminId,
      }) as unknown as { id: number; total_cents: number };
      if (monthIndex < months.length - 1 || dayIndex === 0) {
        recordPayment({
          partnerId: customer.id,
          invoiceId: invoice.id,
          direction: 'in',
          paymentDate: addDays(date, 3),
          amountCents: invoice.total_cents,
          method: dayIndex === 1 ? 'card' : 'eft',
          reference: `RCPT-${invoice.id}`,
          userId: adminId,
        });
      } else if (dayIndex === 1) {
        recordPayment({
          partnerId: customer.id,
          invoiceId: invoice.id,
          direction: 'in',
          paymentDate: date,
          amountCents: Math.round(invoice.total_cents / 2),
          method: 'card',
          reference: `RCPT-${invoice.id}`,
          userId: adminId,
        });
      }
    }

    const supplier = suppliers[monthIndex % suppliers.length]!;
    const picks = [
      PRODUCTS[(monthIndex * 2 + 2) % PRODUCTS.length]!,
      PRODUCTS[(monthIndex * 2 + 9) % PRODUCTS.length]!,
    ];
    const date = month.key === '2026-11' ? '2026-11-02' : `${month.key}-12`;
    const bill = createInvoice({
      direction: 'purchase',
      partnerId: supplier.id,
      issueDate: date,
      dueDate: addDays(date, 30),
      notes: 'Africoach demo historical purchase',
      lines: picks.map((product, index) => ({
        productId: products.get(product.sku)!,
        description: product.name,
        quantity: 2 + index + (monthIndex % 3),
        unitPriceCents: product.cost,
        taxRateBp: 1500,
      })),
      post: true,
      userId: adminId,
    }) as unknown as { id: number; total_cents: number };
    if (monthIndex < months.length - 1 || monthIndex % 2 === 0) {
      recordPayment({
        partnerId: supplier.id,
        invoiceId: bill.id,
        direction: 'out',
        paymentDate: addDays(date, 5),
        amountCents: bill.total_cents,
        method: 'eft',
        reference: `PAY-${bill.id}`,
        userId: adminId,
      });
    }
  }
}

function seedPos(adminId: number, locationId: number): void {
  const register = db
    .prepare('SELECT id, location_id FROM pos_registers ORDER BY id LIMIT 1')
    .get() as { id: number; location_id: number | null } | undefined;
  if (!register) return;
  const walkIn = partner({ name: 'Walk-in Customer', customer: true });
  const session = db
    .prepare(
      `INSERT INTO pos_sessions
         (register_id, opened_by, opened_at, opening_float_cents, expected_cash_cents,
          difference_cents, status, notes)
       VALUES (?, ?, datetime('now', '-2 hours'), 50000, 0, 0, 'open',
               'Africoach demo session')`,
    )
    .run(register.id, adminId);
  const sessionId = Number(session.lastInsertRowid);

  const orders = [
    {
      method: 'cash' as const,
      lines: [
        { sku: 'AC-EL-3001', quantity: 2 },
        { sku: 'AC-EL-3002', quantity: 1 },
      ],
    },
    {
      method: 'card' as const,
      lines: [
        { sku: 'AC-MT-5001', quantity: 1 },
        { sku: 'AC-MT-5005', quantity: 3 },
      ],
    },
    { method: 'cash' as const, lines: [{ sku: 'AC-IN-2001', quantity: 2 }] },
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
        `INSERT INTO pos_orders
           (number, session_id, register_id, customer_id, payment_method, subtotal_cents, tax_cents,
            total_cents, amount_tendered_cents, change_cents, status, created_by)
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
      `INSERT INTO pos_order_lines
         (order_id, product_id, description, quantity, unit_price_cents, tax_rate_bp,
          line_subtotal_cents, line_tax_cents, line_total_cents)
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
      ['2026-10-01', 'Rent', 2_400_000, 'bank', 'Factory and showroom rent — October'],
      ['2026-10-04', 'Utilities', 510_000, 'bank', 'Electricity and water — October'],
      ['2026-10-09', 'Transport', 210_000, 'card', 'Coach deliveries to Gauteng depots'],
      ['2026-10-18', 'Consumables', 132_000, 'cash', 'Adhesives, trims and upholstery supplies'],
      ['2026-10-26', 'Marketing', 350_000, 'bank', 'Trade show and brochure print run'],
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
    for (const employee of employees) {
      ['2026-11-03', '2026-11-04', '2026-11-05'].forEach((date, index) => {
        const late = index === 2 && employee.email === 'thandi@africoach.local';
        insertAttendance.run(
          employee.id,
          date,
          late ? '08:18' : '07:50',
          '16:45',
          late ? 'late' : 'present',
          8.5,
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
         VALUES ('Standard Bank Current', 'Standard Bank', '04210098765', ?, ?)`,
      )
      .run(bank.id, 18_000_000);
    const bankAccountId = Number(result.lastInsertRowid);
    const insertTransaction = db.prepare(
      `INSERT INTO bank_transactions
         (bank_account_id, transaction_date, description, reference, amount_cents)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const transactions: [string, string, string, number][] = [
      ['2026-10-29', 'EFT — Mega Coaches', 'INV-00018', 3_450_000],
      ['2026-10-31', 'EFT — City of Joburg', 'COJ-OCT', -612_000],
      ['2026-11-01', 'Bank charges', 'SB-FEE', -21_000],
      ['2026-11-03', 'Card settlement', 'POS-BATCH', 980_000],
      ['2026-11-04', 'EFT — Gauteng Coach Lines', 'INV-00019', 1_275_000],
    ];
    for (const [date, description, reference, amount] of transactions) {
      insertTransaction.run(bankAccountId, date, description, reference, amount);
    }
  }
}

function main(): void {
  const adminId = createUser('admin@africoach.local', 'Africoach', 'Admin', 'admin');
  const salesUserId = createUser('sales@africoach.local', 'Yusuf', 'Sales', 'sales');
  const warehouseUserId = createUser(
    'warehouse@africoach.local',
    'Mohamed',
    'Warehouse',
    'warehouse',
  );
  const accountsUserId = createUser('accounts@africoach.local', 'Safiya', 'Accounts', 'accountant');
  const employeeUserId = createUser('thandi@africoach.local', 'Thandi', 'Mokoena', 'employee');

  createEmployee({
    firstName: 'Thandi',
    lastName: 'Mokoena',
    email: 'thandi@africoach.local',
    department: 'Management',
    jobTitle: 'Operations Manager',
    salaryCents: 4_500_000,
    startDate: '2024-01-15',
    userId: employeeUserId,
  });
  createEmployee({
    firstName: 'Yusuf',
    lastName: 'Patel',
    email: 'yusuf@africoach.local',
    department: 'Sales',
    jobTitle: 'Sales Manager',
    salaryCents: 3_800_000,
    startDate: '2024-02-01',
    userId: salesUserId,
  });
  createEmployee({
    firstName: 'Mohamed',
    lastName: 'Adams',
    email: 'mohamed@africoach.local',
    department: 'Warehouse',
    jobTitle: 'Warehouse Manager',
    salaryCents: 3_200_000,
    startDate: '2024-03-01',
    userId: warehouseUserId,
  });
  createEmployee({
    firstName: 'Safiya',
    lastName: 'Khan',
    email: 'safiya@africoach.local',
    department: 'Finance',
    jobTitle: 'Finance Manager',
    salaryCents: 3_600_000,
    startDate: '2024-04-01',
    userId: accountsUserId,
  });
  createEmployee({
    firstName: 'Eric',
    lastName: 'Naidoo',
    email: 'eric@africoach.local',
    department: 'Warehouse',
    jobTitle: 'Stock Controller',
    salaryCents: 2_800_000,
    startDate: '2025-01-20',
  });
  createEmployee({
    firstName: 'Onwell',
    lastName: 'Dlamini',
    email: 'onwell@africoach.local',
    department: 'Warehouse',
    jobTitle: 'Dispatch Checker',
    salaryCents: 2_400_000,
    startDate: '2025-06-01',
  });

  setting('company_name', 'Africoach');
  setting('company_logo', '/africoach-logo.svg');
  setting('company_registration', '2017/205910/07');
  setting('company_vat_number', '4123456789');
  setting('company_email', 'info@africoach.co.za');
  setting('company_phone', '+27 11 837 0794');
  setting('company_address', '6 Lathe Street, Amalgam, Johannesburg, 2092');
  setting('website_tagline', 'Bus and coach parts, delivered.');
  setting('invoice_due_days', '30');
  setting('vat_rate_bp', '1500');

  insertProducts();
  const locations = stockLocations();
  openingStock(locations.jhb, locations.cpt, adminId);

  const customers = [
    partner({
      name: 'Putco Bus Services',
      customer: true,
      email: 'procurement@putco.test',
      phone: '011 555 0101',
      city: 'Johannesburg',
      vat: '4010101010',
      credit: 5000000,
      terms: 30,
    }),
    partner({
      name: 'Golden Arrow Bus Services',
      customer: true,
      email: 'buying@goldenarrow.test',
      phone: '021 555 0202',
      city: 'Cape Town',
      vat: '4020202020',
      credit: 7500000,
      terms: 45,
    }),
    partner({
      name: 'Intercape',
      customer: true,
      email: 'fleet@intercape.test',
      phone: '021 555 0303',
      city: 'Cape Town',
      vat: '4030303030',
      credit: 6000000,
      terms: 30,
    }),
    partner({
      name: 'Greyhound Coach Lines',
      customer: true,
      email: 'ops@greyhound.test',
      phone: '011 555 0404',
      city: 'Johannesburg',
      vat: '4040404040',
      credit: 4500000,
      terms: 30,
    }),
    partner({
      name: 'Buscor',
      customer: true,
      email: 'stores@buscor.test',
      phone: '013 555 0505',
      city: 'Nelspruit',
      vat: '4050505050',
      credit: 3500000,
      terms: 30,
    }),
    partner({
      name: 'Autopax',
      customer: true,
      email: 'maintenance@autopax.test',
      phone: '012 555 0606',
      city: 'Pretoria',
      vat: '4060606060',
      credit: 4000000,
      terms: 45,
    }),
    partner({
      name: 'City of Tshwane Fleet',
      customer: true,
      email: 'fleet@tshwane.test',
      phone: '012 555 0707',
      city: 'Pretoria',
      vat: '4070707070',
      credit: 9000000,
      terms: 60,
    }),
    partner({
      name: 'Eldo Coaches',
      customer: true,
      email: 'workshop@eldo.test',
      phone: '012 555 0808',
      city: 'Pretoria',
      vat: '4080808080',
      credit: 2500000,
      terms: 30,
    }),
    partner({
      name: 'Mega Coach Tours',
      customer: true,
      email: 'info@megacoach.test',
      phone: '031 555 0909',
      city: 'Durban',
      vat: '4090909090',
      credit: 2000000,
      terms: 30,
    }),
    partner({
      name: 'Transit Coach Repairs',
      customer: true,
      email: 'parts@transitcoach.test',
      phone: '011 555 1010',
      city: 'Johannesburg',
      vat: '4101010101',
      credit: 1500000,
      terms: 30,
    }),
  ];

  const suppliers = [
    partner({
      name: 'Hella South Africa',
      supplier: true,
      email: 'orders@hella.test',
      phone: '011 555 2001',
      city: 'Johannesburg',
      vat: '5010101010',
      terms: 30,
    }),
    partner({
      name: 'Marcopolo Parts',
      supplier: true,
      email: 'exports@marcopolo.test',
      phone: '+55 54 555 2002',
      city: 'Caxias do Sul',
      vat: '',
      terms: 60,
    }),
    partner({
      name: 'Busscar Parts',
      supplier: true,
      email: 'exports@busscar.test',
      phone: '+55 47 555 2003',
      city: 'Joinville',
      vat: '',
      terms: 60,
    }),
    partner({
      name: 'Yutong Africa',
      supplier: true,
      email: 'parts@yutong.test',
      phone: '011 555 2004',
      city: 'Johannesburg',
      vat: '5040404040',
      terms: 45,
    }),
    partner({
      name: 'Volvo Bus South Africa',
      supplier: true,
      email: 'parts@volvo.test',
      phone: '011 555 2005',
      city: 'Johannesburg',
      vat: '5050505050',
      terms: 30,
    }),
    partner({
      name: 'Rubber & Plastic Supplies',
      supplier: true,
      email: 'sales@rubberplastic.test',
      phone: '021 555 2006',
      city: 'Cape Town',
      vat: '5060606060',
      terms: 30,
    }),
    partner({
      name: 'LED Auto Lighting',
      supplier: true,
      email: 'orders@ledauto.test',
      phone: '011 555 2007',
      city: 'Johannesburg',
      vat: '5070707070',
      terms: 30,
    }),
    partner({
      name: 'ToolPro Workshop Supplies',
      supplier: true,
      email: 'sales@toolpro.test',
      phone: '011 555 2008',
      city: 'Johannesburg',
      vat: '5080808080',
      terms: 30,
    }),
  ];

  const [hella, marcopolo, busscar, yutong, volvo, rubber, led, toolpro] = suppliers;
  const [putco, goldenArrow, intercape, greyhound, buscor, autopax, tshwane, eldo, mega, transit] =
    customers;

  createPurchaseOrder({
    supplierId: hella!,
    orderDate: '2026-10-20',
    expectedDate: '2026-10-24',
    status: 'received',
    lines: [
      { sku: 'AC-EL-3001', quantity: 50 },
      { sku: 'AC-EL-3002', quantity: 30 },
      { sku: 'AC-EL-3009', quantity: 10 },
    ],
    userId: adminId,
    locationId: locations.jhb,
    pay: 'full',
  });
  createPurchaseOrder({
    supplierId: marcopolo!,
    orderDate: '2026-10-22',
    expectedDate: '2026-10-28',
    status: 'received',
    lines: [
      { sku: 'AC-BP-1010', quantity: 2 },
      { sku: 'AC-BP-1001', quantity: 10 },
    ],
    userId: adminId,
    locationId: locations.jhb,
    pay: 'partial',
  });
  createPurchaseOrder({
    supplierId: yutong!,
    orderDate: '2026-10-30',
    expectedDate: '2026-11-08',
    status: 'confirmed',
    lines: [
      { sku: 'AC-EL-3005', quantity: 4 },
      { sku: 'AC-EL-3006', quantity: 4 },
    ],
    userId: adminId,
    locationId: locations.jhb,
    pay: 'none',
  });
  createPurchaseOrder({
    supplierId: rubber!,
    orderDate: '2026-11-02',
    expectedDate: '2026-11-06',
    status: 'draft',
    lines: [
      { sku: 'AC-BP-1009', quantity: 6 },
      { sku: 'AC-IN-2008', quantity: 40 },
    ],
    userId: adminId,
    locationId: locations.jhb,
    pay: 'none',
  });
  createPurchaseOrder({
    supplierId: led!,
    orderDate: '2026-10-18',
    expectedDate: '2026-10-21',
    status: 'received',
    lines: [
      { sku: 'AC-IN-2001', quantity: 60 },
      { sku: 'AC-IN-2003', quantity: 40 },
      { sku: 'AC-EL-3002', quantity: 20 },
    ],
    userId: adminId,
    locationId: locations.cpt,
    pay: 'full',
  });

  createSalesOrder({
    customerId: putco!,
    orderDate: '2026-11-03',
    status: 'draft',
    lines: [
      { sku: 'AC-BP-1001', quantity: 2 },
      { sku: 'AC-EL-3001', quantity: 10 },
    ],
    userId: adminId,
    locationId: locations.jhb,
    pay: 'none',
  });
  createSalesOrder({
    customerId: goldenArrow!,
    orderDate: '2026-11-02',
    status: 'confirmed',
    lines: [
      { sku: 'AC-IN-2001', quantity: 20 },
      { sku: 'AC-IN-2003', quantity: 10 },
      { sku: 'AC-EL-3002', quantity: 8 },
    ],
    userId: adminId,
    locationId: locations.cpt,
    pay: 'none',
  });
  createSalesOrder({
    customerId: intercape!,
    orderDate: '2026-10-28',
    status: 'fulfilled',
    lines: [
      { sku: 'AC-BP-1003', quantity: 4 },
      { sku: 'AC-BP-1006', quantity: 4 },
    ],
    userId: adminId,
    locationId: locations.cpt,
    pay: 'none',
  });
  createSalesOrder({
    customerId: greyhound!,
    orderDate: '2026-10-29',
    status: 'fulfilled',
    lines: [
      { sku: 'AC-IN-2005', quantity: 1 },
      { sku: 'AC-IN-2006', quantity: 2 },
    ],
    userId: adminId,
    locationId: locations.jhb,
    pay: 'none',
  });
  createSalesOrder({
    customerId: buscor!,
    orderDate: '2026-10-25',
    status: 'invoiced',
    lines: [
      { sku: 'AC-EC-4001', quantity: 2 },
      { sku: 'AC-EC-4003', quantity: 4 },
    ],
    userId: adminId,
    locationId: locations.jhb,
    pay: 'full',
  });
  createSalesOrder({
    customerId: autopax!,
    orderDate: '2026-10-27',
    status: 'invoiced',
    lines: [
      { sku: 'AC-EL-3005', quantity: 1 },
      { sku: 'AC-EL-3006', quantity: 1 },
    ],
    userId: adminId,
    locationId: locations.jhb,
    pay: 'partial',
  });
  createSalesOrder({
    customerId: tshwane!,
    orderDate: '2026-10-30',
    status: 'invoiced',
    lines: [
      { sku: 'AC-EC-4006', quantity: 4 },
      { sku: 'AC-EC-4002', quantity: 2 },
    ],
    userId: adminId,
    locationId: locations.jhb,
    pay: 'full',
  });
  createSalesOrder({
    customerId: eldo!,
    orderDate: '2026-11-04',
    status: 'draft',
    lines: [{ sku: 'AC-IN-2009', quantity: 6 }],
    userId: adminId,
    locationId: locations.jhb,
    pay: 'none',
  });

  // A couple of direct counter invoices, including one overdue.
  const counterOne = createInvoice({
    direction: 'sale',
    partnerId: transit!,
    issueDate: '2026-10-15',
    dueDate: '2026-10-30',
    notes: 'Counter sale — special order',
    lines: [
      {
        productId: products.get('AC-MT-5008')!,
        description: 'HAND TOOL KIT 40-PIECE',
        quantity: 1,
        unitPriceCents: productPrices.get('AC-MT-5008')!,
        taxRateBp: 1500,
      },
      {
        productId: products.get('AC-MT-5007')!,
        description: 'HOSE CLAMP KIT',
        quantity: 2,
        unitPriceCents: productPrices.get('AC-MT-5007')!,
        taxRateBp: 1500,
      },
    ],
    post: true,
    userId: adminId,
  }) as unknown as { id: number };
  void counterOne;

  const counterTwo = createInvoice({
    direction: 'sale',
    partnerId: mega!,
    issueDate: '2026-11-04',
    dueDate: '2026-11-18',
    notes: 'Counter sale — walk-in account',
    lines: [
      {
        productId: products.get('AC-BP-1002')!,
        description: 'MIRROR ARM EXTRA LONG LH 780x630mm',
        quantity: 1,
        unitPriceCents: productPrices.get('AC-BP-1002')!,
        taxRateBp: 1500,
      },
    ],
    post: true,
    userId: adminId,
  }) as unknown as { id: number };
  recordPayment({
    partnerId: mega!,
    invoiceId: counterTwo.id,
    direction: 'in',
    paymentDate: '2026-11-04',
    amountCents: Math.round(productPrices.get('AC-BP-1002')! * 1.15),
    method: 'card',
    reference: `RCPT-${counterTwo.id}`,
    userId: adminId,
  });

  seedHistoricalInvoices(adminId);
  seedPos(adminId, locations.jhb);
  seedWebsite(adminId);
  seedOperations(adminId);

  console.log('Africoach demo data ready.');
  console.log(`Login: admin@africoach.local / ${PASSWORD}`);
  console.log('Also: sales@, warehouse@, accounts@ with the same password.');
}

main();
closeDb();
