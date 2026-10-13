import { formatMoney } from '../../../utils/formatMoney';

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
  return formatMoney(value, currency);
}
