import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Barcode as BarcodeIcon, Printer, ScanLine, Search } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useFetch } from '../lib/useFetch';
import { code39 } from '../lib/barcode';
import { money, titleCase } from '../lib/format';
import Barcode from '../components/Barcode';
import {
  btnPrimary,
  btnSecondary,
  Card,
  EmptyState,
  ErrorBox,
  inputCls,
  PageHeader,
  Spinner,
  tdCls,
  thCls,
} from '../components/ui';
import type { BarcodeLocation, BarcodeProduct } from '../types';

type Tab = 'scan' | 'labels';

interface ScanResult {
  product: BarcodeProduct;
  locations: BarcodeLocation[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function labelSvg(value: string): string {
  const pattern = code39(value);
  const bars = pattern.bars
    .map((bar) => `<rect x="${bar.x}" y="0" width="${bar.width}" height="50" fill="#000"/>`)
    .join('');
  return `<svg viewBox="0 0 ${pattern.width} 50" preserveAspectRatio="none" style="width:100%;height:13mm;display:block">${bars}</svg>`;
}

export default function BarcodePage() {
  const [tab, setTab] = useState<Tab>('scan');
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<{ code: string; name: string }[]>([]);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (tab === 'scan') inputRef.current?.focus();
  }, [tab]);

  const lookup = async (event: FormEvent) => {
    event.preventDefault();
    const value = code.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api.get<ScanResult>(
        `/barcode/lookup?code=${encodeURIComponent(value)}`,
      );
      setResult(response);
      setRecent((current) =>
        [
          { code: value, name: response.product.name },
          ...current.filter((r) => r.code !== value),
        ].slice(0, 6),
      );
      setCode('');
    } catch (err) {
      setResult(null);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const labels = useFetch<{ products: BarcodeProduct[] }>(
    tab === 'labels' ? `/barcode/labels${query ? `?q=${encodeURIComponent(query)}` : ''}` : null,
    [query],
  );

  const toggle = (id: number) => {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const print = () => {
    const products = (labels.data?.products ?? []).filter((product) => chosen.has(product.id));
    if (products.length === 0) return;
    const html = products
      .map((product) => {
        const value = product.barcode ?? product.sku;
        return `<div class="label">
          ${labelSvg(value)}
          <p class="name">${escapeHtml(product.name)}</p>
          <p class="meta">${escapeHtml(product.sku)} · ${escapeHtml(product.uom)}</p>
          <p class="price">${escapeHtml(money(product.sale_price_cents))}</p>
        </div>`;
      })
      .join('');

    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
      setError('Pop-up blocked. Allow pop-ups to print labels.');
      return;
    }
    win.document.write(`<!doctype html><html><head><title>Barcode labels</title>
      <style>
        @page { margin: 8mm; }
        body { font-family: system-ui, sans-serif; margin: 0; }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5mm; }
        .label { border: 1px solid #ddd; border-radius: 2mm; padding: 3mm; text-align: center; page-break-inside: avoid; }
        .label p { margin: 0; }
        .name { font-size: 9pt; font-weight: 600; }
        .meta { font-size: 7pt; color: #555; }
        .price { font-size: 9pt; margin-top: 1mm !important; }
      </style></head><body><div class="grid">${html}</div></body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const selectedCount = chosen.size;

  return (
    <>
      <PageHeader
        title="Barcode"
        subtitle="Scan products to find stock, and print Code 39 labels"
        actions={
          tab === 'labels' ? (
            <button
              type="button"
              className={btnPrimary}
              disabled={selectedCount === 0}
              onClick={print}
            >
              <Printer className="size-4" /> Print {selectedCount || ''} label
              {selectedCount === 1 ? '' : 's'}
            </button>
          ) : null
        }
      />

      <div className="mb-4 flex rounded-lg border border-slate-200 bg-white p-1">
        {(
          [
            ['scan', 'Scan'],
            ['labels', 'Labels'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === value ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {value === 'scan' ? (
              <ScanLine className="size-4" />
            ) : (
              <BarcodeIcon className="size-4" />
            )}
            {label}
          </button>
        ))}
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {tab === 'scan' ? (
        <div className="space-y-4">
          <Card className="p-4">
            <form onSubmit={lookup} className="flex flex-wrap items-end gap-2">
              <label className="min-w-64 flex-1">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Barcode or SKU
                </span>
                <div className="relative">
                  <ScanLine className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
                  <input
                    ref={inputRef}
                    className={`${inputCls} pl-9`}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="Scan a barcode or type a SKU…"
                    autoComplete="off"
                  />
                </div>
              </label>
              <button type="submit" className={btnPrimary} disabled={busy}>
                {busy ? 'Looking up…' : 'Look up'}
              </button>
            </form>
            {recent.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {recent.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100"
                    onClick={() => setCode(item.code)}
                  >
                    <span className="font-mono">{item.code}</span> · {item.name}
                  </button>
                ))}
              </div>
            ) : null}
          </Card>

          {result ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="p-4 lg:col-span-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-slate-400">{result.product.sku}</p>
                    <h2 className="text-lg font-bold text-slate-900">{result.product.name}</h2>
                    <p className="text-sm text-slate-500">
                      {result.product.category_name ?? 'Uncategorised'} · {result.product.uom}
                      {result.product.is_active === 0 ? ' · inactive' : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide text-slate-400">On hand</p>
                    <p className="text-2xl font-bold text-slate-900">
                      {result.product.stock_quantity}
                    </p>
                    <p className="text-xs text-slate-400">
                      reorder at {result.product.reorder_level}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Sale price</p>
                    <p className="text-lg font-semibold text-slate-900">
                      {money(result.product.sale_price_cents)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Cost</p>
                    <p className="text-lg font-semibold text-slate-900">
                      {money(result.product.cost_cents)}
                    </p>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Stock by location
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr>
                          <th className={thCls}>Warehouse</th>
                          <th className={thCls}>Location</th>
                          <th className={`${thCls} text-right`}>Quantity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.locations.length === 0 ? (
                          <EmptyState colSpan={3} message="No stock recorded for this product." />
                        ) : (
                          result.locations.map((location) => (
                            <tr key={location.location_id} className="hover:bg-slate-50">
                              <td className={tdCls}>
                                {location.warehouse_name}
                                <span className="ml-1 font-mono text-xs text-slate-400">
                                  {location.warehouse_code}
                                </span>
                              </td>
                              <td className={tdCls}>
                                {location.location_name}
                                <span className="ml-1 font-mono text-xs text-slate-400">
                                  {location.location_code}
                                </span>
                              </td>
                              <td className={`${tdCls} text-right font-semibold`}>
                                {location.quantity}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </Card>

              <Card className="flex flex-col items-center justify-center gap-3 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {result.product.barcode ? 'Product barcode' : 'SKU (no barcode set)'}
                </p>
                <Barcode value={result.product.barcode ?? result.product.sku} height={64} />
                <p className="text-center text-xs text-slate-400">
                  Code 39 · scannable where the symbology is supported
                </p>
              </Card>
            </div>
          ) : (
            <Card className="p-8 text-center text-sm text-slate-400">
              Scan or type a barcode to see the product and its stock on hand.
            </Card>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
              <input
                className={`${inputCls} pl-9`}
                placeholder="Search products with barcodes…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <button
              type="button"
              className={btnSecondary}
              onClick={() =>
                setChosen(new Set((labels.data?.products ?? []).map((product) => product.id)))
              }
            >
              Select all
            </button>
            <button type="button" className={btnSecondary} onClick={() => setChosen(new Set())}>
              Clear
            </button>
            <span className="text-sm text-slate-500">{selectedCount} selected</span>
          </div>

          {labels.loading && !labels.data ? (
            <Spinner />
          ) : labels.error ? (
            <ErrorBox message={labels.error} />
          ) : (labels.data?.products ?? []).length === 0 ? (
            <Card className="p-8 text-center text-sm text-slate-400">
              No products have a barcode yet. Add one on the Products page.
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {(labels.data?.products ?? []).map((product) => (
                <label
                  key={product.id}
                  className={`flex cursor-pointer gap-3 rounded-xl border bg-white p-3 shadow-sm transition ${
                    chosen.has(product.id)
                      ? 'border-emerald-500 ring-2 ring-emerald-500/30'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1 size-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    checked={chosen.has(product.id)}
                    onChange={() => toggle(product.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{product.name}</p>
                    <p className="font-mono text-xs text-slate-400">
                      {product.sku} · {product.barcode}
                    </p>
                    <div className="mt-2">
                      <Barcode
                        value={product.barcode ?? product.sku}
                        height={36}
                        showValue={false}
                      />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {money(product.sale_price_cents)} · {titleCase(product.uom)}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
