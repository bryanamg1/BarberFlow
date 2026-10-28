import { appointmentCivilDateSchema } from '../../appointments/schemas/appointmentDate.schema';
import { agendaDateLabel } from '../../appointments/utils/agendaCalendar';
import type { FinanceRevenuePoint } from '../types/finance.types';

const decimal = /^\d+\.\d{2}$/;
const cents = (value: string) => BigInt(value.replace('.', ''));
const precision = 1_000_000_000n;

// Number sees only bounded ratios, never absolute monetary values. Even a
// decimal larger than Number.MAX_VALUE cannot overflow the chart coordinates.
const ratio = (part: bigint, maximum: bigint) =>
  maximum === 0n ? 0 : Number((part * precision) / maximum) / Number(precision);

export function financeRevenueGeometry(points: readonly FinanceRevenuePoint[]) {
  if (!Array.isArray(points)) return null;
  let maximum = 0n;
  let maxTotal = '0.00';
  let previous = '';
  const parsed: { point: FinanceRevenuePoint; service: bigint; product: bigint }[] = [];
  for (const point of points) {
    if (
      !point ||
      !appointmentCivilDateSchema.safeParse(point.date).success ||
      point.date <= previous ||
      ![point.service_revenue, point.product_revenue, point.total_revenue].every(
        (value) => typeof value === 'string' && decimal.test(value),
      )
    )
      return null;
    const service = cents(point.service_revenue);
    const product = cents(point.product_revenue);
    const total = cents(point.total_revenue);
    // Integrity check only: never replace BF241's total with a client sum.
    if (service + product !== total) return null;
    if (total > maximum) {
      maximum = total;
      maxTotal = point.total_revenue;
    }
    parsed.push({ point, service, product });
    previous = point.date;
  }
  return {
    maxTotal,
    points: parsed.map(({ point, service, product }) => ({
      point,
      dateLabel: agendaDateLabel(point.date),
      compactDateLabel: `${point.date.slice(8)}/${point.date.slice(5, 7)}`,
      serviceRatio: ratio(service, maximum),
      productRatio: ratio(product, maximum),
    })),
  };
}
