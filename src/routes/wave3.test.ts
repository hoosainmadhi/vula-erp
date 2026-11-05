import request from 'supertest';
import { createApp } from '../app.js';
import { getDb } from '../db.js';
import { defaultLocationId, freshDb, seedProduct, seedUser } from '../test/helpers.js';

const app = createApp();

function stock(productId: number, locationId: number, quantity: number): void {
  getDb()
    .prepare(
      `INSERT INTO stock_levels (product_id, location_id, quantity, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (product_id, location_id) DO UPDATE SET quantity = excluded.quantity`,
    )
    .run(productId, locationId, quantity);
}

describe('wave 3 manufacturing', () => {
  let token = '';

  beforeEach(() => {
    freshDb();
    token = seedUser().token;
  });

  it('runs a BOM through a manufacturing order and updates stock', async () => {
    const locationId = defaultLocationId();
    const desk = seedProduct({ sku: 'DESK-1', name: 'Assembled Desk', costCents: 10_000 });
    const board = seedProduct({ sku: 'BOARD-1', name: 'Board', costCents: 6_000 });
    const screw = seedProduct({ sku: 'SCREW-1', name: 'Screw', costCents: 500 });
    stock(board, locationId, 10);
    stock(screw, locationId, 20);

    const workCenter = await request(app)
      .post('/api/manufacturing/work-centers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Assembly bench', code: 'ASM', costPerHourCents: 12_000, capacityPerDay: 8 })
      .expect(201);
    expect(workCenter.body.workCenter.code).toBe('ASM');

    const operation = await request(app)
      .post('/api/manufacturing/operations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Assemble',
        workCenterId: workCenter.body.workCenter.id,
        durationMinutes: 30,
      })
      .expect(201);

    const bom = await request(app)
      .post('/api/manufacturing/boms')
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'BOM-DESK-1',
        productId: desk,
        quantity: 1,
        lines: [
          { productId: board, quantity: 1 },
          { productId: screw, quantity: 2 },
        ],
        operationIds: [operation.body.operation.id],
      })
      .expect(201);
    expect(bom.body.bom.lines).toHaveLength(2);
    expect(bom.body.bom.operations).toHaveLength(1);
    expect(bom.body.bom.operations[0].work_center_name).toBe('Assembly bench');

    const order = await request(app)
      .post('/api/manufacturing/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        productId: desk,
        bomId: bom.body.bom.id,
        quantity: 2,
        priority: 'high',
        sourceLocationId: locationId,
        destinationLocationId: locationId,
      })
      .expect(201);
    expect(order.body.order.number).toBe('MO-00001');
    expect(order.body.order.status).toBe('draft');
    expect(order.body.order.components).toHaveLength(2);
    expect(order.body.order.components[0].required_quantity).toBe(2);
    expect(order.body.order.components[1].required_quantity).toBe(4);

    const orderId = order.body.order.id;
    await request(app)
      .post(`/api/manufacturing/orders/${orderId}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app)
      .post(`/api/manufacturing/orders/${orderId}/start`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const operationId = order.body.order.operations[0].id;
    await request(app)
      .post(`/api/manufacturing/orders/${orderId}/operations/${operationId}/start`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app)
      .post(`/api/manufacturing/orders/${orderId}/operations/${operationId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ durationMinutes: 45 })
      .expect(200);

    const done = await request(app)
      .post(`/api/manufacturing/orders/${orderId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(done.body.order.status).toBe('done');
    expect(done.body.order.material_cost_cents).toBe(2 * 6_000 + 4 * 500);
    expect(done.body.order.operation_cost_cents).toBe(9_000);
    expect(done.body.order.total_cost_cents).toBe(23_000);

    const levels = getDb()
      .prepare('SELECT product_id, quantity FROM stock_levels WHERE location_id = ?')
      .all(locationId) as { product_id: number; quantity: number }[];
    const byProduct = new Map(levels.map((row) => [row.product_id, row.quantity]));
    expect(byProduct.get(board)).toBe(8);
    expect(byProduct.get(screw)).toBe(16);
    expect(byProduct.get(desk)).toBe(2);

    const detail = await request(app)
      .get(`/api/manufacturing/orders/${orderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      detail.body.order.components.every(
        (line: { consumed_quantity: number }) => line.consumed_quantity > 0,
      ),
    ).toBe(true);
  });

  it('refuses to start an order without enough components', async () => {
    const locationId = defaultLocationId();
    const desk = seedProduct({ sku: 'DESK-2', name: 'Desk' });
    const board = seedProduct({ sku: 'BOARD-2', name: 'Board' });
    stock(board, locationId, 1);

    const bom = await request(app)
      .post('/api/manufacturing/boms')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'BOM-DESK-2', productId: desk, lines: [{ productId: board, quantity: 2 }] })
      .expect(201);
    const order = await request(app)
      .post('/api/manufacturing/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: desk, bomId: bom.body.bom.id, quantity: 1, sourceLocationId: locationId })
      .expect(201);

    await request(app)
      .post(`/api/manufacturing/orders/${order.body.order.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const res = await request(app)
      .post(`/api/manufacturing/orders/${order.body.order.id}/start`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(res.body.error).toMatch(/insufficient stock/i);
  });

  describe('point of sale', () => {
    it('opens a session, sells, posts an invoice and payment, and cashes up', async () => {
      const locationId = defaultLocationId();
      const product = seedProduct({
        sku: 'POS-1',
        name: 'Counter item',
        salePriceCents: 11_500,
        costCents: 6_000,
      });
      stock(product, locationId, 10);

      const registers = await request(app)
        .get('/api/pos/registers')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(registers.body.registers).toHaveLength(1);
      const register = registers.body.registers[0];

      const session = await request(app)
        .post('/api/pos/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({ registerId: register.id, openingFloatCents: 50_000 })
        .expect(201);
      expect(session.body.session.status).toBe('open');
      expect(session.body.session.opening_float_cents).toBe(50_000);

      const sale = await request(app)
        .post('/api/pos/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          registerId: register.id,
          sessionId: session.body.session.id,
          paymentMethod: 'cash',
          amountTenderedCents: 20_000,
          lines: [{ productId: product, quantity: 1 }],
        })
        .expect(201);
      expect(sale.body.order.number).toBe('POS-00001');
      expect(sale.body.order.status).toBe('paid');
      expect(sale.body.order.subtotal_cents).toBe(11_500);
      expect(sale.body.order.tax_cents).toBe(1_725);
      expect(sale.body.order.total_cents).toBe(13_225);
      expect(sale.body.order.change_cents).toBe(6_775);
      expect(sale.body.order.lines).toHaveLength(1);

      const invoice = getDb()
        .prepare('SELECT * FROM invoices WHERE id = ?')
        .get(sale.body.order.invoice_id) as { status: string; total_cents: number };
      expect(invoice.status).toBe('paid');
      expect(invoice.total_cents).toBe(13_225);

      const payment = getDb()
        .prepare('SELECT * FROM payments WHERE id = ?')
        .get(sale.body.order.payment_id) as { amount_cents: number; method: string };
      expect(payment.amount_cents).toBe(13_225);
      expect(payment.method).toBe('cash');

      const level = getDb()
        .prepare('SELECT quantity FROM stock_levels WHERE product_id = ? AND location_id = ?')
        .get(product, locationId) as { quantity: number };
      expect(level.quantity).toBe(9);

      const openSessions = await request(app)
        .get('/api/pos/sessions?status=open')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(openSessions.body.sessions[0].live_expected_cash_cents).toBe(63_225);

      const closed = await request(app)
        .post(`/api/pos/sessions/${session.body.session.id}/close`)
        .set('Authorization', `Bearer ${token}`)
        .send({ closingCashCents: 63_225 })
        .expect(200);
      expect(closed.body.session.status).toBe('closed');
      expect(closed.body.session.expected_cash_cents).toBe(63_225);
      expect(closed.body.session.difference_cents).toBe(0);
    });

    it('refuses a sale without an open session and reports cash-up variance', async () => {
      const product = seedProduct({ sku: 'POS-2', name: 'Counter item 2' });
      const registers = await request(app)
        .get('/api/pos/registers')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const register = registers.body.registers[0];

      const noSession = await request(app)
        .post('/api/pos/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          registerId: register.id,
          paymentMethod: 'cash',
          lines: [{ productId: product, quantity: 1 }],
        })
        .expect(400);
      expect(noSession.body.error).toMatch(/open a pos session/i);

      const session = await request(app)
        .post('/api/pos/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({ registerId: register.id, openingFloatCents: 10_000 })
        .expect(201);
      const closed = await request(app)
        .post(`/api/pos/sessions/${session.body.session.id}/close`)
        .set('Authorization', `Bearer ${token}`)
        .send({ closingCashCents: 9_500 })
        .expect(200);
      expect(closed.body.session.difference_cents).toBe(-500);
    });

    it('blocks the POS API when the module is disabled', async () => {
      await request(app)
        .post('/api/modules/pos/disable')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const res = await request(app)
        .get('/api/pos/registers')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(res.body.code).toBe('module_disabled');
    });
  });

  it('blocks the manufacturing API when the module is disabled', async () => {
    await request(app)
      .post('/api/modules/manufacturing/disable')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const res = await request(app)
      .get('/api/manufacturing/orders')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(res.body.code).toBe('module_disabled');
  });
});
