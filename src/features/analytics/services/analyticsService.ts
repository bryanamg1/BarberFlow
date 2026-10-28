import { z } from 'zod';
import { appointmentCivilDateSchema } from '@/features/appointments/schemas/appointmentDate.schema';
import { analyticsRepository } from '../repositories/analyticsRepository';
import type { AnalyticsError, AnalyticsRange, AnalyticsResult } from '../types/finance.types';

const id = z.string().refine((value) => value.trim().length > 0);
const money = z.string().regex(/^\d+\.\d{2}$/);
const signedMoney = z.string().regex(/^-?\d+\.\d{2}$/);
const integer = z.string().regex(/^\d+$/);
const name = z.string().refine((value) => value.trim().length > 0);
const summarySchema = z.object({
  total_revenue: money,
  service_revenue: money,
  product_revenue: money,
  expenses: money,
  merchandise_purchases: money,
  profit: signedMoney,
  appointments: integer,
  active_clients: integer,
  average_ticket: money.nullable(),
  products_sold: integer,
  cancellations: integer,
  no_shows: integer,
});
const revenueSchema = z.array(
  z.object({
    date: appointmentCivilDateSchema,
    service_revenue: money,
    product_revenue: money,
    total_revenue: money,
  }),
);
const expensesSchema = z.object({
  manual_total: money,
  purchase_total: money,
  total: money,
  by_category: z.array(z.object({ category_id: z.string().nullable(), amount: money })),
});
const servicesSchema = z.array(
  z.object({ service_id: id, name, quantity: integer, net_revenue: money }),
);
const productsSchema = z.array(
  z.object({
    product_id: id,
    name,
    quantity: integer,
    net_revenue: money,
    cogs: money,
    gross_profit: signedMoney,
  }),
);

function failure(code: AnalyticsError['code']): { data: null; error: AnalyticsError } {
  const messages = {
    ACCESS_DENIED: 'No tienes acceso a esta información financiera.',
    INVALID_INPUT: 'No se pudo consultar el período seleccionado.',
    INVALID_DATA: 'La información financiera no está disponible.',
    NETWORK_ERROR: 'No pudimos conectar. Inténtalo nuevamente.',
    UNKNOWN_ERROR: 'No pudimos cargar la información financiera.',
  };
  return { data: null, error: { code, message: messages[code] } };
}
const instant = z.iso.datetime({ offset: true });
function validRange(range: AnalyticsRange) {
  if (!range) return false;
  if (range.from === null && range.to === null) return true;
  return (
    instant.safeParse(range.from).success &&
    instant.safeParse(range.to).success &&
    Date.parse(range.from!) < Date.parse(range.to!)
  );
}
async function run<T>(
  businessId: string,
  range: AnalyticsRange,
  schema: z.ZodType<T>,
  operation: () => PromiseLike<{ data: unknown; error: { code?: string } | null; status: number }>,
  limit?: number,
): Promise<AnalyticsResult<T>> {
  if (!id.safeParse(businessId).success) return failure('ACCESS_DENIED');
  if (
    !validRange(range) ||
    (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100))
  )
    return failure('INVALID_INPUT');
  try {
    const result = await operation();
    if (result.error) {
      if (result.status === 0) return failure('NETWORK_ERROR');
      if (result.status === 401 || result.status === 403 || result.error.code === '42501')
        return failure('ACCESS_DENIED');
      if (result.error.code === '22023') return failure('INVALID_INPUT');
      return failure('UNKNOWN_ERROR');
    }
    const parsed = schema.safeParse(result.data);
    return parsed.success ? { data: parsed.data, error: null } : failure('INVALID_DATA');
  } catch {
    return failure('UNKNOWN_ERROR');
  }
}
export const analyticsService = {
  getDashboardSummary: (businessId: string, range: AnalyticsRange, signal?: AbortSignal) =>
    run(businessId, range, summarySchema, () =>
      analyticsRepository.getDashboardSummary(businessId, range, signal),
    ),
  getRevenueByDay: (businessId: string, range: AnalyticsRange, signal?: AbortSignal) =>
    run(businessId, range, revenueSchema, () =>
      analyticsRepository.getRevenueByDay(businessId, range, signal),
    ),
  getExpenseSummary: (businessId: string, range: AnalyticsRange, signal?: AbortSignal) =>
    run(businessId, range, expensesSchema, () =>
      analyticsRepository.getExpenseSummary(businessId, range, signal),
    ),
  getTopServices: (businessId: string, range: AnalyticsRange, limit = 10, signal?: AbortSignal) =>
    run(
      businessId,
      range,
      servicesSchema,
      () => analyticsRepository.getTopServices(businessId, range, limit, signal),
      limit,
    ),
  getTopProducts: (businessId: string, range: AnalyticsRange, limit = 10, signal?: AbortSignal) =>
    run(
      businessId,
      range,
      productsSchema,
      () => analyticsRepository.getTopProducts(businessId, range, limit, signal),
      limit,
    ),
};
