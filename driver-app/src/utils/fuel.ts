/** Litres, price per litre and total amount: any two give the third. */
export type AmountField = 'litres' | 'price' | 'total';
export type AmountValues = Record<AmountField, string>;

const round2 = (n: number) => String(Math.round((n + Number.EPSILON) * 100) / 100);
const positive = (s: string) => {
  const n = Number(s);
  return s.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Fills in the field that is not one of the two most recently typed (`edited`, oldest first).
 * With fewer than two edited fields the values are left as typed.
 */
export function deriveAmounts(values: AmountValues, edited: AmountField[]): AmountValues {
  if (edited.length < 2) return values;
  const target = (['litres', 'price', 'total'] as const).find((f) => !edited.includes(f));
  if (!target) return values;
  const litres = positive(values.litres);
  const price = positive(values.price);
  const total = positive(values.total);
  let next: number | null = null;
  if (target === 'total' && litres && price) next = litres * price;
  if (target === 'price' && litres && total) next = total / litres;
  if (target === 'litres' && price && total) next = total / price;
  return { ...values, [target]: next == null ? '' : round2(next) };
}

/** The two figures to send to the server: the most recently typed pair, or null when they are not both valid numbers. */
export function sendableAmounts(
  values: AmountValues,
  edited: AmountField[],
): { litres?: number; price_per_litre?: number; total_amount?: number } | null {
  const pair = edited.slice(-2);
  if (pair.length < 2) return null;
  const out: { litres?: number; price_per_litre?: number; total_amount?: number } = {};
  for (const f of pair) {
    const n = positive(values[f]);
    if (n == null) return null;
    if (f === 'litres') out.litres = n;
    else if (f === 'price') out.price_per_litre = n;
    else out.total_amount = n;
  }
  return out;
}
