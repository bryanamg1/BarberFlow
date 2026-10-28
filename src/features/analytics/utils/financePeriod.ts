import {
  businessCivilBoundary,
  businessCivilDate,
  shiftCivilDate,
  shiftCivilMonth,
} from '../../appointments/utils/agendaCalendar';

export const FINANCE_PERIODS = ['TODAY', 'WEEK', 'MONTH', 'YEAR', 'ALL_TIME'] as const;
export type FinancePeriod = (typeof FINANCE_PERIODS)[number];
export const DEFAULT_FINANCE_PERIOD: FinancePeriod = 'TODAY';
export type FinancePeriodBounds = { from: string | null; to: string | null };

// The parent supplies an explicit presentation-clock instant and business zone.
// Only civil dates are shifted; elapsed 24-hour intervals never define a day.
export function financePeriodBounds(
  period: FinancePeriod,
  timezone: string,
  referenceInstant: number,
): FinancePeriodBounds {
  if (!Number.isFinite(referenceInstant)) throw new RangeError('Invalid reference instant');
  const today = businessCivilDate(referenceInstant, timezone);
  if (period === 'ALL_TIME') return { from: null, to: null };
  let from: string;
  let to: string;
  switch (period) {
    case 'TODAY':
      from = today;
      to = shiftCivilDate(from, 1);
      break;
    case 'WEEK': {
      const mondayOffset = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
      from = shiftCivilDate(today, -mondayOffset);
      to = shiftCivilDate(from, 7);
      break;
    }
    case 'MONTH':
      from = `${today.slice(0, 7)}-01`;
      to = shiftCivilMonth(from, 1);
      break;
    case 'YEAR':
      from = `${today.slice(0, 4)}-01-01`;
      to = shiftCivilMonth(from, 12);
      break;
    default:
      throw new RangeError('Invalid finance period');
  }
  return { from: businessCivilBoundary(from, timezone), to: businessCivilBoundary(to, timezone) };
}
