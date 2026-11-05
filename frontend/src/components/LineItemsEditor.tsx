import { Plus, Trash2 } from 'lucide-react';
import { money } from '../lib/format';
import type { Product } from '../types';
import { btnSecondary, inputCls } from './ui';

export interface DraftLine {
  key: string;
  productId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRateBp: string;
}

let lineSequence = 0;

export function blankLine(): DraftLine {
  lineSequence += 1;
  return {
    key: `line-${Date.now()}-${lineSequence}`,
    productId: '',
    description: '',
    quantity: '1',
    unitPrice: '0.00',
    taxRateBp: '0',
  };
}

export interface LineTotals {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export function lineTotals(line: DraftLine): LineTotals {
  const quantity = Number(line.quantity) || 0;
  const unitCents = Math.round((Number(line.unitPrice) || 0) * 100);
  const subtotalCents = Math.round(quantity * unitCents);
  const taxCents = Math.round((subtotalCents * (Number(line.taxRateBp) || 0)) / 10_000);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

export function draftTotals(lines: DraftLine[]): LineTotals {
  return lines.reduce<LineTotals>(
    (total, line) => {
      const row = lineTotals(line);
      return {
        subtotalCents: total.subtotalCents + row.subtotalCents,
        taxCents: total.taxCents + row.taxCents,
        totalCents: total.totalCents + row.totalCents,
      };
    },
    { subtotalCents: 0, taxCents: 0, totalCents: 0 },
  );
}

interface StoredLine {
  product_id: number | null;
  description: string;
  quantity: number;
  tax_rate_bp: number;
  unit_cost_cents?: number;
  unit_price_cents?: number;
}

export function draftFromLines(lines: StoredLine[], priceKind: 'cost' | 'price'): DraftLine[] {
  if (lines.length === 0) return [blankLine()];
  return lines.map((line) => {
    lineSequence += 1;
    const unitCents =
      priceKind === 'cost' ? (line.unit_cost_cents ?? 0) : (line.unit_price_cents ?? 0);
    return {
      key: `line-${line.product_id ?? 'x'}-${lineSequence}`,
      productId: line.product_id ? String(line.product_id) : '',
      description: line.description,
      quantity: String(line.quantity),
      unitPrice: (unitCents / 100).toFixed(2),
      taxRateBp: String(line.tax_rate_bp ?? 0),
    };
  });
}

export function payloadLines(lines: DraftLine[], priceKind: 'cost' | 'price') {
  return lines.map((line) => ({
    productId: line.productId ? Number(line.productId) : null,
    description: line.description.trim(),
    quantity: Number(line.quantity) || 0,
    ...(priceKind === 'cost'
      ? { unitCostCents: Math.round((Number(line.unitPrice) || 0) * 100) }
      : { unitPriceCents: Math.round((Number(line.unitPrice) || 0) * 100) }),
    taxRateBp: Number(line.taxRateBp) || 0,
  }));
}

export function LineItemsEditor({
  lines,
  products,
  priceKind,
  onChange,
}: {
  lines: DraftLine[];
  products: Product[];
  priceKind: 'cost' | 'price';
  onChange: (lines: DraftLine[]) => void;
}) {
  const update = (key: string, patch: Partial<DraftLine>) => {
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const chooseProduct = (line: DraftLine, productId: string) => {
    const product = products.find((row) => String(row.id) === productId);
    if (!product) {
      update(line.key, { productId });
      return;
    }
    update(line.key, {
      productId,
      description: product.name,
      unitPrice: (
        (priceKind === 'cost' ? product.cost_cents : product.sale_price_cents) / 100
      ).toFixed(2),
      taxRateBp: String(product.tax_rate_bp ?? 0),
    });
  };

  const totals = draftTotals(lines);
  const cell = `${inputCls} px-2 py-1.5 text-sm`;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-2 py-2">Product</th>
              <th className="px-2 py-2">Description</th>
              <th className="w-20 px-2 py-2">Qty</th>
              <th className="w-28 px-2 py-2">Unit price</th>
              <th className="w-20 px-2 py-2">VAT %</th>
              <th className="w-28 px-2 py-2 text-right">Line total</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const row = lineTotals(line);
              return (
                <tr key={line.key} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-1.5">
                    <select
                      className={cell}
                      value={line.productId}
                      onChange={(event) => chooseProduct(line, event.target.value)}
                    >
                      <option value="">Custom line</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.sku} — {product.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      className={cell}
                      value={line.description}
                      onChange={(event) => update(line.key, { description: event.target.value })}
                      placeholder="Description"
                      required
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      className={cell}
                      type="number"
                      min={0.0001}
                      step="0.01"
                      value={line.quantity}
                      onChange={(event) => update(line.key, { quantity: event.target.value })}
                      required
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      className={cell}
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(event) => update(line.key, { unitPrice: event.target.value })}
                      required
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      className={cell}
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={(Number(line.taxRateBp) || 0) / 100}
                      onChange={(event) =>
                        update(line.key, {
                          taxRateBp: String(Math.round((Number(event.target.value) || 0) * 100)),
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-2 text-right font-semibold text-slate-800">
                    {money(row.totalCents)}
                  </td>
                  <td className="px-1 py-1.5">
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                      onClick={() => onChange(lines.filter((row2) => row2.key !== line.key))}
                      disabled={lines.length === 1}
                      title="Remove line"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          className={btnSecondary}
          onClick={() => onChange([...lines, blankLine()])}
        >
          <Plus className="size-4" /> Add line
        </button>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <span className="text-right text-slate-500">Subtotal</span>
          <span className="text-right font-medium text-slate-700">
            {money(totals.subtotalCents)}
          </span>
          <span />
          <span className="text-right text-slate-500">VAT</span>
          <span className="text-right font-medium text-slate-700">{money(totals.taxCents)}</span>
          <span />
          <span className="text-right font-semibold text-slate-800">Total</span>
          <span className="text-right text-base font-bold text-slate-900">
            {money(totals.totalCents)}
          </span>
          <span />
        </div>
      </div>
    </div>
  );
}
