import type { StockMovementRow } from './inventory.types';

export type AdjustStockErrorCode =
  | 'INVALID_INPUT'
  | 'INVENTORY_ACCESS_DENIED'
  | 'NOT_FOUND'
  | 'INSUFFICIENT_STOCK'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';
export type AdjustStockError = { code: AdjustStockErrorCode; message: string };
export type AdjustStockResult =
  { data: StockMovementRow; error: null } | { data: null; error: AdjustStockError };
