import { inventoryRepository } from '../repositories/inventoryRepository';
import type {
  StockMovementHistoryParams,
  StockMovementHistoryResult,
} from '../types/stockMovementHistory.types';
import {
  normalizeStockMovementParams,
  stockMovementError,
  usableInventoryId,
} from '../utils/stockMovementParams';

// BF-222 owns this read adapter only. Stock reads/writers are not added here.
export const inventoryService = {
  async listStockMovements(
    businessId: string,
    productId: string,
    params?: StockMovementHistoryParams,
  ): Promise<StockMovementHistoryResult> {
    if (!usableInventoryId(businessId))
      return { data: null, error: stockMovementError('INVENTORY_ACCESS_DENIED') };
    const normalized = normalizeStockMovementParams(params);
    if (!usableInventoryId(productId) || normalized === null)
      return { data: null, error: stockMovementError('UNKNOWN_ERROR') };
    try {
      const result = await inventoryRepository.listStockMovements(
        businessId,
        productId,
        normalized,
      );
      if (result.error !== null) {
        const code =
          result.status === 0
            ? 'NETWORK_ERROR'
            : result.status === 401 || result.status === 403 || result.error.code === '42501'
              ? 'INVENTORY_ACCESS_DENIED'
              : 'UNKNOWN_ERROR';
        return { data: null, error: stockMovementError(code) };
      }
      if (result.data == null) return { data: null, error: stockMovementError('UNKNOWN_ERROR') };
      return {
        data: {
          items: result.data.slice(0, normalized.pageSize),
          page: normalized.page,
          pageSize: normalized.pageSize,
          hasNextPage: result.data.length > normalized.pageSize,
        },
        error: null,
      };
    } catch {
      return { data: null, error: stockMovementError('UNKNOWN_ERROR') };
    }
  },
};
