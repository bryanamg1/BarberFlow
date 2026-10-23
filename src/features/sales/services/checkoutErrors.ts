import type { CheckoutError, CheckoutErrorCode } from '../types/checkout.types';

const messages: Record<CheckoutErrorCode, string> = {
  UNAUTHORIZED: 'Inicia sesión para continuar.',
  ACCESS_DENIED: 'No tienes acceso para completar esta venta.',
  INVALID_INPUT: 'Revisa los datos de la venta.',
  INVALID_APPOINTMENT_STATUS: 'El estado de la cita no permite completar esta venta.',
  INSUFFICIENT_STOCK: 'No hay stock suficiente para completar la venta.',
  CONFLICT: 'No se pudo completar la venta por un conflicto de datos.',
  RETRYABLE_ERROR: 'No se pudo confirmar la venta. Reintenta la misma intención.',
  NETWORK_ERROR: 'No se pudo confirmar la venta. Reintenta la misma intención.',
  UNKNOWN_ERROR: 'No se pudo confirmar la venta. Reintenta la misma intención.',
};
export const checkoutError = (code: CheckoutErrorCode): CheckoutError => ({
  code,
  message: messages[code],
});
export function safeCheckoutError(value: unknown): CheckoutError {
  const code = typeof value === 'object' && value !== null && 'code' in value ? value.code : null;
  return checkoutError(
    typeof code === 'string' && Object.prototype.hasOwnProperty.call(messages, code)
      ? (code as CheckoutErrorCode)
      : 'UNKNOWN_ERROR',
  );
}
export const uncertainCheckoutError = (error: CheckoutError) =>
  ['NETWORK_ERROR', 'UNKNOWN_ERROR', 'RETRYABLE_ERROR'].includes(error.code);
export function mapCheckoutError(result: {
  status: number;
  error: { code: string; details?: string };
}): CheckoutError {
  if (result.status === 0) return checkoutError('NETWORK_ERROR');
  if (result.status === 401) return checkoutError('UNAUTHORIZED');
  if (result.status === 403 || result.error.code === '42501') return checkoutError('ACCESS_DENIED');
  if (['22023', '22P02'].includes(result.error.code)) return checkoutError('INVALID_INPUT');
  if (result.error.code === 'PT409' && result.error.details === 'INVALID_APPOINTMENT_STATUS')
    return checkoutError('INVALID_APPOINTMENT_STATUS');
  if (result.error.code === 'PT409' && result.error.details === 'INSUFFICIENT_STOCK')
    return checkoutError('INSUFFICIENT_STOCK');
  if (['40001', '40P01'].includes(result.error.code)) return checkoutError('RETRYABLE_ERROR');
  if (result.status === 409 || result.error.code === '23505') return checkoutError('CONFLICT');
  return checkoutError('UNKNOWN_ERROR');
}
