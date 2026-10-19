import { purchasesRepository } from '../repositories/purchasesRepository';
import { completePurchaseSchema, type CompletePurchaseInput } from '../schemas/purchase.schema';
import type { CompletePurchaseResult } from '../types/completePurchase.types';
import { completePurchaseError, mapCompletePurchaseError } from './completePurchaseErrors';
import { coherentPurchaseResult } from './completePurchaseResult';
import { voidPurchaseIdSchema, voidPurchaseSchema } from '../schemas/voidPurchase.schema';
import type { VoidPurchaseInput, VoidPurchaseResult } from '../types/voidPurchase.types';
import { mapVoidPurchaseError, voidPurchaseError } from './voidPurchaseErrors';
import { coherentVoidPurchaseResult } from './voidPurchaseResult';

import { z } from 'zod';
import { purchaseDetailSchema, purchaseHistorySchema } from '../schemas/purchaseRead.schema';
import { normalizePurchaseList, purchaseReadError, runPurchaseRead } from './purchaseRead';
import type {
  PurchaseListParams,
  PurchaseListData,
  PurchaseReadResult,
  PurchaseDetailData,
} from '../types/purchaseRead.types';

export const purchasesService = {
  async listByBusiness(
    businessId: string,
    params?: PurchaseListParams,
  ): Promise<PurchaseReadResult<PurchaseListData>> {
    const normalized = normalizePurchaseList(params);
    if (!voidPurchaseIdSchema.safeParse(businessId).success || normalized === null)
      return { data: null, error: purchaseReadError('INVALID_INPUT') };
    return runPurchaseRead(
      () => purchasesRepository.listByBusiness(businessId, normalized),
      (value) => {
        const parsed = z.array(purchaseHistorySchema).safeParse(value);
        return parsed.success
          ? {
              items: parsed.data.slice(0, normalized.pageSize),
              ...normalized,
              hasNextPage: parsed.data.length > normalized.pageSize,
            }
          : null;
      },
    );
  },
  async getById(
    businessId: string,
    purchaseId: string,
  ): Promise<PurchaseReadResult<PurchaseDetailData>> {
    if (
      !voidPurchaseIdSchema.safeParse(businessId).success ||
      !voidPurchaseIdSchema.safeParse(purchaseId).success
    )
      return { data: null, error: purchaseReadError('INVALID_INPUT') };
    return runPurchaseRead(
      () => purchasesRepository.getById(businessId, purchaseId),
      (value) => {
        const parsed = purchaseDetailSchema.safeParse(value);
        return parsed.success && parsed.data.purchase.id.toLowerCase() === purchaseId.toLowerCase()
          ? parsed.data
          : null;
      },
      true,
    );
  },
  async voidPurchase(businessId: string, input: VoidPurchaseInput): Promise<VoidPurchaseResult> {
    const parsed = voidPurchaseSchema.safeParse(input);
    if (!voidPurchaseIdSchema.safeParse(businessId).success || !parsed.success)
      return { data: null, error: voidPurchaseError('INVALID_INPUT') };
    try {
      const result = await purchasesRepository.voidPurchase(businessId, parsed.data);
      if (result.error !== null) return { data: null, error: mapVoidPurchaseError(result) };
      if (!coherentVoidPurchaseResult(result.data, businessId, parsed.data))
        return { data: null, error: voidPurchaseError('UNKNOWN_ERROR') };
      return { data: result.data, error: null };
    } catch {
      return { data: null, error: voidPurchaseError('UNKNOWN_ERROR') };
    }
  },
  async completePurchase(
    businessId: string,
    input: CompletePurchaseInput,
  ): Promise<CompletePurchaseResult> {
    const parsed = completePurchaseSchema.safeParse(input);
    if (typeof businessId !== 'string' || businessId.trim().length === 0 || !parsed.success)
      return { data: null, error: completePurchaseError('INVALID_INPUT') };
    try {
      const result = await purchasesRepository.completePurchase(businessId, parsed.data);
      if (result.error !== null) return { data: null, error: mapCompletePurchaseError(result) };
      if (!coherentPurchaseResult(result.data, businessId, parsed.data.operationId))
        return { data: null, error: completePurchaseError('UNKNOWN_ERROR') };
      // Replay may return a different historical payload/creator. Never compare
      // retry lines, prices, category or date, and never reconstruct the result.
      return { data: result.data, error: null };
    } catch {
      return { data: null, error: completePurchaseError('UNKNOWN_ERROR') };
    }
  },
};
