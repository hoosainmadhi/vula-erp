import { getDb } from '../db.js';
import { nextNumber } from './sequences.js';
import { ValidationError, notFound } from '../utils/errors.js';

export type MoveType = 'opening' | 'receipt' | 'sale' | 'adjustment' | 'transfer' | 'return';

export interface StockMoveInput {
  productId: number;
  locationId: number;
  /** Signed: positive = in, negative = out. */
  quantity: number;
  moveType: MoveType;
  referenceType?: string | null;
  referenceId?: number | null;
  unitCostCents?: number;
  note?: string | null;
  userId?: number | null;
}

export function recordMove(input: StockMoveInput): number {
  const db = getDb();
  if (!Number.isFinite(input.quantity) || input.quantity === 0) {
    throw new ValidationError('Stock move quantity must be non-zero');
  }

  const result = db
    .prepare(
      `INSERT INTO stock_moves
         (product_id, location_id, quantity, move_type, reference_type, reference_id, unit_cost_cents, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.productId,
      input.locationId,
      input.quantity,
      input.moveType,
      input.referenceType ?? null,
      input.referenceId ?? null,
      input.unitCostCents ?? 0,
      input.note ?? null,
      input.userId ?? null,
    );

  db.prepare(
    `INSERT INTO stock_levels (product_id, location_id, quantity, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (product_id, location_id)
     DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = datetime('now')`,
  ).run(input.productId, input.locationId, input.quantity);

  return Number(result.lastInsertRowid);
}

export function stockOnHand(productId: number, locationId?: number): number {
  const db = getDb();
  const row = locationId
    ? (db
        .prepare('SELECT quantity FROM stock_levels WHERE product_id = ? AND location_id = ?')
        .get(productId, locationId) as { quantity: number } | undefined)
    : (db
        .prepare(
          'SELECT COALESCE(SUM(quantity), 0) AS quantity FROM stock_levels WHERE product_id = ?',
        )
        .get(productId) as { quantity: number });
  return row?.quantity ?? 0;
}

interface ProductRow {
  id: number;
  name: string;
  sku: string;
  track_inventory: number;
  cost_cents: number;
}

export function requireProduct(productId: number): ProductRow {
  const product = getDb()
    .prepare('SELECT id, name, sku, track_inventory, cost_cents FROM products WHERE id = ?')
    .get(productId) as ProductRow | undefined;
  if (!product) throw notFound('Product not found');
  return product;
}

export interface ReceiveLine {
  purchaseOrderLineId: number;
  quantity: number;
}

export function receivePurchaseOrder(
  purchaseOrderId: number,
  options: {
    locationId: number;
    receivedDate: string;
    notes?: string | null;
    lines?: ReceiveLine[];
    userId?: number | null;
  },
) {
  const db = getDb();
  const po = db
    .prepare('SELECT id, number, status FROM purchase_orders WHERE id = ?')
    .get(purchaseOrderId) as { id: number; number: string; status: string } | undefined;
  if (!po) throw notFound('Purchase order not found');
  if (po.status === 'cancelled')
    throw new ValidationError('Cannot receive a cancelled purchase order');
  if (po.status === 'received')
    throw new ValidationError('Purchase order is already fully received');

  const location = db
    .prepare('SELECT id FROM stock_locations WHERE id = ?')
    .get(options.locationId) as { id: number } | undefined;
  if (!location) throw notFound('Stock location not found');

  const lines = db
    .prepare(
      'SELECT id, product_id, description, quantity, received_quantity, unit_cost_cents FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY id',
    )
    .all(purchaseOrderId) as {
    id: number;
    product_id: number | null;
    description: string;
    quantity: number;
    received_quantity: number;
    unit_cost_cents: number;
  }[];
  if (lines.length === 0) throw new ValidationError('Purchase order has no lines');

  const requested = new Map<number, number>();
  if (options.lines && options.lines.length > 0) {
    for (const line of options.lines) requested.set(line.purchaseOrderLineId, line.quantity);
  } else {
    for (const line of lines) {
      const outstanding = line.quantity - line.received_quantity;
      if (outstanding > 0) requested.set(line.id, outstanding);
    }
  }

  return db.transaction(() => {
    const receiptNumber = nextNumber('goods_receipt');
    const receipt = db
      .prepare(
        'INSERT INTO goods_receipts (number, purchase_order_id, received_date, notes, created_by) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        receiptNumber,
        purchaseOrderId,
        options.receivedDate,
        options.notes ?? null,
        options.userId ?? null,
      );
    const receiptId = Number(receipt.lastInsertRowid);

    for (const line of lines) {
      const quantity = requested.get(line.id) ?? 0;
      if (quantity <= 0) continue;
      const outstanding = line.quantity - line.received_quantity;
      if (quantity > outstanding + 1e-9) {
        throw new ValidationError(
          `Cannot receive ${quantity} of "${line.description}" — only ${outstanding} outstanding`,
        );
      }
      if (!line.product_id) {
        throw new ValidationError(
          `Line "${line.description}" has no product and cannot be stocked`,
        );
      }

      db.prepare(
        'INSERT INTO goods_receipt_lines (goods_receipt_id, purchase_order_line_id, product_id, location_id, quantity, unit_cost_cents) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        receiptId,
        line.id,
        line.product_id,
        options.locationId,
        quantity,
        line.unit_cost_cents,
      );

      recordMove({
        productId: line.product_id,
        locationId: options.locationId,
        quantity,
        moveType: 'receipt',
        referenceType: 'goods_receipt',
        referenceId: receiptId,
        unitCostCents: line.unit_cost_cents,
        note: `Received against ${po.number}`,
        userId: options.userId ?? null,
      });

      db.prepare(
        'UPDATE purchase_order_lines SET received_quantity = received_quantity + ? WHERE id = ?',
      ).run(quantity, line.id);
    }

    const updated = db
      .prepare(
        'SELECT id, quantity, received_quantity FROM purchase_order_lines WHERE purchase_order_id = ?',
      )
      .all(purchaseOrderId) as { id: number; quantity: number; received_quantity: number }[];
    const fullyReceived = updated.every((line) => line.received_quantity + 1e-9 >= line.quantity);
    db.prepare(
      "UPDATE purchase_orders SET status = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(fullyReceived ? 'received' : 'confirmed', purchaseOrderId);

    return { id: receiptId, number: receiptNumber, fullyReceived };
  })();
}

export function fulfilSalesOrder(
  salesOrderId: number,
  options: { locationId: number; userId?: number | null },
) {
  const db = getDb();
  const order = db
    .prepare('SELECT id, number, status FROM sales_orders WHERE id = ?')
    .get(salesOrderId) as { id: number; number: string; status: string } | undefined;
  if (!order) throw notFound('Sales order not found');
  if (order.status === 'cancelled')
    throw new ValidationError('Cannot fulfil a cancelled sales order');
  if (order.status !== 'confirmed') {
    throw new ValidationError('Only confirmed sales orders can be fulfilled');
  }

  const lines = db
    .prepare(
      'SELECT id, product_id, description, quantity, fulfilled_quantity FROM sales_order_lines WHERE sales_order_id = ? ORDER BY id',
    )
    .all(salesOrderId) as {
    id: number;
    product_id: number | null;
    description: string;
    quantity: number;
    fulfilled_quantity: number;
  }[];

  return db.transaction(() => {
    for (const line of lines) {
      const outstanding = line.quantity - line.fulfilled_quantity;
      if (outstanding <= 0 || !line.product_id) continue;
      const product = requireProduct(line.product_id);
      if (product.track_inventory === 1) {
        const available = stockOnHand(product.id);
        if (available + 1e-9 < outstanding) {
          throw new ValidationError(
            `Insufficient stock for ${product.sku} — ${product.name} (need ${outstanding}, have ${available})`,
          );
        }
        recordMove({
          productId: product.id,
          locationId: options.locationId,
          quantity: -outstanding,
          moveType: 'sale',
          referenceType: 'sales_order',
          referenceId: salesOrderId,
          unitCostCents: product.cost_cents,
          note: `Fulfilled ${order.number}`,
          userId: options.userId ?? null,
        });
      }
      db.prepare(
        'UPDATE sales_order_lines SET fulfilled_quantity = fulfilled_quantity + ? WHERE id = ?',
      ).run(outstanding, line.id);
    }

    db.prepare(
      "UPDATE sales_orders SET status = 'fulfilled', updated_at = datetime('now') WHERE id = ?",
    ).run(salesOrderId);
    return { id: salesOrderId, number: order.number };
  })();
}

export function adjustStock(input: {
  productId: number;
  locationId: number;
  quantity: number;
  note?: string | null;
  userId?: number | null;
}): number {
  requireProduct(input.productId);
  if (input.quantity === 0) throw new ValidationError('Adjustment quantity must be non-zero');
  return getDb().transaction(() =>
    recordMove({
      productId: input.productId,
      locationId: input.locationId,
      quantity: input.quantity,
      moveType: 'adjustment',
      referenceType: 'adjustment',
      note: input.note ?? 'Manual stock adjustment',
      userId: input.userId ?? null,
    }),
  )();
}
