import type {
  CompletePurchaseError,
  CompletePurchaseErrorCode,
} from '../types/completePurchase.types';

const messages: Record<CompletePurchaseErrorCode, string> = {
  INVALID_INPUT: 'Revisa los datos de la compra.',
  ACCESS_DENIED: 'No tienes acceso para completar esta compra.',
  INVALID_STATUS: 'El estado de la compra no permite esta operación.',
  CONFLICT: 'No se pudo completar la operación. Reintenta la misma compra.',
  NETWORK_ERROR: 'No se pudo confirmar la compra. Reintenta la misma operación.',
  UNKNOWN_ERROR: 'No se pudo confirmar la compra. Inténtalo nuevamente.',
};
export const completePurchaseError = (code: CompletePurchaseErrorCode): CompletePurchaseError => ({
  code,
  message: messages[code],
});

export function mapCompletePurchaseError(result: {
  status: number;
  error: { code: string; details?: string };
}): CompletePurchaseError {
  if (result.status === 0) return completePurchaseError('NETWORK_ERROR');
  if ([401, 403].includes(result.status) || result.error.code === '42501')
    return completePurchaseError('ACCESS_DENIED');
  if (['22023', '22P02'].includes(result.error.code)) return completePurchaseError('INVALID_INPUT');
  if (result.error.code === 'PT409' && result.error.details === 'INVALID_STATUS')
    return completePurchaseError('INVALID_STATUS');
  if (['40001', '40P01', '23505'].includes(result.error.code))
    return completePurchaseError('CONFLICT');
  return completePurchaseError('UNKNOWN_ERROR');
}
