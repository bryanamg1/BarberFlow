import { validCheckoutPaymentMethod } from '../store/checkoutDraftStore';

// Payment selection contributes eligibility only; no payment or submit is executed here.
export function deriveCheckoutPayment(
  summary: { total: string | null; eligible: boolean },
  method: unknown,
  locked = false,
) {
  const methodValid = validCheckoutPaymentMethod(method);
  return {
    method: methodValid ? method : undefined,
    methodValid,
    zeroTotal: summary.total === '0.00',
    eligible: summary.eligible && methodValid && !locked,
  };
}
