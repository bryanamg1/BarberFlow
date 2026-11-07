// Format canonical decimal text without converting the amount to a numeric type.
export function formatMoney(value: string, currency: string): string {
  const match = typeof value === 'string' ? /^(-?)(\d+)\.(\d{2})$/.exec(value) : null;
  if (!match) return 'Importe no disponible';

  const [, sign, whole, cents] = match;
  let integer = whole.replace(/^0+(?=\d)/, '');
  try {
    const formatter = new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    if (integer.length > 3) {
      // es-AR uses groups of three. Probe the runtime for the separator and
      // whether it groups four-digit numbers, using only safe template values.
      const sample = integer.length === 4 ? 1000 : 10000;
      const separator = formatter
        .formatToParts(sample)
        .find((part) => part.type === 'group')?.value;
      if (separator) {
        const first = integer.length % 3 || 3;
        const groups = integer.slice(first).match(/\d{3}/g) ?? [];
        integer = [integer.slice(0, first), ...groups].join(separator);
      }
    }
    return formatter
      .formatToParts(sign ? -0 : 0)
      .map((part) => {
        if (part.type === 'integer') return integer;
        if (part.type === 'fraction') return cents;
        return part.value;
      })
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
