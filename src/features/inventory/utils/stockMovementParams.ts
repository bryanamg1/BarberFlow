import { z } from 'zod';

import type { StockMovementListParams } from '../types/inventory.types';
import type {
  StockMovementHistoryError,
  StockMovementHistoryErrorCode,
  StockMovementHistoryParams,
} from '../types/stockMovementHistory.types';

const instant = z.iso
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)));
const paramsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  type: z.enum(['PURCHASE', 'SALE', 'LOSS', 'ADJUSTMENT', 'RETURN']).optional(),
  from: instant.optional(),
  to: instant.optional(),
});

export function normalizeStockMovementParams(
  params: StockMovementHistoryParams = {},
): StockMovementListParams | null {
  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success) return null;
  const from = (parsed.data.page - 1) * parsed.data.pageSize;
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(from + parsed.data.pageSize))
    return null;
  // Independent half-open filters pass through unchanged; no civil-date conversion or horizon.
  return parsed.data;
}

export function usableInventoryId(value: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function stockMovementError(code: StockMovementHistoryErrorCode): StockMovementHistoryError {
  const messages = {
    INVENTORY_ACCESS_DENIED: 'No se pudo acceder al historial de stock.',
    NETWORK_ERROR: 'No se pudo conectar. Inténtalo nuevamente.',
    UNKNOWN_ERROR: 'No se pudo cargar el historial de stock. Inténtalo nuevamente.',
  };
  return { code, message: messages[code] };
}
