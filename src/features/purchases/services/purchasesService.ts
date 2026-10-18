import { purchasesRepository } from '../repositories/purchasesRepository';
import { completePurchaseSchema, type CompletePurchaseInput } from '../schemas/purchase.schema';
import type { CompletePurchaseResult } from '../types/completePurchase.types';
import { completePurchaseError, mapCompletePurchaseError } from './completePurchaseErrors';
import { coherentPurchaseResult } from './completePurchaseResult';

export const purchasesService = {
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
