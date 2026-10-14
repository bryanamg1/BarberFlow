import { skipToken, useQuery } from '@tanstack/react-query';

import { useBusiness } from '@/features/business/context/BusinessContext';

import { inventoryKeys } from '../constants/inventoryKeys';
import { inventoryService } from '../services/inventoryService';
import type {
  StockMovementFilters,
  StockMovementHistoryError,
  StockMovementHistoryPage,
} from '../types/stockMovementHistory.types';
import {
  normalizeStockMovementParams,
  stockMovementError,
  usableInventoryId,
} from '../utils/stockMovementParams';

export type UseStockMovementsResult =
  | { status: 'idle'; data: null; error: null; isFetching: false }
  | { status: 'pending'; data: null; error: null; isFetching: boolean }
  | { status: 'success'; data: StockMovementHistoryPage; error: null; isFetching: boolean }
  | { status: 'error'; data: null; error: StockMovementHistoryError; isFetching: boolean };

export function useStockMovements(
  productId: string | null,
  page = 1,
  pageSize = 25,
  filters: StockMovementFilters = {},
): UseStockMovementsResult {
  const business = useBusiness();
  const candidate = business.status === 'success' ? business.data.business.id : null;
  const businessId = usableInventoryId(candidate) ? candidate : null;
  const id = usableInventoryId(productId) ? productId : null;
  const params = normalizeStockMovementParams({ ...filters, page, pageSize });
  const query = useQuery<StockMovementHistoryPage, StockMovementHistoryError>({
    queryKey: inventoryKeys.stockMovements(businessId, id, params ?? { page: 1, pageSize: 25 }),
    queryFn:
      businessId === null || id === null || params === null
        ? skipToken
        : async () => {
            const result = await inventoryService.listStockMovements(businessId, id, params);
            if (result.error !== null) throw result.error;
            return result.data;
          },
    enabled: businessId !== null && id !== null && params !== null,
    retry: false,
  });
  if (businessId === null || id === null)
    return { status: 'idle', data: null, error: null, isFetching: false };
  if (params === null)
    return {
      status: 'error',
      data: null,
      error: stockMovementError('UNKNOWN_ERROR'),
      isFetching: false,
    };
  if (query.isError)
    return { status: 'error', data: null, error: query.error, isFetching: query.isFetching };
  if (query.isSuccess)
    return { status: 'success', data: query.data, error: null, isFetching: query.isFetching };
  return { status: 'pending', data: null, error: null, isFetching: query.isFetching };
}
