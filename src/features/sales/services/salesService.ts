import { z } from 'zod';

import { salesRepository } from '../repositories/salesRepository';
import { usableCheckoutId } from '../store/checkoutDraftStore';
import type { SaleReadError, SaleReadResult } from '../types/saleDetail.types';
import { saleRowSchema, saleItemSchema, salePaymentSchema, sameSaleId } from './checkoutResult';
import {
  coherentCorrection,
  correctionSchema,
  mapSaleCorrectionError,
  saleCorrectionError,
  saleRestitution,
  voidSaleResultSchema,
  voidSaleSchema,
} from './saleCorrection';
import type {
  SaleHistoryParams,
  SaleHistoryQuery,
  SaleHistoryResult,
  CorrectionResult,
  SaleCorrectionData,
  VoidSaleInput,
  VoidSaleData,
} from '../types/saleCorrection.types';

export function normalizeSaleHistory(params: SaleHistoryParams = {}) {
  const page = params.page ?? 1,
    pageSize = params.pageSize ?? 25;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    !Number.isSafeInteger(page * pageSize) ||
    (params.status !== undefined && !['DRAFT', 'COMPLETED', 'VOIDED'].includes(params.status))
  )
    return null;
  return { page, pageSize, status: params.status };
}

const messages: Record<SaleReadError['code'], string> = {
  INVALID_INPUT: 'Los datos de la consulta no son válidos.',
  ACCESS_DENIED: 'No tienes acceso a esta venta.',
  NOT_FOUND: 'Venta no disponible.',
  NETWORK_ERROR: 'No se pudo conectar. Inténtalo nuevamente.',
  UNKNOWN_ERROR: 'No se pudo cargar la venta.',
};
export const saleReadError = (code: SaleReadError['code']): SaleReadError => ({
  code,
  message: messages[code],
});
const detailSchema = saleRowSchema.extend({
  sale_items: z.array(saleItemSchema),
  payments: z.array(salePaymentSchema),
});
export const salesService = {
  async listHistory(input: { businessId: string } & SaleHistoryParams): Promise<SaleHistoryResult> {
    const params = normalizeSaleHistory(input);
    if (!usableCheckoutId(input.businessId) || !params)
      return { data: null, error: saleReadError('INVALID_INPUT') };
    try {
      const result = await salesRepository.listHistory({
        ...params,
        businessId: input.businessId,
      } as SaleHistoryQuery);
      if (result.error)
        return {
          data: null,
          error: saleReadError(
            result.status === 0
              ? 'NETWORK_ERROR'
              : [401, 403].includes(result.status) || result.error.code === '42501'
                ? 'ACCESS_DENIED'
                : 'UNKNOWN_ERROR',
          ),
        };
      const parsed = z
        .strictObject({
          items: z.array(saleRowSchema),
          page: z.literal(params.page),
          pageSize: z.literal(params.pageSize),
          hasNextPage: z.boolean(),
        })
        .safeParse(result.data);
      if (
        !parsed.success ||
        parsed.data.items.length > params.pageSize ||
        new Set(parsed.data.items.map((sale) => sale.id)).size !== parsed.data.items.length ||
        parsed.data.items.some(
          (sale) =>
            !sameSaleId(sale.business_id, input.businessId) ||
            (params.status !== undefined && sale.status !== params.status),
        )
      )
        return { data: null, error: saleReadError('UNKNOWN_ERROR') };
      return { data: parsed.data, error: null };
    } catch {
      return { data: null, error: saleReadError('UNKNOWN_ERROR') };
    }
  },
  async getCorrectionDetail(
    businessId: string,
    saleId: string,
  ): Promise<CorrectionResult<SaleCorrectionData>> {
    if (!usableCheckoutId(businessId) || !usableCheckoutId(saleId))
      return { data: null, error: saleCorrectionError('INVALID_INPUT') };
    try {
      const result = await salesRepository.getCorrectionDetail(businessId, saleId);
      if (result.error) return { data: null, error: mapSaleCorrectionError(result) };
      const parsed = correctionSchema.safeParse(result.data);
      if (!parsed.success || !coherentCorrection(parsed.data, businessId, saleId))
        return { data: null, error: saleCorrectionError('INCOMPLETE_HISTORY') };
      return { data: parsed.data, error: null };
    } catch {
      return { data: null, error: saleCorrectionError('UNKNOWN_ERROR') };
    }
  },
  async voidSale(
    businessId: string,
    input: VoidSaleInput,
  ): Promise<CorrectionResult<VoidSaleData>> {
    const parsedInput = voidSaleSchema.safeParse(input);
    if (!usableCheckoutId(businessId) || !parsedInput.success)
      return { data: null, error: saleCorrectionError('INVALID_INPUT') };
    try {
      const result = await salesRepository.voidSale(businessId, parsedInput.data);
      if (result.error) return { data: null, error: mapSaleCorrectionError(result) };
      const parsed = voidSaleResultSchema.safeParse(result.data);
      if (!parsed.success) return { data: null, error: saleCorrectionError('INCOMPLETE_HISTORY') };
      const d = parsed.data;
      if (
        d.sale.status !== 'VOIDED' ||
        !sameSaleId(d.sale.id, input.saleId) ||
        !sameSaleId(d.sale.business_id, businessId) ||
        !sameSaleId(d.correction.operation_id, input.operationId) ||
        d.correction.reason !== input.reason ||
        !coherentCorrection(d, businessId, input.saleId) ||
        d.items.some((item) => item.sale_id !== d.sale.id) ||
        d.payments.some((p) => p.sale_id !== d.sale.id || p.business_id !== businessId) ||
        new Set(d.items.map((i) => i.id)).size !== d.items.length ||
        new Set(d.payments.map((p) => p.id)).size !== d.payments.length ||
        saleRestitution(d, d.items) === null
      )
        return { data: null, error: saleCorrectionError('INCOMPLETE_HISTORY') };
      return { data: d, error: null };
    } catch {
      return { data: null, error: saleCorrectionError('UNKNOWN_ERROR') };
    }
  },
  async getById(businessId: string, saleId: string): Promise<SaleReadResult> {
    if (!usableCheckoutId(businessId) || !usableCheckoutId(saleId))
      return { data: null, error: saleReadError('INVALID_INPUT') };
    try {
      const result = await salesRepository.getById(businessId, saleId);
      if (result.error) {
        const code =
          result.status === 0
            ? 'NETWORK_ERROR'
            : [401, 403].includes(result.status) || result.error.code === '42501'
              ? 'ACCESS_DENIED'
              : 'UNKNOWN_ERROR';
        return { data: null, error: saleReadError(code) };
      }
      if (result.data === null) return { data: null, error: saleReadError('NOT_FOUND') };
      const parsed = detailSchema.safeParse(result.data);
      if (!parsed.success) return { data: null, error: saleReadError('UNKNOWN_ERROR') };
      const data = parsed.data;
      if (
        !sameSaleId(data.id, saleId) ||
        !sameSaleId(data.business_id, businessId) ||
        data.sale_items.some((line) => line.sale_id !== data.id) ||
        data.payments.some(
          (payment) => payment.sale_id !== data.id || payment.business_id !== data.business_id,
        ) ||
        new Set(data.sale_items.map((line) => line.id)).size !== data.sale_items.length ||
        new Set(data.payments.map((payment) => payment.id)).size !== data.payments.length
      )
        return { data: null, error: saleReadError('UNKNOWN_ERROR') };
      // Visible children may be empty or partial under RLS. Never infer a debt from them.
      return { data, error: null };
    } catch {
      return { data: null, error: saleReadError('UNKNOWN_ERROR') };
    }
  },
};
