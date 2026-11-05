import { Router } from 'express';
import { getDb } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { addMonths, monthStart, today } from '../utils/dates.js';
import { trialBalance } from '../services/accounting.js';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate, requirePermission('dashboard.view'));

dashboardRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const date = today();
    const start = monthStart(date);

    const scalar = (sql: string, ...params: unknown[]): number => {
      const row = db.prepare(sql).get(...params) as { value: number | null } | undefined;
      return row?.value ?? 0;
    };

    const salesThisMonthCents = scalar(
      "SELECT COALESCE(SUM(total_cents), 0) AS value FROM invoices WHERE direction = 'sale' AND status IN ('open','paid') AND issue_date BETWEEN ? AND ?",
      start,
      date,
    );
    const purchasesThisMonthCents = scalar(
      "SELECT COALESCE(SUM(total_cents), 0) AS value FROM invoices WHERE direction = 'purchase' AND status IN ('open','paid') AND issue_date BETWEEN ? AND ?",
      start,
      date,
    );
    const receivablesCents = scalar(
      "SELECT COALESCE(SUM(total_cents - amount_paid_cents), 0) AS value FROM invoices WHERE direction = 'sale' AND status = 'open'",
    );
    const payablesCents = scalar(
      "SELECT COALESCE(SUM(total_cents - amount_paid_cents), 0) AS value FROM invoices WHERE direction = 'purchase' AND status = 'open'",
    );

    const cashCents = trialBalance()
      .filter((row) => row.code === '1000' || row.code === '1010')
      .reduce((total, row) => total + row.balanceCents, 0);

    const lowStock = db
      .prepare(
        `SELECT p.id, p.sku, p.name, p.reorder_level,
                COALESCE((SELECT SUM(sl.quantity) FROM stock_levels sl WHERE sl.product_id = p.id), 0) AS quantity
         FROM products p
         WHERE p.track_inventory = 1 AND p.is_active = 1
           AND COALESCE((SELECT SUM(sl.quantity) FROM stock_levels sl WHERE sl.product_id = p.id), 0) <= p.reorder_level
         ORDER BY (p.reorder_level - COALESCE((SELECT SUM(sl.quantity) FROM stock_levels sl WHERE sl.product_id = p.id), 0)) DESC
         LIMIT 10`,
      )
      .all();

    const recentInvoices = db
      .prepare(
        `SELECT i.id, i.number, i.direction, i.status, i.issue_date, i.due_date, i.total_cents, i.amount_paid_cents,
                p.name AS partner_name
         FROM invoices i JOIN partners p ON p.id = i.partner_id
         ORDER BY i.id DESC LIMIT 8`,
      )
      .all();

    const months: { month: string; totalCents: number }[] = [];
    const salesByMonth = db
      .prepare(
        `SELECT substr(issue_date, 1, 7) AS month, SUM(total_cents) AS total
         FROM invoices
         WHERE direction = 'sale' AND status IN ('open','paid') AND issue_date >= ?
         GROUP BY month ORDER BY month`,
      )
      .all(addMonths(`${start.slice(0, 7)}-01`, -5)) as { month: string; total: number }[];
    for (let i = 5; i >= 0; i -= 1) {
      const month = addMonths(`${start.slice(0, 7)}-01`, -i).slice(0, 7);
      months.push({
        month,
        totalCents: salesByMonth.find((row) => row.month === month)?.total ?? 0,
      });
    }

    const topProducts = db
      .prepare(
        `SELECT COALESCE(p.name, l.description) AS name, SUM(l.line_subtotal_cents) AS total_cents,
                SUM(l.quantity) AS quantity
         FROM invoice_lines l
         JOIN invoices i ON i.id = l.invoice_id
         LEFT JOIN products p ON p.id = l.product_id
         WHERE i.direction = 'sale' AND i.status IN ('open','paid') AND i.issue_date BETWEEN ? AND ?
         GROUP BY COALESCE(p.id, l.description)
         ORDER BY total_cents DESC LIMIT 6`,
      )
      .all(start, date) as { name: string; total_cents: number; quantity: number }[];

    const openPurchaseOrders = scalar(
      "SELECT COUNT(*) AS value FROM purchase_orders WHERE status IN ('draft','confirmed')",
    );
    const openSalesOrders = scalar(
      "SELECT COUNT(*) AS value FROM sales_orders WHERE status IN ('draft','confirmed')",
    );

    res.json({
      asOf: date,
      kpis: {
        salesThisMonthCents,
        purchasesThisMonthCents,
        receivablesCents,
        payablesCents,
        cashAndBankCents: cashCents,
        openPurchaseOrders,
        openSalesOrders,
        productCount: scalar('SELECT COUNT(*) AS value FROM products WHERE is_active = 1'),
        partnerCount: scalar('SELECT COUNT(*) AS value FROM partners WHERE is_active = 1'),
        employeeCount: scalar("SELECT COUNT(*) AS value FROM employees WHERE status = 'active'"),
      },
      lowStock,
      recentInvoices,
      salesByMonth: months,
      topProducts,
    });
  }),
);
