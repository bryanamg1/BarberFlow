import { z } from 'zod';
import { usableCheckoutId } from '../store/checkoutDraftStore';
import { saleRowSchema, saleItemSchema, salePaymentSchema, sameSaleId } from './checkoutResult';
import type { SaleCorrectionError, SaleCorrectionData } from '../types/saleCorrection.types';
import type { SaleItemRow } from '../types/checkout.types';

const id = z.uuid();
const instant = z.iso.datetime({ offset: true });
const correction = z.strictObject({
  id,
  business_id: id,
  sale_id: id,
  operation_id: id,
  reason: z.string(),
  created_by: id,
  created_at: instant,
});
const movement = z.strictObject({
  id,
  business_id: id,
  product_id: id,
  type: z.enum(['PURCHASE', 'SALE', 'LOSS', 'ADJUSTMENT', 'RETURN']),
  quantity_delta: z.number().int(),
  unit_cost: z.number().finite().nonnegative().nullable(),
  reference_type: z.string().nullable(),
  reference_id: id.nullable(),
  notes: z.string().nullable(),
  occurred_at: instant,
  created_by: id,
  created_at: instant,
});
export const correctionSchema = z.strictObject({
  correction: correction.nullable(),
  stockMovements: z.array(movement),
});
export const voidSaleSchema = z.object({
  saleId: z.string().refine(usableCheckoutId),
  operationId: z.string().refine(usableCheckoutId),
  reason: z.string().refine((value) => value.trim().length > 0),
});
export const voidSaleResultSchema = z.strictObject({
  sale: saleRowSchema,
  items: z.array(saleItemSchema),
  payments: z.array(salePaymentSchema),
  correction,
  stockMovements: z.array(movement),
});
const messages: Record<SaleCorrectionError['code'], string> = {
  ACCESS_DENIED: 'No tienes acceso a la corrección de esta venta.',
  NOT_FOUND: 'Venta no disponible.',
  INVALID_STATUS: 'La venta no se encuentra en un estado válido para ser anulada.',
  INVALID_INPUT: 'Revisa los datos de la anulación.',
  CONFLICT: 'La anulación entró en conflicto. Puedes reintentar la misma operación.',
  INCOMPLETE_HISTORY: 'El historial de la venta está incompleto.',
  NETWORK_ERROR: 'No se pudo conectar. Puedes reintentar la misma operación.',
  UNKNOWN_ERROR: 'No se pudo confirmar la operación. Puedes reintentar con la misma intención.',
};
export const saleCorrectionError = (code: SaleCorrectionError['code']): SaleCorrectionError => ({
  code,
  message: messages[code],
});
export function mapSaleCorrectionError(result: {
  status: number;
  error: { code: string; details?: string };
}) {
  if (result.status === 0) return saleCorrectionError('NETWORK_ERROR');
  if ([401, 403].includes(result.status) || result.error.code === '42501')
    return saleCorrectionError('ACCESS_DENIED');
  if (['22023', '22P02'].includes(result.error.code)) return saleCorrectionError('INVALID_INPUT');
  if (['40001', '40P01', '23505'].includes(result.error.code))
    return saleCorrectionError('CONFLICT');
  if (result.error.code === 'PT404') return saleCorrectionError('NOT_FOUND');
  if (
    result.error.code === 'PT409' &&
    ['INVALID_STATUS', 'CONFLICT', 'INCOMPLETE_HISTORY'].includes(result.error.details ?? '')
  )
    return saleCorrectionError(result.error.details as SaleCorrectionError['code']);
  return saleCorrectionError('UNKNOWN_ERROR');
}
export function coherentCorrection(data: SaleCorrectionData, businessId: string, saleId: string) {
  const c = data.correction;
  return (
    c !== null &&
    sameSaleId(c.business_id, businessId) &&
    sameSaleId(c.sale_id, saleId) &&
    new Set(data.stockMovements.map((m) => m.id)).size === data.stockMovements.length &&
    data.stockMovements.every(
      (m) =>
        sameSaleId(m.business_id, businessId) &&
        m.type === 'RETURN' &&
        m.quantity_delta > 0 &&
        m.reference_type === 'SALE_VOID' &&
        m.reference_id !== null &&
        sameSaleId(m.reference_id, c.id),
    )
  );
}
// Pair each RETURN with one historical PRODUCT line, including repeated products.
// Historical cost is only used to correlate, never displayed. Indistinguishable
// snapshots with different names fail safely rather than choosing an arbitrary name.
export function saleRestitution(data: SaleCorrectionData, items: SaleItemRow[]) {
  const remaining = items.filter((item) => item.item_type === 'PRODUCT');
  const rows: { name: string; quantity: number; key: string }[] = [];
  for (const m of data.stockMovements) {
    const candidates = remaining.filter(
      (item) =>
        item.product_id === m.product_id &&
        item.quantity === m.quantity_delta &&
        item.unit_cost_snapshot === m.unit_cost,
    );
    if (
      candidates.length === 0 ||
      new Set(candidates.map((item) => item.item_name_snapshot)).size !== 1
    )
      return null;
    const item = candidates[0];
    remaining.splice(remaining.indexOf(item), 1);
    rows.push({ name: item.item_name_snapshot, quantity: m.quantity_delta, key: m.id });
  }
  return remaining.length === 0 ? rows : null;
}
