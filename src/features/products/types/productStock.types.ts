import type { ProductStockRow } from '@/features/inventory/types/inventory.types';
import type { ProductError } from './productHooks.types';

export type ProductStockLevel = 'OUT' | 'LOW' | 'NORMAL';
export type ProductStockResult = (
  | { status: 'idle' | 'pending'; data: null; error: null }
  | { status: 'success'; data: ProductStockRow[]; error: null }
  | { status: 'error'; data: null; error: ProductError }
) & { isFetching: boolean; refetch: () => Promise<void> };

export type ProductStockValue =
  | { status: 'pending' }
  | { status: 'unavailable' }
  | { status: 'error'; error: ProductError }
  | { status: 'success'; value: string };
