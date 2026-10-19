import type {
  PurchaseListParams,
  PurchaseReadError,
  PurchaseReadResult,
} from '../types/purchaseRead.types';

const messages: Record<PurchaseReadError['code'], string> = {
  INVALID_INPUT: 'Los datos de la consulta no son válidos.',
  ACCESS_DENIED: 'No tienes acceso a las compras de este negocio.',
  NOT_FOUND: 'Compra no disponible.',
  NETWORK_ERROR: 'No se pudo conectar. Inténtalo nuevamente.',
  UNKNOWN_ERROR: 'No se pudo cargar la información de compras.',
};
export const purchaseReadError = (code: PurchaseReadError['code']): PurchaseReadError => ({
  code,
  message: messages[code],
});
export function normalizePurchaseList(params: PurchaseListParams = {}) {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) return null;
  const page = params.page === undefined ? 1 : params.page;
  const pageSize = params.pageSize === undefined ? 25 : params.pageSize;
  return Number.isSafeInteger(page) &&
    page >= 1 &&
    Number.isInteger(pageSize) &&
    pageSize >= 1 &&
    pageSize <= 100 &&
    Number.isSafeInteger(page * pageSize)
    ? { page, pageSize }
    : null;
}
export async function runPurchaseRead<T>(
  operation: () => PromiseLike<{ data: unknown; error: { code?: string } | null; status: number }>,
  parse: (data: unknown) => T | null,
  missing = false,
): Promise<PurchaseReadResult<T>> {
  try {
    const result = await operation();
    if (result.error) {
      const code =
        result.status === 0
          ? 'NETWORK_ERROR'
          : result.status === 401 || result.status === 403 || result.error.code === '42501'
            ? 'ACCESS_DENIED'
            : 'UNKNOWN_ERROR';
      return { data: null, error: purchaseReadError(code) };
    }
    const data = parse(result.data);
    return data === null
      ? {
          data: null,
          error: purchaseReadError(missing && result.data === null ? 'NOT_FOUND' : 'UNKNOWN_ERROR'),
        }
      : { data, error: null };
  } catch {
    return { data: null, error: purchaseReadError('UNKNOWN_ERROR') };
  }
}
