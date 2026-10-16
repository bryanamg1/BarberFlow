import { z } from 'zod';
import type { LowStockError, LowStockErrorCode } from '../types/lowStockAlerts.types';

const paramsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});
export function normalizeLowStockParams(params: Partial<{ page: number; pageSize: number }> = {}) {
  const result = paramsSchema.safeParse(params);
  if (
    !result.success ||
    !Number.isSafeInteger((result.data.page - 1) * result.data.pageSize + result.data.pageSize)
  )
    return null;
  return result.data;
}
export function lowStockError(code: LowStockErrorCode): LowStockError {
  const messages = {
    INVALID_INPUT: 'Revisa los parámetros de las alertas.',
    INVENTORY_ACCESS_DENIED: 'No tienes acceso a las alertas de este negocio.',
    NETWORK_ERROR: 'No se pudo conectar. Inténtalo nuevamente.',
    UNKNOWN_ERROR: 'No se pudieron cargar las alertas. Inténtalo nuevamente.',
  };
  return { code, message: messages[code] };
}
