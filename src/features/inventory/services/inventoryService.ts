import { inventoryRepository } from '../repositories/inventoryRepository';
import {
  adjustStockSchema,
  inventoryUuidSchema,
  type AdjustStockInput,
} from '../schemas/stockAdjustment.schema';
import type { ProductStockRow, InventoryPageParams } from '../types/inventory.types';
import type { LowStockResult } from '../types/lowStockAlerts.types';
import { lowStockError, normalizeLowStockParams } from '../utils/lowStockParams';
import type { AdjustStockError, AdjustStockResult } from '../types/stockAdjustment.types';
import { adjustmentError, mapAdjustmentError } from './stockAdjustmentErrors';
import type {
  StockMovementHistoryParams,
  StockMovementHistoryResult,
} from '../types/stockMovementHistory.types';
import {
  normalizeStockMovementParams,
  stockMovementError,
  usableInventoryId,
} from '../utils/stockMovementParams';

// BF-224 owns adjustment and stock reads; BF-222 history remains independent.
export const inventoryService = {
  async getLowStockProducts(
    businessId: string,
    params?: Partial<InventoryPageParams>,
  ): Promise<LowStockResult> {
    const normalized = normalizeLowStockParams(params);
    if (!inventoryUuidSchema.safeParse(businessId).success || normalized === null)
      return { data: null, error: lowStockError('INVALID_INPUT') };
    try {
      const result = await inventoryRepository.getLowStockProducts(businessId, normalized);
      if (result.error) {
        const code =
          result.status === 0
            ? 'NETWORK_ERROR'
            : result.status === 401 || result.status === 403 || result.error.code === '42501'
              ? 'INVENTORY_ACCESS_DENIED'
              : ['22023', '22P02', '22003'].includes(result.error.code)
                ? 'INVALID_INPUT'
                : 'UNKNOWN_ERROR';
        return { data: null, error: lowStockError(code) };
      }
      if (result.data == null) return { data: null, error: lowStockError('UNKNOWN_ERROR') };
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
      return { data: null, error: lowStockError('UNKNOWN_ERROR') };
    }
  },
  async adjustStock(businessId: string, input: AdjustStockInput): Promise<AdjustStockResult> {
    const parsed = adjustStockSchema.safeParse(input);
    if (!inventoryUuidSchema.safeParse(businessId).success || !parsed.success)
      return { data: null, error: adjustmentError('INVALID_INPUT') };
    try {
      const result = await inventoryRepository.adjustStock(businessId, parsed.data);
      if (result.error !== null)
        return {
          data: null,
          error: mapAdjustmentError({ status: result.status, error: result.error }),
        };
      if (result.data == null) return { data: null, error: adjustmentError('UNKNOWN_ERROR') };
      // The server may return an original movement for a different replay payload.
      return { data: result.data, error: null };
    } catch {
      return { data: null, error: adjustmentError('UNKNOWN_ERROR') };
    }
  },

  async getProductStock(
    businessId: string,
    productIds: string[],
  ): Promise<{ data: ProductStockRow[]; error: null } | { data: null; error: AdjustStockError }> {
    if (
      !inventoryUuidSchema.safeParse(businessId).success ||
      !inventoryUuidSchema.array().safeParse(productIds).success
    )
      return { data: null, error: adjustmentError('INVALID_INPUT') };
    try {
      const result = await inventoryRepository.getProductStock(businessId, productIds);
      if (result.error !== null)
        return {
          data: null,
          error: mapAdjustmentError({ status: result.status, error: result.error }),
        };
      if (result.data == null) return { data: null, error: adjustmentError('UNKNOWN_ERROR') };
      return { data: result.data, error: null };
    } catch {
      return { data: null, error: adjustmentError('UNKNOWN_ERROR') };
    }
  },
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
