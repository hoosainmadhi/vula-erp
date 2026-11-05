import request from 'supertest';
import { createApp } from '../app.js';
import { getDb } from '../db.js';
import { freshDb, seedPartner, seedProduct, seedUser } from '../test/helpers.js';

const app = createApp();

function seedEmployee(): number {
  const result = getDb()
    .prepare(
      `INSERT INTO employees (employee_number, first_name, last_name, start_date)
       VALUES ('EMP-8001', 'Lerato', 'Nkosi', '2026-01-01')`,
    )
    .run();
  return Number(result.lastInsertRowid);
}

function addLocation(warehouseCode: string, warehouseName: string): number {
  const warehouse = getDb()
    .prepare('INSERT INTO warehouses (code, name) VALUES (?, ?)')
    .run(warehouseCode, warehouseName);
  const warehouseId = Number(warehouse.lastInsertRowid);
  const location = getDb()
    .prepare(
      "INSERT INTO stock_locations (warehouse_id, code, name, is_default) VALUES (?, 'STOCK', 'Stock', 1)",
    )
    .run(warehouseId);
  return Number(location.lastInsertRowid);
}

describe('credit notes, transfers, branch reports, imports and polish', () => {
  let token = '';

  beforeEach(() => {
    freshDb();
    token = seedUser().token;
  });

  it('reduces invoice outstanding and receivables by posted credit notes', async () => {
    const customerId = seedPartner({ name: 'Kitchen Studio', isCustomer: true });
    const productId = seedProduct({ sku: 'CN-1', name: 'Board', salePriceCents: 100_000 });
    const invoice = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        direction: 'sale',
        partnerId: customerId,
        issueDate: '2026-11-05',
        dueDate: '2026-11-30',
        post: true,
        lines: [
          {
            productId,
            description: 'Board',
            quantity: 1,
            unitPriceCents: 100_000,
            taxRateBp: 1500,
          },
        ],
      })
      .expect(201);
    expect(invoice.body.invoice.total_cents).toBe(115_000);

    await request(app)
      .post('/api/credit-notes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        invoiceId: invoice.body.invoice.id,
        issueDate: '2026-11-05',
        subtotalCents: 20_000,
        taxCents: 3_000,
        reason: 'Damaged board',
      })
      .expect(201);

    const list = await request(app)
      .get('/api/invoices?direction=sale')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.invoices[0].credited_cents).toBe(23_000);
    expect(list.body.invoices[0].outstanding_cents).toBe(92_000);
    expect(list.body.summary.receivable_cents).toBe(92_000);

    const statement = await request(app)
      .get(`/api/partners/${customerId}/statement?direction=sale`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(statement.body.creditNotes).toHaveLength(1);
    expect(statement.body.invoices[0].outstanding_cents).toBe(92_000);
  });

  it('transfers stock between locations and blocks overselling', async () => {
    const productId = seedProduct({ sku: 'TR-1', name: 'Board', salePriceCents: 100_000 });
    const defaultLocation = (
      getDb().prepare("SELECT id FROM stock_locations WHERE code = 'STOCK'").get() as {
        id: number;
      }
    ).id;
    const eastLocation = addLocation('EAST', 'Eastern Cape');

    await request(app)
      .post('/api/inventory/stock/adjust')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId, locationId: defaultLocation, quantity: 10, note: 'Opening' })
      .expect(201);

    await request(app)
      .post('/api/inventory/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        productId,
        fromLocationId: defaultLocation,
        toLocationId: eastLocation,
        quantity: 4,
      })
      .expect(201);

    const levels = getDb()
      .prepare('SELECT location_id, quantity FROM stock_levels WHERE product_id = ?')
      .all(productId) as { location_id: number; quantity: number }[];
    expect(levels.find((row) => row.location_id === defaultLocation)?.quantity).toBe(6);
    expect(levels.find((row) => row.location_id === eastLocation)?.quantity).toBe(4);

    await request(app)
      .post('/api/inventory/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        productId,
        fromLocationId: eastLocation,
        toLocationId: defaultLocation,
        quantity: 99,
      })
      .expect(400);
  });

  it('reports branch sales and gross profit', async () => {
    const warehouseId = (
      getDb().prepare("SELECT id FROM warehouses WHERE code = 'MAIN'").get() as { id: number }
    ).id;
    const customerId = seedPartner({ name: 'Branch Customer', isCustomer: true });
    const productId = seedProduct({ sku: 'BP-1', name: 'Board', salePriceCents: 100_000 });
    await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        direction: 'sale',
        partnerId: customerId,
        warehouseId,
        issueDate: '2026-11-05',
        dueDate: '2026-11-30',
        post: true,
        lines: [
          {
            productId,
            description: 'Board',
            quantity: 2,
            unitPriceCents: 100_000,
            taxRateBp: 1500,
          },
        ],
      })
      .expect(201);

    const report = await request(app)
      .get('/api/accounting/reports/branches?from=2026-11-01&to=2026-11-30')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const row = report.body.rows.find(
      (entry: { warehouse_id: number }) => entry.warehouse_id === warehouseId,
    );
    expect(row.sales_cents).toBe(200_000);
    expect(report.body.totals.sales_cents).toBe(200_000);
  });

  it('imports opening stock and balanced opening balances', async () => {
    const productId = seedProduct({ sku: 'OS-1', name: 'Board', costCents: 60_000 });
    await request(app)
      .post('/api/imports/opening-stock')
      .set('Authorization', `Bearer ${token}`)
      .send({ csv: 'sku,location_code,quantity,unit_cost\nOS-1,STOCK,7,600.00' })
      .expect(201);
    const level = getDb()
      .prepare('SELECT quantity FROM stock_levels WHERE product_id = ?')
      .get(productId) as { quantity: number };
    expect(level.quantity).toBe(7);

    const balances = await request(app)
      .post('/api/imports/opening-balances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        csv: 'account_code,debit,credit,description\n1000,1000.00,,Opening bank\n3000,,1000.00,Opening equity',
        entryDate: '2026-11-05',
      })
      .expect(201);
    expect(balances.body.items).toBe(2);
    const entry = getDb()
      .prepare('SELECT COUNT(*) AS count FROM journal_items WHERE journal_entry_id = ?')
      .get(balances.body.journalEntryId) as { count: number };
    expect(entry.count).toBe(2);

    await request(app)
      .post('/api/imports/opening-balances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        csv: 'account_code,debit,credit\n1000,1000.00,\n3000,,900.00',
        entryDate: '2026-11-05',
      })
      .expect(400);
  });

  it('expires stale quotations and marks approved leave on attendance', async () => {
    const customerId = seedPartner({ name: 'Kitchen Studio', isCustomer: true });
    const productId = seedProduct({ sku: 'QT-1', name: 'Board', salePriceCents: 100_000 });
    const quote = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        quoteDate: '2020-01-01',
        validUntil: '2020-01-31',
        lines: [
          {
            productId,
            description: 'Board',
            quantity: 1,
            unitPriceCents: 100_000,
            taxRateBp: 1500,
          },
        ],
      })
      .expect(201);
    const list = await request(app)
      .get('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      list.body.quotations.find((row: { id: number }) => row.id === quote.body.quotation.id).status,
    ).toBe('expired');

    const employeeId = seedEmployee();
    const leaveTypeId = (
      getDb().prepare('SELECT id FROM leave_types ORDER BY id LIMIT 1').get() as { id: number }
    ).id;
    const leave = await request(app)
      .post('/api/leave/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        employeeId,
        leaveTypeId,
        startDate: '2026-11-09',
        endDate: '2026-11-10',
        reason: 'Family',
      })
      .expect(201);
    await request(app)
      .post(`/api/leave/requests/${leave.body.leaveRequest.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const attendance = getDb()
      .prepare('SELECT work_date, status FROM attendance WHERE employee_id = ? ORDER BY work_date')
      .all(employeeId) as { work_date: string; status: string }[];
    expect(attendance).toHaveLength(2);
    expect(attendance.every((row) => row.status === 'leave')).toBe(true);
  });
});
