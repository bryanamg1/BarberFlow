import { z } from 'zod';

import { salesRepository } from '../repositories/salesRepository';
import { usableCheckoutId } from '../store/checkoutDraftStore';
import type { SaleReadError, SaleReadResult } from '../types/saleDetail.types';
import { saleRowSchema, saleItemSchema, salePaymentSchema, sameSaleId } from './checkoutResult';

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
