import { validCheckoutMoney, validCheckoutQuantity } from '../store/checkoutDraftStore';

export function catalogMoneyDecimal(price: number): string | null {
  if (!Number.isFinite(price) || price < 0 || !/^\d+(?:\.\d{1,2})?$/.test(price.toString()))
    return null;
  const [integer, fraction = ''] = price.toString().split('.');
  const value = `${integer}.${fraction.padEnd(2, '0')}`;
  return validCheckoutMoney(value) ? value : null;
}
export const checkoutCents = (value: string) => BigInt(value.replace('.', ''));
export const checkoutDecimal = (cents: bigint) =>
  `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
export function checkoutLineTotal(unitPrice: string | null, quantity: number): string | null {
  if (unitPrice === null || !validCheckoutMoney(unitPrice) || !validCheckoutQuantity(quantity))
    return null;
  const value = checkoutCents(unitPrice) * BigInt(quantity);
  return value <= 999_999_999_999n ? checkoutDecimal(value) : null;
}
