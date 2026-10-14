import type { StockMovementListParams, StockMovementRow } from './inventory.types';

export type StockMovementFilters = Pick<StockMovementListParams, 'type' | 'from' | 'to'>;
export type StockMovementHistoryParams = Partial<StockMovementListParams>;
export type StockMovementHistoryErrorCode =
  'INVENTORY_ACCESS_DENIED' | 'NETWORK_ERROR' | 'UNKNOWN_ERROR';
export type StockMovementHistoryError = { code: StockMovementHistoryErrorCode; message: string };
export type StockMovementHistoryPage = {
  items: StockMovementRow[];
  page: number;
  pageSize: number;
  hasNextPage: boolean;
};
export type StockMovementHistoryResult =
  | { data: StockMovementHistoryPage; error: null }
  | { data: null; error: StockMovementHistoryError };
