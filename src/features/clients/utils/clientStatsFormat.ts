export function formatClientStatsDate(value: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('es-AR', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
      hourCycle: 'h23',
    }).format(new Date(value));
  } catch {
    return 'Fecha no disponible';
  }
}

export function formatClientStatsMoney(value: string, currency: string): string {
  // Format the integer with BigInt, inserting the original cents into currency parts.
  // The 2dp contract is exact even beyond Number.MAX_SAFE_INTEGER.
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
