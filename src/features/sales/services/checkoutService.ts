import { checkoutRepository } from '../repositories/checkoutRepository';
import { usableCheckoutId } from '../store/checkoutDraftStore';
import type { CompleteCheckoutInput, CompleteCheckoutResult } from '../types/checkout.types';
import { checkoutError, mapCheckoutError } from './checkoutErrors';
import { checkoutInputSchema, coherentCheckoutResult } from './checkoutResult';

export const checkoutService = {
  async complete(
    businessId: string,
    input: CompleteCheckoutInput,
  ): Promise<CompleteCheckoutResult> {
    const parsed = checkoutInputSchema.safeParse(input);
    if (!usableCheckoutId(businessId) || !parsed.success)
      return { data: null, error: checkoutError('INVALID_INPUT') };
    try {
      const result = await checkoutRepository.complete(businessId, parsed.data);
      if (result.error) return { data: null, error: mapCheckoutError(result) };
      if (!coherentCheckoutResult(result.data, businessId, input.operationId))
        return { data: null, error: checkoutError('UNKNOWN_ERROR') };
      return { data: result.data, error: null };
    } catch {
      // A transport rejection cannot establish whether the transaction committed.
      return { data: null, error: checkoutError('UNKNOWN_ERROR') };
    }
  },
};
