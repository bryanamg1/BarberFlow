import type { StockMovementRow } from '@/features/inventory/types/inventory.types';
import type { SaleItemRow, SalePaymentRow, SaleRow } from './checkout.types';
import type { SaleReadError } from './saleDetail.types';
import type { CheckoutScope } from '../store/checkoutDraftStore';

export type SaleScope = CheckoutScope & { role: 'OWNER' | 'BARBER' };
export type SaleHistoryParams = { page?: number; pageSize?: number; status?: SaleRow['status'] };
export type SaleHistoryQuery = {
  businessId: string;
  page: number;
  pageSize: number;
  status?: SaleRow['status'];
};
export type SaleHistoryPage = {
  items: SaleRow[];
  page: number;
  pageSize: number;
  hasNextPage: boolean;
};
export type SaleHistoryResult =
  { data: SaleHistoryPage; error: null } | { data: null; error: SaleReadError };
export type SaleVoidRow = {
  id: string;
  business_id: string;
  sale_id: string;
  operation_id: string;
  reason: string;
  created_by: string;
  created_at: string;
};
export type SaleCorrectionData = {
  correction: SaleVoidRow | null;
  stockMovements: StockMovementRow[];
};
export type VoidSaleInput = { saleId: string; operationId: string; reason: string };
export type VoidSaleData = {
  sale: SaleRow;
  items: SaleItemRow[];
  payments: SalePaymentRow[];
  correction: SaleVoidRow;
  stockMovements: StockMovementRow[];
};
export type SaleCorrectionError = {
  code:
    | 'ACCESS_DENIED'
    | 'NOT_FOUND'
    | 'INVALID_STATUS'
    | 'INVALID_INPUT'
    | 'CONFLICT'
    | 'INCOMPLETE_HISTORY'
    | 'NETWORK_ERROR'
    | 'UNKNOWN_ERROR';
  message: string;
};
export type CorrectionResult<T> =
  { data: T; error: null } | { data: null; error: SaleCorrectionError };
