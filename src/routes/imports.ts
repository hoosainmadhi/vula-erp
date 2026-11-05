import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { ValidationError } from '../utils/errors.js';
import { requireString } from '../utils/validate.js';
import { recordAudit } from '../services/audit.js';
import { recordMove } from '../services/stock.js';
import { postJournalEntry } from '../services/accounting.js';
import { today } from '../utils/dates.js';

export const importsRouter = Router();
importsRouter.use(authenticate);

/** Minimal RFC-4180 CSV parser: quoted cells, escaped quotes, commas and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (char === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value !== ''));
}

function headerIndex(headers: string[], ...aliases: string[]): number {
  for (const alias of aliases) {
    const index = headers.indexOf(alias.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function toCents(value: string | undefined): number {
  if (!value) return 0;
  const number = Number(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function toBool(value: string | undefined, fallback: boolean): number {
  if (value === undefined || value === '') return fallback ? 1 : 0;
  return /^(1|true|yes|y)$/i.test(value) ? 1 : 0;
}

importsRouter.post(
  '/products',
  requirePermission('data.import'),
  asyncHandler(async (req, res) => {
    const rows = parseCsv(requireString(req.body?.csv, 'CSV', 2_000_000));
    if (rows.length < 2)
      throw new ValidationError('CSV needs a header row and at least one data row');
    const headers = (rows[0] ?? []).map((header) => header.toLowerCase());
    const skuIndex = headerIndex(headers, 'sku', 'default_code', 'code');
    const nameIndex = headerIndex(headers, 'name', 'product_name');
    const saleIndex = headerIndex(headers, 'sale_price', 'list_price', 'price', 'sale_price_cents');
    const costIndex = headerIndex(headers, 'cost', 'standard_price', 'cost_cents');
    const barcodeIndex = headerIndex(headers, 'barcode', 'ean', 'upc');
    const categoryIndex = headerIndex(headers, 'category', 'category_name');
    const brandIndex = headerIndex(headers, 'brand');
    const colourIndex = headerIndex(headers, 'colour', 'color');
    const sizeIndex = headerIndex(headers, 'size');
    const thicknessIndex = headerIndex(headers, 'thickness');
    const taxIndex = headerIndex(headers, 'tax_rate_bp', 'vat_bp');
    const activeIndex = headerIndex(headers, 'is_active', 'active');
    if (skuIndex < 0 || nameIndex < 0) {
      throw new ValidationError('CSV must include sku (or default_code) and name columns');
    }

    const db = getDb();
    const categoryByName = new Map<string, number>();
    for (const row of db.prepare('SELECT id, name FROM product_categories').all() as {
      id: number;
      name: string;
    }[]) {
      categoryByName.set(row.name.toLowerCase(), row.id);
    }
    const taxId = (
      db.prepare("SELECT id FROM tax_rates WHERE name = 'Standard VAT 15%'").get() as
        { id: number } | undefined
    )?.id;
    const insertCategory = db.prepare('INSERT OR IGNORE INTO product_categories (name) VALUES (?)');
    const findCategory = db.prepare('SELECT id FROM product_categories WHERE name = ?');

    const insert = db.prepare(
      `INSERT INTO products
         (sku, barcode, name, brand, colour, size, thickness, category_id,
          sale_price_cents, cost_cents, tax_rate_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const update = db.prepare(
      `UPDATE products SET barcode = ?, name = ?, brand = ?, colour = ?, size = ?, thickness = ?,
         category_id = ?, sale_price_cents = ?, cost_cents = ?, tax_rate_id = ?, is_active = ?,
         updated_at = datetime('now')
       WHERE sku = ?`,
    );
    const findBySku = db.prepare('SELECT id FROM products WHERE sku = ?');

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    const run = db.transaction(() => {
      for (let index = 1; index < rows.length; index += 1) {
        const row = rows[index] ?? [];
        const sku = row[skuIndex]?.trim();
        const name = row[nameIndex]?.trim();
        if (!sku || !name) {
          errors.push(`Row ${index + 1}: sku and name are required`);
          continue;
        }
        let categoryId: number | null = null;
        const categoryName = categoryIndex >= 0 ? row[categoryIndex]?.trim() : '';
        if (categoryName) {
          categoryId = categoryByName.get(categoryName.toLowerCase()) ?? null;
          if (!categoryId) {
            insertCategory.run(categoryName);
            const found = findCategory.get(categoryName) as { id: number } | undefined;
            categoryId = found?.id ?? null;
            if (categoryId) categoryByName.set(categoryName.toLowerCase(), categoryId);
          }
        }
        const salePrice = saleIndex >= 0 ? toCents(row[saleIndex]) : 0;
        const cost = costIndex >= 0 ? toCents(row[costIndex]) : 0;
        const barcode = barcodeIndex >= 0 ? row[barcodeIndex]?.trim() || null : null;
        const taxRateId = taxIndex >= 0 && row[taxIndex] ? Number(row[taxIndex]) : (taxId ?? null);
        const isActive = activeIndex >= 0 ? toBool(row[activeIndex], true) : 1;
        const existing = findBySku.get(sku) as { id: number } | undefined;

        try {
          if (existing) {
            update.run(
              barcode,
              name,
              brandIndex >= 0 ? row[brandIndex]?.trim() || null : null,
              colourIndex >= 0 ? row[colourIndex]?.trim() || null : null,
              sizeIndex >= 0 ? row[sizeIndex]?.trim() || null : null,
              thicknessIndex >= 0 ? row[thicknessIndex]?.trim() || null : null,
              categoryId,
              salePrice,
              cost,
              taxRateId,
              isActive,
              sku,
            );
            updated += 1;
          } else {
            insert.run(
              sku,
              barcode,
              name,
              brandIndex >= 0 ? row[brandIndex]?.trim() || null : null,
              colourIndex >= 0 ? row[colourIndex]?.trim() || null : null,
              sizeIndex >= 0 ? row[sizeIndex]?.trim() || null : null,
              thicknessIndex >= 0 ? row[thicknessIndex]?.trim() || null : null,
              categoryId,
              salePrice,
              cost,
              taxRateId,
              isActive,
            );
            created += 1;
          }
        } catch (error) {
          errors.push(`Row ${index + 1}: ${(error as Error).message}`);
        }
      }
    });
    run();

    recordAudit(req.user!.id, 'import', 'products', null, { created, updated });
    res.status(201).json({ created, updated, errors, total: rows.length - 1 });
  }),
);

importsRouter.post(
  '/partners',
  requirePermission('data.import'),
  asyncHandler(async (req, res) => {
    const rows = parseCsv(requireString(req.body?.csv, 'CSV', 2_000_000));
    if (rows.length < 2)
      throw new ValidationError('CSV needs a header row and at least one data row');
    const headers = (rows[0] ?? []).map((header) => header.toLowerCase());
    const nameIndex = headerIndex(headers, 'name', 'partner_name', 'company_name');
    if (nameIndex < 0) throw new ValidationError('CSV must include a name column');
    const emailIndex = headerIndex(headers, 'email');
    const phoneIndex = headerIndex(headers, 'phone', 'mobile');
    const vatIndex = headerIndex(headers, 'vat_number', 'vat');
    const contactIndex = headerIndex(headers, 'contact_name', 'contact');
    const addressIndex = headerIndex(headers, 'address_line1', 'street', 'address');
    const cityIndex = headerIndex(headers, 'city', 'town');
    const provinceIndex = headerIndex(headers, 'province', 'state');
    const postalIndex = headerIndex(headers, 'postal_code', 'zip');
    const countryIndex = headerIndex(headers, 'country');
    const customerIndex = headerIndex(headers, 'is_customer', 'customer');
    const supplierIndex = headerIndex(headers, 'is_supplier', 'supplier');
    const defaultType = typeof req.body?.type === 'string' ? req.body.type : 'both';

    const db = getDb();
    const insert = db.prepare(
      `INSERT INTO partners
         (name, is_customer, is_supplier, contact_name, email, phone, vat_number,
          address_line1, city, province, postal_code, country)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const update = db.prepare(
      `UPDATE partners SET is_customer = ?, is_supplier = ?, contact_name = ?, email = ?, phone = ?,
         vat_number = ?, address_line1 = ?, city = ?, province = ?, postal_code = ?, country = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
    );
    const findByName = db.prepare('SELECT id FROM partners WHERE lower(name) = lower(?)');

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    const run = db.transaction(() => {
      for (let index = 1; index < rows.length; index += 1) {
        const row = rows[index] ?? [];
        const name = row[nameIndex]?.trim();
        if (!name) {
          errors.push(`Row ${index + 1}: name is required`);
          continue;
        }
        const isCustomer =
          customerIndex >= 0
            ? toBool(row[customerIndex], defaultType !== 'supplier')
            : defaultType !== 'supplier'
              ? 1
              : 0;
        const isSupplier =
          supplierIndex >= 0
            ? toBool(row[supplierIndex], defaultType !== 'customer')
            : defaultType !== 'customer'
              ? 1
              : 0;
        if (isCustomer === 0 && isSupplier === 0) {
          errors.push(`Row ${index + 1}: partner must be a customer or supplier`);
          continue;
        }
        const values = [
          isCustomer,
          isSupplier,
          contactIndex >= 0 ? row[contactIndex]?.trim() || null : null,
          emailIndex >= 0 ? row[emailIndex]?.trim() || null : null,
          phoneIndex >= 0 ? row[phoneIndex]?.trim() || null : null,
          vatIndex >= 0 ? row[vatIndex]?.trim() || null : null,
          addressIndex >= 0 ? row[addressIndex]?.trim() || null : null,
          cityIndex >= 0 ? row[cityIndex]?.trim() || null : null,
          provinceIndex >= 0 ? row[provinceIndex]?.trim() || null : null,
          postalIndex >= 0 ? row[postalIndex]?.trim() || null : null,
          countryIndex >= 0 ? row[countryIndex]?.trim() || 'South Africa' : 'South Africa',
        ];
        const existing = findByName.get(name) as { id: number } | undefined;
        try {
          if (existing) {
            update.run(...values, existing.id);
            updated += 1;
          } else {
            insert.run(name, ...values);
            created += 1;
          }
        } catch (error) {
          errors.push(`Row ${index + 1}: ${(error as Error).message}`);
        }
      }
    });
    run();

    recordAudit(req.user!.id, 'import', 'partners', null, { created, updated });
    res.status(201).json({ created, updated, errors, total: rows.length - 1 });
  }),
);

importsRouter.post(
  '/opening-stock',
  requirePermission('data.import'),
  asyncHandler(async (req, res) => {
    const rows = parseCsv(requireString(req.body?.csv, 'CSV', 2_000_000));
    if (rows.length < 2)
      throw new ValidationError('CSV needs a header row and at least one data row');
    const headers = (rows[0] ?? []).map((header) => header.toLowerCase());
    const skuIndex = headerIndex(headers, 'sku', 'default_code', 'code');
    const qtyIndex = headerIndex(headers, 'quantity', 'qty', 'stock');
    const locationIndex = headerIndex(headers, 'location_code', 'location');
    const warehouseIndex = headerIndex(headers, 'warehouse_code', 'warehouse');
    const costIndex = headerIndex(headers, 'unit_cost', 'cost', 'standard_price');
    if (skuIndex < 0 || qtyIndex < 0) {
      throw new ValidationError('CSV must include sku and quantity columns');
    }

    const db = getDb();
    const findProduct = db.prepare('SELECT id, cost_cents FROM products WHERE sku = ?');
    const findLocationByCode = db.prepare(
      'SELECT id FROM stock_locations WHERE lower(code) = lower(?) ORDER BY id LIMIT 1',
    );
    const findWarehouseLocation = db.prepare(
      `SELECT l.id FROM stock_locations l JOIN warehouses w ON w.id = l.warehouse_id
       WHERE lower(w.code) = lower(?) ORDER BY l.is_default DESC, l.id LIMIT 1`,
    );
    const findDefaultLocation = db.prepare(
      'SELECT id FROM stock_locations ORDER BY is_default DESC, id LIMIT 1',
    );

    let imported = 0;
    const errors: string[] = [];
    const run = db.transaction(() => {
      for (let index = 1; index < rows.length; index += 1) {
        const row = rows[index] ?? [];
        const sku = row[skuIndex]?.trim();
        const quantity = Number(row[qtyIndex]);
        if (!sku) {
          errors.push(`Row ${index + 1}: sku is required`);
          continue;
        }
        if (!Number.isFinite(quantity) || quantity === 0) {
          errors.push(`Row ${index + 1}: quantity must be a non-zero number`);
          continue;
        }
        const product = findProduct.get(sku) as { id: number; cost_cents: number } | undefined;
        if (!product) {
          errors.push(`Row ${index + 1}: product ${sku} not found`);
          continue;
        }
        let locationId: number | null = null;
        const locationCode = locationIndex >= 0 ? row[locationIndex]?.trim() : '';
        const warehouseCode = warehouseIndex >= 0 ? row[warehouseIndex]?.trim() : '';
        if (locationCode) {
          const location = findLocationByCode.get(locationCode) as { id: number } | undefined;
          locationId = location?.id ?? null;
        } else if (warehouseCode) {
          const location = findWarehouseLocation.get(warehouseCode) as { id: number } | undefined;
          locationId = location?.id ?? null;
        } else {
          const location = findDefaultLocation.get() as { id: number } | undefined;
          locationId = location?.id ?? null;
        }
        if (!locationId) {
          errors.push(`Row ${index + 1}: stock location not found`);
          continue;
        }
        const unitCost =
          costIndex >= 0 && row[costIndex]
            ? Math.round(Number(row[costIndex].replace(/[^0-9.-]/g, '')) * 100)
            : product.cost_cents;
        recordMove({
          productId: product.id,
          locationId,
          quantity,
          moveType: 'opening',
          referenceType: 'import',
          unitCostCents: Number.isFinite(unitCost) ? unitCost : product.cost_cents,
          note: 'Opening stock import',
          userId: req.user!.id,
        });
        imported += 1;
      }
    });
    run();
    recordAudit(req.user!.id, 'import', 'opening_stock', null, { imported });
    res.status(201).json({ imported, errors });
  }),
);

importsRouter.post(
  '/opening-balances',
  requirePermission('data.import'),
  asyncHandler(async (req, res) => {
    const rows = parseCsv(requireString(req.body?.csv, 'CSV', 2_000_000));
    if (rows.length < 2)
      throw new ValidationError('CSV needs a header row and at least one data row');
    const headers = (rows[0] ?? []).map((header) => header.toLowerCase());
    const accountIndex = headerIndex(headers, 'account_code', 'code', 'account');
    const debitIndex = headerIndex(headers, 'debit', 'debit_cents');
    const creditIndex = headerIndex(headers, 'credit', 'credit_cents');
    const descriptionIndex = headerIndex(headers, 'description', 'name');
    if (accountIndex < 0 || (debitIndex < 0 && creditIndex < 0)) {
      throw new ValidationError('CSV must include account_code and debit or credit columns');
    }
    const entryDate =
      typeof req.body?.entryDate === 'string' && req.body.entryDate
        ? requireString(req.body.entryDate, 'Entry date', 10)
        : today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
      throw new ValidationError('Entry date must be YYYY-MM-DD');
    }

    const db = getDb();
    const findAccount = db.prepare('SELECT id, code FROM accounts WHERE code = ?');
    const items: {
      accountId: number;
      debitCents: number;
      creditCents: number;
      description: string;
    }[] = [];
    const errors: string[] = [];
    for (let index = 1; index < rows.length; index += 1) {
      const row = rows[index] ?? [];
      const code = row[accountIndex]?.trim();
      if (!code) {
        errors.push(`Row ${index + 1}: account_code is required`);
        continue;
      }
      const account = findAccount.get(code) as { id: number; code: string } | undefined;
      if (!account) {
        errors.push(`Row ${index + 1}: account ${code} not found`);
        continue;
      }
      const debit = debitIndex >= 0 ? toCents(row[debitIndex]) : 0;
      const credit = creditIndex >= 0 ? toCents(row[creditIndex]) : 0;
      if (debit <= 0 && credit <= 0) {
        errors.push(`Row ${index + 1}: debit or credit must be positive`);
        continue;
      }
      items.push({
        accountId: account.id,
        debitCents: debit,
        creditCents: credit,
        description:
          (descriptionIndex >= 0 ? row[descriptionIndex]?.trim() : '') || `Opening balance ${code}`,
      });
    }

    const totalDebit = items.reduce((total, item) => total + item.debitCents, 0);
    const totalCredit = items.reduce((total, item) => total + item.creditCents, 0);
    if (items.length < 2) throw new ValidationError('Opening balances need at least two lines');
    if (totalDebit !== totalCredit) {
      throw new ValidationError(
        `Opening balances do not balance (debits ${totalDebit} vs credits ${totalCredit})`,
      );
    }

    const journalEntryId = postJournalEntry({
      journalCode: 'GEN',
      entryDate,
      description: 'Opening balances import',
      sourceType: 'opening_balance',
      userId: req.user!.id,
      items,
    });
    recordAudit(req.user!.id, 'import', 'opening_balances', journalEntryId, {
      items: items.length,
    });
    res.status(201).json({ journalEntryId, items: items.length, errors });
  }),
);
