import type { ProductError, ProductErrorCode } from '../types/productHooks.types';

const messages: Record<ProductErrorCode, string> = {
  INVALID_INPUT: 'Revisa los datos del producto.',
  PRODUCT_NOT_FOUND: 'No se encontró el producto o no está disponible.',
  PRODUCT_ACCESS_DENIED: 'No se pudo acceder al producto.',
  NETWORK_ERROR: 'No se pudo conectar. Inténtalo nuevamente.',
  UNKNOWN_ERROR: 'No se pudo completar la operación del producto.',
};
export const usableProductId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
export const productError = (code: ProductErrorCode): ProductError => ({
  code,
  message: messages[code],
});
export function safeProductError(value: unknown): ProductError {
  const code = typeof value === 'object' && value !== null && 'code' in value ? value.code : null;
  return productError(
    typeof code === 'string' && Object.hasOwn(messages, code)
      ? (code as ProductErrorCode)
      : 'UNKNOWN_ERROR',
  );
}
