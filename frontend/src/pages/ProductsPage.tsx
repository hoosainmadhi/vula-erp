import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../lib/useFetch';
import { money, percent, titleCase } from '../lib/format';
import {
  btnGhost,
  btnPrimary,
  btnSecondary,
  EmptyState,
  ErrorBox,
  Field,
  inputCls,
  Modal,
  PageHeader,
  Spinner,
  tdCls,
  thCls,
} from '../components/ui';
import type { Category, Product, TaxRate } from '../types';

type Tab = 'products' | 'categories' | 'tax';

function ProductForm({
  product,
  categories,
  taxRates,
  onSaved,
  onClose,
}: {
  product: Product | null;
  categories: Category[];
  taxRates: TaxRate[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    name: product?.name ?? '',
    description: product?.description ?? '',
    brand: product?.brand ?? '',
    colour: product?.colour ?? '',
    size: product?.size ?? '',
    thickness: product?.thickness ?? '',
    categoryId: product?.category_id ? String(product.category_id) : '',
    type: product?.type ?? 'goods',
    uom: product?.uom ?? 'unit',
    salePrice: ((product?.sale_price_cents ?? 0) / 100).toFixed(2),
    cost: ((product?.cost_cents ?? 0) / 100).toFixed(2),
    taxRateId: product?.tax_rate_id ? String(product.tax_rate_id) : '',
    trackInventory: product ? product.track_inventory === 1 : true,
    reorderLevel: String(product?.reorder_level ?? 0),
    isActive: product ? product.is_active === 1 : true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form, value: string | boolean) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      ...form,
      categoryId: form.categoryId ? Number(form.categoryId) : null,
      taxRateId: form.taxRateId ? Number(form.taxRateId) : null,
      salePriceCents: Math.round(Number(form.salePrice || 0) * 100),
      costCents: Math.round(Number(form.cost || 0) * 100),
      reorderLevel: Number(form.reorderLevel || 0),
    };
    try {
      if (product) await api.put(`/products/${product.id}`, payload);
      else await api.post('/products', payload);
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? <ErrorBox message={error} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="SKU">
          <input
            className={inputCls}
            value={form.sku}
            onChange={(e) => set('sku', e.target.value)}
            required
          />
        </Field>
        <Field label="Barcode">
          <input
            className={inputCls}
            value={form.barcode}
            onChange={(e) => set('barcode', e.target.value)}
          />
        </Field>
      </div>
      <Field label="Name">
        <input
          className={inputCls}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          required
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Brand">
          <input
            className={inputCls}
            value={form.brand}
            onChange={(e) => set('brand', e.target.value)}
            placeholder="PG Bison"
          />
        </Field>
        <Field label="Colour">
          <input
            className={inputCls}
            value={form.colour}
            onChange={(e) => set('colour', e.target.value)}
            placeholder="White"
          />
        </Field>
        <Field label="Size">
          <input
            className={inputCls}
            value={form.size}
            onChange={(e) => set('size', e.target.value)}
            placeholder="2750x1830"
          />
        </Field>
        <Field label="Thickness">
          <input
            className={inputCls}
            value={form.thickness}
            onChange={(e) => set('thickness', e.target.value)}
            placeholder="16mm"
          />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Type">
          <select
            className={inputCls}
            value={form.type}
            onChange={(e) => set('type', e.target.value)}
          >
            <option value="goods">Goods</option>
            <option value="service">Service</option>
          </select>
        </Field>
        <Field label="Category">
          <select
            className={inputCls}
            value={form.categoryId}
            onChange={(e) => set('categoryId', e.target.value)}
          >
            <option value="">Uncategorised</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Unit">
          <input
            className={inputCls}
            value={form.uom}
            onChange={(e) => set('uom', e.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Sale price (excl VAT, R)">
          <input
            className={inputCls}
            type="number"
            step="0.01"
            min={0}
            value={form.salePrice}
            onChange={(e) => set('salePrice', e.target.value)}
          />
        </Field>
        <Field label="Cost (R)">
          <input
            className={inputCls}
            type="number"
            step="0.01"
            min={0}
            value={form.cost}
            onChange={(e) => set('cost', e.target.value)}
          />
        </Field>
        <Field label="VAT rate">
          <select
            className={inputCls}
            value={form.taxRateId}
            onChange={(e) => set('taxRateId', e.target.value)}
          >
            <option value="">No VAT</option>
            {taxRates.map((tax) => (
              <option key={tax.id} value={tax.id}>
                {tax.name} ({percent(tax.rate_bp)})
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Reorder level">
          <input
            className={inputCls}
            type="number"
            min={0}
            step="0.01"
            value={form.reorderLevel}
            onChange={(e) => set('reorderLevel', e.target.value)}
          />
        </Field>
        <div className="flex items-end gap-5 pb-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.trackInventory}
              onChange={(e) => set('trackInventory', e.target.checked)}
            />
            Track stock
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => set('isActive', e.target.checked)}
            />
            Active
          </label>
        </div>
      </div>
      <Field label="Description">
        <textarea
          className={inputCls}
          rows={3}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : product ? 'Save changes' : 'Create product'}
        </button>
      </div>
    </form>
  );
}

function SimpleNameModal({
  title,
  initialName,
  initialExtra,
  extraLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  initialName: string;
  initialExtra: string;
  extraLabel: string;
  onSubmit: (payload: { name: string; description: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialExtra);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSubmit({ name, description });
          onClose();
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
      className="space-y-3"
    >
      {error ? <ErrorBox message={error} /> : null}
      <Field label="Name">
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Field>
      <Field label={extraLabel}>
        <input
          className={inputCls}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

export default function ProductsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('products');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Product | null | 'new'>(null);
  const [categoryModal, setCategoryModal] = useState<Category | null | 'new'>(null);
  const [taxModal, setTaxModal] = useState<TaxRate | null | 'new'>(null);
  const [error, setError] = useState<string | null>(null);

  const products = useFetch<{ products: Product[]; total: number }>(
    `/products?${new URLSearchParams(query ? { q: query } : {}).toString()}`,
    [query],
  );
  const categories = useFetch<{ categories: Category[] }>('/product-categories');
  const taxRates = useFetch<{ taxRates: TaxRate[] }>('/tax-rates');

  const removeProduct = async (product: Product) => {
    if (!window.confirm(`Delete ${product.name}?`)) return;
    setError(null);
    try {
      await api.del(`/products/${product.id}`);
      products.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const removeCategory = async (category: Category) => {
    if (!window.confirm(`Delete category ${category.name}?`)) return;
    setError(null);
    try {
      await api.del(`/product-categories/${category.id}`);
      categories.reload();
      products.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const removeTax = async (tax: TaxRate) => {
    if (!window.confirm(`Delete tax rate ${tax.name}?`)) return;
    setError(null);
    try {
      await api.del(`/tax-rates/${tax.id}`);
      taxRates.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Catalogue, categories and VAT rates"
        actions={
          can('products.manage') ? (
            <button
              type="button"
              className={btnPrimary}
              onClick={() => {
                if (tab === 'products') setEditing('new');
                else if (tab === 'categories') setCategoryModal('new');
                else setTaxModal('new');
              }}
            >
              <Plus className="size-4" />
              {tab === 'products'
                ? 'New product'
                : tab === 'categories'
                  ? 'New category'
                  : 'New tax rate'}
            </button>
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {(
            [
              ['products', 'Products'],
              ['categories', 'Categories'],
              ['tax', 'VAT rates'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === value ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'products' ? (
          <div className="relative min-w-56 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
            <input
              className={`${inputCls} pl-9`}
              placeholder="Search name, SKU, barcode, brand, colour…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        ) : null}
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {tab === 'products' ? (
        products.loading && !products.data ? (
          <Spinner />
        ) : products.error ? (
          <ErrorBox message={products.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>SKU</th>
                  <th className={thCls}>Product</th>
                  <th className={thCls}>Category</th>
                  <th className={thCls}>Type</th>
                  <th className={thCls} />
                  <th className={thCls} />
                  <th className={`${thCls} text-right`}>Sale price</th>
                  <th className={`${thCls} text-right`}>Cost</th>
                  <th className={`${thCls} text-right`}>On hand</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {!products.data || products.data.products.length === 0 ? (
                  <EmptyState colSpan={10} message="No products found." />
                ) : (
                  products.data.products.map((product) => (
                    <tr key={product.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-mono text-xs text-slate-500`}>{product.sku}</td>
                      <td className={tdCls}>
                        <p className="font-semibold text-slate-800">{product.name}</p>
                        <p className="text-xs text-slate-400">
                          {[product.brand, product.colour, product.size, product.thickness]
                            .filter(Boolean)
                            .join(' · ') ||
                            product.barcode ||
                            product.uom}
                        </p>
                      </td>
                      <td className={tdCls}>{product.category_name ?? '—'}</td>
                      <td className={tdCls}>{titleCase(product.type)}</td>
                      <td className={`${tdCls} text-xs text-slate-500`}>
                        {product.tax_rate_bp !== null ? percent(product.tax_rate_bp) : 'No VAT'}
                      </td>
                      <td className={tdCls}>
                        {product.is_active === 1 ? (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">
                            Active
                          </span>
                        ) : (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-500">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className={`${tdCls} text-right font-semibold`}>
                        {money(product.sale_price_cents)}
                      </td>
                      <td className={`${tdCls} text-right text-slate-500`}>
                        {money(product.cost_cents)}
                      </td>
                      <td
                        className={`${tdCls} text-right font-semibold ${
                          product.track_inventory && product.stock_quantity <= product.reorder_level
                            ? 'text-amber-700'
                            : 'text-slate-700'
                        }`}
                      >
                        {product.track_inventory ? product.stock_quantity : '—'}
                      </td>
                      <td className={tdCls}>
                        {can('products.manage') ? (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => setEditing(product)}
                            >
                              <Pencil className="size-4" />
                            </button>
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => removeProduct(product)}
                            >
                              <Trash2 className="size-4 text-red-500" />
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === 'categories' ? (
        categories.loading && !categories.data ? (
          <Spinner />
        ) : categories.error ? (
          <ErrorBox message={categories.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Category</th>
                  <th className={thCls}>Description</th>
                  <th className={`${thCls} text-right`}>Products</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {!categories.data || categories.data.categories.length === 0 ? (
                  <EmptyState colSpan={4} message="No categories yet." />
                ) : (
                  categories.data.categories.map((category) => (
                    <tr key={category.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-semibold text-slate-800`}>{category.name}</td>
                      <td className={tdCls}>{category.description ?? '—'}</td>
                      <td className={`${tdCls} text-right`}>{category.product_count ?? 0}</td>
                      <td className={tdCls}>
                        {can('products.manage') ? (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => setCategoryModal(category)}
                            >
                              <Pencil className="size-4" />
                            </button>
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => removeCategory(category)}
                            >
                              <Trash2 className="size-4 text-red-500" />
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === 'tax' ? (
        taxRates.loading && !taxRates.data ? (
          <Spinner />
        ) : taxRates.error ? (
          <ErrorBox message={taxRates.error} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Name</th>
                  <th className={`${thCls} text-right`}>Rate</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {!taxRates.data || taxRates.data.taxRates.length === 0 ? (
                  <EmptyState colSpan={4} message="No tax rates yet." />
                ) : (
                  taxRates.data.taxRates.map((tax) => (
                    <tr key={tax.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-semibold text-slate-800`}>{tax.name}</td>
                      <td className={`${tdCls} text-right`}>{percent(tax.rate_bp)}</td>
                      <td className={tdCls}>{tax.is_active === 1 ? 'Active' : 'Inactive'}</td>
                      <td className={tdCls}>
                        {can('products.manage') ? (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => setTaxModal(tax)}
                            >
                              <Pencil className="size-4" />
                            </button>
                            <button
                              type="button"
                              className={btnGhost}
                              onClick={() => removeTax(tax)}
                            >
                              <Trash2 className="size-4 text-red-500" />
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {editing ? (
        <Modal
          title={editing === 'new' ? 'New product' : `Edit ${editing.name}`}
          onClose={() => setEditing(null)}
          wide
        >
          <ProductForm
            product={editing === 'new' ? null : editing}
            categories={categories.data?.categories ?? []}
            taxRates={taxRates.data?.taxRates ?? []}
            onSaved={products.reload}
            onClose={() => setEditing(null)}
          />
        </Modal>
      ) : null}

      {categoryModal ? (
        <Modal
          title={categoryModal === 'new' ? 'New category' : 'Edit category'}
          onClose={() => setCategoryModal(null)}
        >
          <SimpleNameModal
            title="Category"
            initialName={categoryModal === 'new' ? '' : categoryModal.name}
            initialExtra={categoryModal === 'new' ? '' : (categoryModal.description ?? '')}
            extraLabel="Description"
            onSubmit={async (payload) => {
              if (categoryModal === 'new') await api.post('/product-categories', payload);
              else await api.put(`/product-categories/${categoryModal.id}`, payload);
              categories.reload();
              products.reload();
            }}
            onClose={() => setCategoryModal(null)}
          />
        </Modal>
      ) : null}

      {taxModal ? (
        <Modal
          title={taxModal === 'new' ? 'New VAT rate' : 'Edit VAT rate'}
          onClose={() => setTaxModal(null)}
        >
          <SimpleNameModal
            title="VAT rate"
            initialName={taxModal === 'new' ? '' : taxModal.name}
            initialExtra={taxModal === 'new' ? '15' : String(taxModal.rate_bp / 100)}
            extraLabel="Rate (%)"
            onSubmit={async (payload) => {
              const rateBp = Math.round(Number(payload.description || 0) * 100);
              const body = { name: payload.name, rateBp, isActive: true };
              if (taxModal === 'new') await api.post('/tax-rates', body);
              else await api.put(`/tax-rates/${taxModal.id}`, body);
              taxRates.reload();
            }}
            onClose={() => setTaxModal(null)}
          />
        </Modal>
      ) : null}
    </>
  );
}
