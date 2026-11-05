import request from 'supertest';
import { createApp } from '../app.js';
import { getDb } from '../db.js';
import { freshDb, seedUser } from '../test/helpers.js';

const app = createApp();

describe('bank reconciliation and data import', () => {
  let token = '';

  beforeEach(() => {
    freshDb();
    token = seedUser().token;
  });

  it('imports statement lines, matches a ledger entry and reports the difference', async () => {
    const account = await request(app)
      .post('/api/banking/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'FNB Current', bankName: 'FNB', openingBalanceCents: 0 })
      .expect(201);
    const bankAccountId = account.body.account.id;

    await request(app)
      .post('/api/banking/transactions/import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        bankAccountId,
        csv: 'date,description,reference,amount\n2026-11-05,City Power,ELEC-1,-2300.00\n2026-11-06,Customer deposit,DEP-1,5000.00',
      })
      .expect(201)
      .expect((response) => {
        expect(response.body.imported).toBe(2);
      });

    // Post an expense so there is a ledger entry on the bank account.
    const expense = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        expenseDate: '2026-11-05',
        category: 'Utilities',
        description: 'City Power',
        amountCents: 200_000,
        taxCents: 30_000,
        paymentMethod: 'bank',
        post: true,
      })
      .expect(201);

    const candidates = await request(app)
      .get(`/api/banking/candidates?bankAccountId=${bankAccountId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(candidates.body.candidates).toHaveLength(1);
    expect(candidates.body.candidates[0].journal_entry_id).toBe(
      expense.body.expense.journal_entry_id,
    );

    const transactions = await request(app)
      .get(`/api/banking/transactions?bankAccountId=${bankAccountId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const outflow = transactions.body.transactions.find(
      (row: { amount_cents: number }) => row.amount_cents < 0,
    );

    await request(app)
      .post(`/api/banking/transactions/${outflow.id}/match`)
      .set('Authorization', `Bearer ${token}`)
      .send({ journalEntryId: expense.body.expense.journal_entry_id })
      .expect(200);

    const summary = await request(app)
      .get(`/api/banking/summary?bankAccountId=${bankAccountId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(summary.body.transactions).toBe(2);
    expect(summary.body.statementBalanceCents).toBe(270_000);
    expect(summary.body.reconciledBalanceCents).toBe(-230_000);
    expect(summary.body.ledgerBalanceCents).toBe(-230_000);
    expect(summary.body.differenceCents).toBe(0);
  });

  it('imports Odoo-style product and partner CSV rows and updates on re-import', async () => {
    const productsCsv = [
      'default_code,name,list_price,standard_price,barcode,category',
      'OD-1,Odoo board,899.00,620.00,6001234567890,Boards',
    ].join('\n');
    const first = await request(app)
      .post('/api/imports/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ csv: productsCsv })
      .expect(201);
    expect(first.body.created).toBe(1);
    expect(first.body.errors).toHaveLength(0);

    const product = getDb().prepare("SELECT * FROM products WHERE sku = 'OD-1'").get() as {
      name: string;
      sale_price_cents: number;
      cost_cents: number;
      barcode: string;
    };
    expect(product.name).toBe('Odoo board');
    expect(product.sale_price_cents).toBe(89_900);
    expect(product.cost_cents).toBe(62_000);
    expect(product.barcode).toBe('6001234567890');

    const second = await request(app)
      .post('/api/imports/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        csv: 'default_code,name,list_price,standard_price\nOD-1,Odoo board v2,999.00,650.00',
      })
      .expect(201);
    expect(second.body.updated).toBe(1);
    expect(second.body.created).toBe(0);

    const partners = await request(app)
      .post('/api/imports/partners')
      .set('Authorization', `Bearer ${token}`)
      .send({
        csv: 'name,email,is_customer,is_supplier\nAcme Kitchens,orders@acme.co.za,true,false',
      })
      .expect(201);
    expect(partners.body.created).toBe(1);
    const partner = getDb()
      .prepare("SELECT * FROM partners WHERE name = 'Acme Kitchens'")
      .get() as {
      is_customer: number;
      is_supplier: number;
    };
    expect(partner.is_customer).toBe(1);
    expect(partner.is_supplier).toBe(0);
  });
});
