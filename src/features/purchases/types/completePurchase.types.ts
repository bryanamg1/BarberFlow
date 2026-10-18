import type { ExpenseRow } from '@/features/expenses/types/expense.types';

import type { CompletePurchaseInput } from '../schemas/purchase.schema';
import type { PurchaseItemRow, PurchaseRow } from './purchase.types';

export type CompletePurchaseData = {
  purchase: PurchaseRow;
  items: PurchaseItemRow[];
  expense: ExpenseRow;
};
export type CompletePurchaseErrorCode =
  | 'INVALID_INPUT'
  | 'ACCESS_DENIED'
  | 'INVALID_STATUS'
  | 'CONFLICT'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';
export type CompletePurchaseError = { code: CompletePurchaseErrorCode; message: string };
export type CompletePurchaseResult =
  { data: CompletePurchaseData; error: null } | { data: null; error: CompletePurchaseError };
export type UseCompletePurchaseResult = {
  mutateAsync: (input: CompletePurchaseInput) => Promise<CompletePurchaseData>;
  retry: () => Promise<CompletePurchaseData>;
  reset: () => void;
} & (
  | { status: 'idle' | 'pending'; data: null; error: null }
  | { status: 'success'; data: CompletePurchaseData; error: null }
  | { status: 'error'; data: null; error: CompletePurchaseError }
);
