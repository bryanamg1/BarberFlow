import type { SettingsError } from '@/features/business/services/businessSettingsService';
import type { LowStockProductRow } from './inventory.types';

export type LowStockErrorCode =
  'INVALID_INPUT' | 'INVENTORY_ACCESS_DENIED' | 'NETWORK_ERROR' | 'UNKNOWN_ERROR';
export type LowStockError = { code: LowStockErrorCode; message: string };
export type LowStockPage = {
  items: LowStockProductRow[];
  page: number;
  pageSize: number;
  hasNextPage: boolean;
};
export type LowStockResult =
  { data: LowStockPage; error: null } | { data: null; error: LowStockError };
type Controls = { isFetching: boolean; retry: () => Promise<void> };
export type UseLowStockAlertsResult = Controls &
  (
    | { status: 'idle'; data: null; error: null }
    | { status: 'pending'; data: null; error: null }
    | { status: 'disabled'; data: null; error: null }
    | { status: 'success'; data: LowStockPage; error: null }
    | { status: 'error'; data: null; error: LowStockError | SettingsError }
  );
