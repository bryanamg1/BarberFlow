import type { ExpenseRow } from '@/features/expenses/types/expense.types';
import type { StockMovementRow } from '@/features/inventory/types/inventory.types';

import type { PurchaseItemRow, PurchaseRow } from './purchase.types';

export type { VoidPurchaseInput } from '../schemas/voidPurchase.schema';

export type PurchaseVoidRow = {
  id: string;
  business_id: string;
  purchase_id: string;
  operation_id: string;
  reason: string;
  created_by: string;
  created_at: string;
};
export type VoidPurchaseData = {
  purchase: PurchaseRow & { status: 'VOIDED' };
  items: PurchaseItemRow[];
  expense: ExpenseRow;
  correction: PurchaseVoidRow;
  stockMovements: StockMovementRow[];
};
export type VoidPurchaseErrorCode =
  | 'ACCESS_DENIED'
  | 'INVALID_INPUT'
  | 'INVALID_STATUS'
  | 'CONFLICT'
  | 'INSUFFICIENT_STOCK'
  | 'INCOMPLETE_HISTORY'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';
export type VoidPurchaseError = { code: VoidPurchaseErrorCode; message: string };
export type VoidPurchaseResult =
  { data: VoidPurchaseData; error: null } | { data: null; error: VoidPurchaseError };
