import { purchasesRepository } from '../repositories/purchasesRepository';
import { completePurchaseSchema, type CompletePurchaseInput } from '../schemas/purchase.schema';
import type { CompletePurchaseResult } from '../types/completePurchase.types';
import { completePurchaseError, mapCompletePurchaseError } from './completePurchaseErrors';
import { coherentPurchaseResult } from './completePurchaseResult';
import { voidPurchaseIdSchema, voidPurchaseSchema } from '../schemas/voidPurchase.schema';
import type { VoidPurchaseInput, VoidPurchaseResult } from '../types/voidPurchase.types';
import { mapVoidPurchaseError, voidPurchaseError } from './voidPurchaseErrors';
import { coherentVoidPurchaseResult } from './voidPurchaseResult';

export const purchasesService = {
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
