import type { CheckoutCapture } from '../store/checkoutDraftStore';

export type CompleteCheckoutInput = CheckoutCapture['input'];
export type SaleRow = {
  id: string;
  business_id: string;
  client_id: string | null;
  appointment_id: string | null;
  operation_id: string;
  status: 'DRAFT' | 'COMPLETED' | 'VOIDED';
  subtotal: number;
  discount: number;
  total: number;
  sold_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};
export type SaleItemRow = {
  id: string;
  sale_id: string;
  item_type: 'SERVICE' | 'PRODUCT';
  service_id: string | null;
  product_id: string | null;
  item_name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  line_total: number;
  unit_cost_snapshot: number | null;
  created_at: string;
};
export type SalePaymentRow = {
  id: string;
  business_id: string;
  sale_id: string;
  payment_method: string;
  amount: number;
  notes: string | null;
  paid_at: string;
  created_by: string;
  created_at: string;
};
export type CompleteCheckoutData = {
  sale: SaleRow;
  items: SaleItemRow[];
  payments: SalePaymentRow[];
};
export type CheckoutErrorCode =
  | 'UNAUTHORIZED'
  | 'ACCESS_DENIED'
  | 'INVALID_INPUT'
  | 'INVALID_APPOINTMENT_STATUS'
  | 'INSUFFICIENT_STOCK'
  | 'CONFLICT'
  | 'RETRYABLE_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';
export type CheckoutError = { code: CheckoutErrorCode; message: string };
export type CompleteCheckoutResult =
  { data: CompleteCheckoutData; error: null } | { data: null; error: CheckoutError };
