import type { AdjustStockError, AdjustStockErrorCode } from '../types/stockAdjustment.types';

const messages: Record<AdjustStockErrorCode, string> = {
  INVALID_INPUT: 'Revisa los datos del ajuste.',
  INVENTORY_ACCESS_DENIED: 'No tienes acceso para realizar este ajuste.',
  NOT_FOUND: 'El producto no está disponible.',
  INSUFFICIENT_STOCK: 'Stock insuficiente para aplicar el ajuste.',
  NETWORK_ERROR: 'No se pudo conectar. Inténtalo nuevamente.',
  UNKNOWN_ERROR: 'No se pudo completar el ajuste. Inténtalo nuevamente.',
};
export const adjustmentError = (code: AdjustStockErrorCode): AdjustStockError => ({
  code,
  message: messages[code],
});

export function mapAdjustmentError(result: {
  status: number;
  error: { code: string; details?: string };
}): AdjustStockError {
  if (result.status === 0) return adjustmentError('NETWORK_ERROR');
  if ([401, 403].includes(result.status) || result.error.code === '42501')
    return adjustmentError('INVENTORY_ACCESS_DENIED');
  if (['22023', '22P02', '22003'].includes(result.error.code))
    return adjustmentError('INVALID_INPUT');
  if (result.error.code === 'P0002') return adjustmentError('NOT_FOUND');
  if (result.error.code === 'PT409' && result.error.details === 'INSUFFICIENT_STOCK')
    return adjustmentError('INSUFFICIENT_STOCK');
  return adjustmentError('UNKNOWN_ERROR');
}
