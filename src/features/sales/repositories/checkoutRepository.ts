import type { PostgrestSingleResponse } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase/client';

import type { CompleteCheckoutData, CompleteCheckoutInput } from '../types/checkout.types';

export const checkoutRepository = {
  complete(
    businessId: string,
    input: CompleteCheckoutInput,
  ): PromiseLike<PostgrestSingleResponse<CompleteCheckoutData>> {
    return supabase.rpc('complete_checkout', {
      p_business_id: businessId,
      p_operation_id: input.operationId,
      p_appointment_id: input.appointmentId,
      p_client_id: input.clientId,
      p_discount_amount: input.discountAmount,
      p_payment_method: input.paymentMethod,
      p_items: input.items.map(({ itemType, itemId, quantity, unitPriceOverride }) => ({
        itemType,
        itemId,
        quantity,
        ...(unitPriceOverride !== undefined ? { unitPriceOverride } : {}),
      })),
    });
  },
};
