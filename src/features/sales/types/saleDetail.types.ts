import type { SaleItemRow, SalePaymentRow, SaleRow } from './checkout.types';

export type SaleDetail = SaleRow & { sale_items: SaleItemRow[]; payments: SalePaymentRow[] };
export type SaleReadError = {
  code: 'INVALID_INPUT' | 'ACCESS_DENIED' | 'NOT_FOUND' | 'NETWORK_ERROR' | 'UNKNOWN_ERROR';
  message: string;
};
export type SaleReadResult =
  { data: SaleDetail; error: null } | { data: null; error: SaleReadError };
