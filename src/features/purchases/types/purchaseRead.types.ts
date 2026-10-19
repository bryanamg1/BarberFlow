import type { z } from 'zod';

import type { purchaseDetailSchema, purchaseHistorySchema } from '../schemas/purchaseRead.schema';

export type PurchaseHistoryRow = z.infer<typeof purchaseHistorySchema>;
export type PurchaseDetailData = z.infer<typeof purchaseDetailSchema>;
export type PurchaseListParams = { page?: number; pageSize?: number };
export type PurchaseListData = {
  items: PurchaseHistoryRow[];
  page: number;
  pageSize: number;
  hasNextPage: boolean;
};
export type PurchaseReadError = {
  code: 'INVALID_INPUT' | 'ACCESS_DENIED' | 'NOT_FOUND' | 'NETWORK_ERROR' | 'UNKNOWN_ERROR';
  message: string;
};
export type PurchaseReadResult<T> =
  { data: T; error: null } | { data: null; error: PurchaseReadError };
export type PurchaseScope = { businessId: string; userId: string; membershipId: string };
