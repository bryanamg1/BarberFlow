// Preserve decimal cents, including amounts beyond Number.MAX_SAFE_INTEGER.
export function formatMoney(value: string, currency: string): string {
  const [integer, cents] = value.split('.');
  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
      .formatToParts(BigInt(integer))
      .map((part) => (part.type === 'fraction' ? cents : part.value))
      .join('');
  } catch {
    return 'Importe no disponible';
  }
}

// Catalog prices already satisfy numeric(12,2); pad their canonical decimal text without rounding.
export function formatCatalogPrice(value: number, currency: string): string {
  if (!Number.isFinite(value) || value < 0 || value > 9999999999.99) {
    return 'Importe no disponible';
  }
  const decimal = value.toString();
  if (!/^\d+(?:\.\d{1,2})?$/.test(decimal)) return 'Importe no disponible';
  const [integer, cents = ''] = decimal.split('.');
  return formatMoney(`${integer}.${cents.padEnd(2, '0')}`, currency);
}
