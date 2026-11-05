import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Boxes,
  Users,
  Wallet,
} from 'lucide-react';
import { useFetch } from '../lib/useFetch';
import { money, shortDate } from '../lib/format';
import { Badge, Card, ErrorBox, PageHeader, Spinner } from '../components/ui';
import type { Dashboard } from '../types';

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'slate',
}: {
  label: string;
  value: string;
  hint?: string;
  icon: typeof Banknote;
  tone?: 'emerald' | 'amber' | 'blue' | 'slate';
}) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    blue: 'bg-blue-50 text-blue-700',
    slate: 'bg-slate-100 text-slate-700',
  };
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 truncate text-xl font-bold text-slate-900">{value}</p>
          {hint ? <p className="mt-0.5 text-xs text-slate-400">{hint}</p> : null}
        </div>
        <div className={`rounded-lg p-2 ${tones[tone]}`}>
          <Icon className="size-5" />
        </div>
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const { data, loading, error } = useFetch<Dashboard>('/dashboard');

  if (loading && !data) return <Spinner label="Loading dashboard…" />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return null;

  const { kpis } = data;
  const chartData = data.salesByMonth.map((row) => ({
    month: row.month.slice(5),
    sales: row.totalCents / 100,
  }));

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`Trading position as at ${shortDate(data.asOf)}`} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Sales this month"
          value={money(kpis.salesThisMonthCents)}
          hint={`${kpis.openSalesOrders} open sales order(s)`}
          icon={ArrowUpRight}
          tone="emerald"
        />
        <Kpi
          label="Purchases this month"
          value={money(kpis.purchasesThisMonthCents)}
          hint={`${kpis.openPurchaseOrders} open purchase order(s)`}
          icon={ArrowDownRight}
          tone="blue"
        />
        <Kpi
          label="Receivables"
          value={money(kpis.receivablesCents)}
          hint="Outstanding customer invoices"
          icon={Wallet}
          tone="amber"
        />
        <Kpi
          label="Payables"
          value={money(kpis.payablesCents)}
          hint="Outstanding supplier bills"
          icon={Banknote}
          tone="slate"
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-bold text-slate-900">Sales — last six months</h2>
          </div>
          <div className="h-64 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#059669" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#059669" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis
                  tick={{ fontSize: 12 }}
                  width={70}
                  tickFormatter={(value: number) => `R${value / 1000}k`}
                />
                <Tooltip formatter={(value) => money(Number(value) * 100)} />
                <Area
                  type="monotone"
                  dataKey="sales"
                  stroke="#059669"
                  strokeWidth={2}
                  fill="url(#salesFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-bold text-slate-900">Cash & bank</h2>
          </div>
          <div className="space-y-3 p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Cash position
              </p>
              <p className="text-2xl font-bold text-slate-900">{money(kpis.cashAndBankCents)}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-sm">
              <div>
                <p className="text-xs text-slate-500">Active products</p>
                <p className="font-semibold text-slate-800">{kpis.productCount}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Partners</p>
                <p className="font-semibold text-slate-800">{kpis.partnerCount}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Employees</p>
                <p className="font-semibold text-slate-800">{kpis.employeeCount}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Low stock items</p>
                <p className="font-semibold text-slate-800">{data.lowStock.length}</p>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <AlertTriangle className="size-4 text-amber-500" />
            <h2 className="text-sm font-bold text-slate-900">Low stock</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2">SKU</th>
                  <th className="px-4 py-2">Product</th>
                  <th className="px-4 py-2 text-right">On hand</th>
                  <th className="px-4 py-2 text-right">Reorder at</th>
                </tr>
              </thead>
              <tbody>
                {data.lowStock.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                      Everything is above its reorder level.
                    </td>
                  </tr>
                ) : (
                  data.lowStock.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-mono text-xs text-slate-500">{row.sku}</td>
                      <td className="px-4 py-2 font-medium text-slate-800">{row.name}</td>
                      <td className="px-4 py-2 text-right font-semibold text-amber-700">
                        {row.quantity}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-500">{row.reorder_level}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <Boxes className="size-4 text-emerald-600" />
            <h2 className="text-sm font-bold text-slate-900">Recent invoices</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2">Number</th>
                  <th className="px-4 py-2">Partner</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.recentInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                      No invoices yet.
                    </td>
                  </tr>
                ) : (
                  data.recentInvoices.map((invoice) => (
                    <tr key={invoice.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-mono text-xs text-slate-600">
                        {invoice.number}
                      </td>
                      <td className="px-4 py-2 text-slate-800">{invoice.partner_name}</td>
                      <td className="px-4 py-2">
                        <Badge value={invoice.status} />
                      </td>
                      <td className="px-4 py-2 text-right font-semibold text-slate-800">
                        {money(invoice.total_cents)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {data.topProducts.length > 0 ? (
        <Card className="mt-4">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <Users className="size-4 text-blue-600" />
            <h2 className="text-sm font-bold text-slate-900">Top products this month</h2>
          </div>
          <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.topProducts.map((product) => (
              <div
                key={product.name}
                className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
              >
                <p className="truncate text-sm font-semibold text-slate-800">{product.name}</p>
                <p className="text-xs text-slate-500">
                  {money(product.total_cents)} · {product.quantity} sold
                </p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </>
  );
}
