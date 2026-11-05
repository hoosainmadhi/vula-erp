/** Money is always integer cents. Prices on documents are VAT-exclusive. */

export function cents(value: number | string): number {
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) throw new Error('Invalid money value');
  return Math.round(num);
}

/** VAT portion for a VAT-exclusive subtotal, given a rate in basis points (1500 = 15%). */
export function taxCents(subtotalCents: number, rateBp: number): number {
  if (!Number.isInteger(rateBp) || rateBp < 0) throw new Error('Invalid tax rate');
  return Math.round((subtotalCents * rateBp) / 10_000);
}

export function lineTotals(
  quantity: number,
  unitPriceCents: number,
  rateBp: number,
): { subtotalCents: number; taxCents: number; totalCents: number } {
  const subtotalCents = Math.round(quantity * unitPriceCents);
  const tax = taxCents(subtotalCents, rateBp);
  return { subtotalCents, taxCents: tax, totalCents: subtotalCents + tax };
}

/** Add signed line totals together (handles discounts/credits). */
export function sumCents(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function formatMoney(centsValue: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
  }).format(centsValue / 100);
}
