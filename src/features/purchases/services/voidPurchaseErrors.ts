import type { VoidPurchaseError, VoidPurchaseErrorCode } from '../types/voidPurchase.types';

const messages: Record<VoidPurchaseErrorCode, string> = {
  ACCESS_DENIED: 'No tienes permisos para anular esta compra.',
  INVALID_INPUT: 'Revisa los datos de la anulación.',
  INVALID_STATUS: 'La compra no se encuentra en un estado válido para ser anulada.',
  CONFLICT: 'La anulación entró en conflicto con otra operación. Reintenta la misma operación.',
  INSUFFICIENT_STOCK: 'No hay stock suficiente para revertir completamente esta compra.',
  INCOMPLETE_HISTORY: 'El historial de la compra no permite confirmar la anulación.',
  NETWORK_ERROR: 'No se pudo confirmar la anulación. Puedes reintentar con la misma operación.',
  UNKNOWN_ERROR: 'No se pudo confirmar la anulación. Conserva la misma operación para reintentar.',
};
export const voidPurchaseError = (code: VoidPurchaseErrorCode): VoidPurchaseError => ({
  code,
  message: messages[code],
});

export function mapVoidPurchaseError(result: {
  status: number;
  error: { code: string; details?: string };
}): VoidPurchaseError {
  if (result.status === 0) return voidPurchaseError('NETWORK_ERROR');
  if ([401, 403].includes(result.status) || result.error.code === '42501')
    return voidPurchaseError('ACCESS_DENIED');
  if (['22023', '22P02'].includes(result.error.code)) return voidPurchaseError('INVALID_INPUT');
  if (['40001', '40P01', '23505'].includes(result.error.code)) return voidPurchaseError('CONFLICT');
  if (result.error.code === 'PT409') {
    switch (result.error.details) {
      case 'INVALID_STATUS':
      case 'CONFLICT':
      case 'INSUFFICIENT_STOCK':
      case 'INCOMPLETE_HISTORY':
        return voidPurchaseError(result.error.details);
    }
  }
  return voidPurchaseError('UNKNOWN_ERROR');
}
