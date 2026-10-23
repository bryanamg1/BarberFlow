import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { checkoutDraftStore } from '@/features/sales/store/checkoutDraftStore';
import type { CompleteCheckoutData } from '@/features/sales/types/checkout.types';
import type { ServiceRow } from '@/features/services/repositories/servicesRepository';
import type { ProductRow } from '@/features/products/types/product.types';

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const scope = { userId: id(5), businessId: id(196), membershipId: id(8) };
export const at = '2026-10-23T12:00:00+00:00';
export const state = () => checkoutDraftStore.getState();
export const serviceRow: ServiceRow = {
  id: id(2),
  business_id: scope.businessId,
  name: 'Corte',
  price: 100,
  duration_minutes: 30,
  description: null,
  is_active: true,
  created_at: at,
  updated_at: at,
};
export const productRow: ProductRow = {
  id: id(3),
  business_id: scope.businessId,
  name: 'Shampoo',
  sale_price: 10,
  default_purchase_cost: 4,
  minimum_stock: 1,
  category_id: null,
  description: null,
  sku: null,
  is_active: true,
  created_at: at,
  updated_at: at,
};
export function context(
  userId = scope.userId,
  businessId = scope.businessId,
  membershipId = scope.membershipId,
  role: 'OWNER' | 'BARBER' = 'OWNER',
) {
  jest.mocked(useAuth).mockReturnValue({
    status: 'authenticated',
    user: { id: userId },
    session: {},
    error: null,
  } as ReturnType<typeof useAuth>);
  jest.mocked(useBusiness).mockReturnValue({
    status: 'success',
    isFetching: false,
    error: null,
    data: {
      membershipId,
      role,
      business: {
        id: businessId,
        name: 'Demo',
        currency_code: 'ARS',
        timezone: 'UTC',
        is_active: true,
      },
    },
  });
}
export function seed(payment = true, appointmentId: string | null = null) {
  state().setScope(null);
  state().setScope(scope);
  state().startDraft(scope, id(1), { appointmentId });
  state().addLine(
    scope,
    id(1),
    { lineId: 'local-service', itemType: 'SERVICE', itemId: id(2), quantity: 1 },
    scope.businessId,
  );
  state().addLine(
    scope,
    id(1),
    { lineId: 'local-product', itemType: 'PRODUCT', itemId: id(3), quantity: 1 },
    scope.businessId,
  );
  if (payment) state().patchDraft(scope, id(1), { paymentMethod: 'BANK_TRANSFER' });
}
export const saved = (): CompleteCheckoutData => ({
  sale: {
    id: id(4),
    business_id: scope.businessId,
    client_id: null,
    appointment_id: null,
    operation_id: id(1),
    status: 'COMPLETED',
    subtotal: 110,
    discount: 0,
    total: 110,
    sold_at: at,
    created_by: id(5),
    created_at: at,
    updated_at: at,
  },
  items: [
    {
      id: id(6),
      sale_id: id(4),
      item_type: 'SERVICE',
      service_id: id(2),
      product_id: null,
      item_name_snapshot: 'Corte histórico',
      unit_price_snapshot: 100,
      quantity: 1,
      line_total: 100,
      unit_cost_snapshot: null,
      created_at: at,
    },
    {
      id: id(7),
      sale_id: id(4),
      item_type: 'PRODUCT',
      service_id: null,
      product_id: id(3),
      item_name_snapshot: 'Shampoo histórico',
      unit_price_snapshot: 10,
      quantity: 1,
      line_total: 10,
      unit_cost_snapshot: 4,
      created_at: at,
    },
  ],
  payments: [
    {
      id: id(10),
      business_id: scope.businessId,
      sale_id: id(4),
      payment_method: 'BANK_TRANSFER',
      amount: 110,
      notes: null,
      paid_at: at,
      created_by: id(5),
      created_at: at,
    },
  ],
});
