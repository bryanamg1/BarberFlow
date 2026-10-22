import { act, render } from '@testing-library/react-native';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { CheckoutDraftLifecycle } from '@/features/sales/store/CheckoutDraftLifecycle';
import { checkoutDraftStore } from '@/features/sales/store/checkoutDraftStore';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
const scope = { userId: 'u', businessId: 'b', membershipId: 'm' };
function context(userId = 'u', businessId = 'b', membershipId = 'm') {
  const user = { id: userId };
  jest.mocked(useAuth).mockReturnValue({
    status: 'authenticated',
    user,
    session: { user },
    error: null,
  } as ReturnType<typeof useAuth>);
  jest.mocked(useBusiness).mockReturnValue({
    status: 'success',
    isFetching: false,
    error: null,
    data: {
      membershipId,
      role: 'OWNER',
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
beforeEach(() => {
  checkoutDraftStore.getState().setScope(null);
  context();
});
test('lifecycle establishes scope, preserves token refresh identity and clears on unmount', async () => {
  const view = await render(<CheckoutDraftLifecycle />);
  await act(() => {
    checkoutDraftStore.getState().startDraft(scope, 'op');
  });
  context();
  await view.rerender(<CheckoutDraftLifecycle />);
  expect(checkoutDraftStore.getState().draft?.operationId).toBe('op');
  await view.unmount();
  expect(checkoutDraftStore.getState().scope).toBeNull();
});
test.each(['user', 'business', 'membership', 'logout', 'recovery', 'lost business'])(
  'lifecycle clears on %s',
  async (change) => {
    const view = await render(<CheckoutDraftLifecycle />);
    await act(() => {
      checkoutDraftStore.getState().startDraft(scope, 'op');
    });
    if (change === 'user') context('new');
    if (change === 'business') context('u', 'new');
    if (change === 'membership') context('u', 'b', 'new');
    if (change === 'logout')
      jest
        .mocked(useAuth)
        .mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
    if (change === 'recovery')
      jest
        .mocked(useAuth)
        .mockReturnValue({ ...useAuth(), status: 'recovering' } as ReturnType<typeof useAuth>);
    if (change === 'lost business')
      jest
        .mocked(useBusiness)
        .mockReturnValue({ status: 'idle', data: null, error: null, isFetching: false });
    await view.rerender(<CheckoutDraftLifecycle />);
    expect(checkoutDraftStore.getState().draft).toBeNull();
  },
);
