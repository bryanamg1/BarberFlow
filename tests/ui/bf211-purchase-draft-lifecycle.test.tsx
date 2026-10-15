import type { Session } from '@supabase/supabase-js';
import { act, render } from '@testing-library/react-native';

import { useAuth, type AuthState } from '@/features/auth/context/AuthContext';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { PurchaseDraftLifecycle } from '@/features/purchases/store/PurchaseDraftLifecycle';
import { purchaseDraftStore } from '@/features/purchases/store/purchaseDraftStore';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
const session = (id: string): Session => ({
  access_token: 'test-only',
  refresh_token: 'test-only',
  token_type: 'bearer',
  expires_in: 3600,
  user: {
    id,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
  },
});
const authenticated = (id = 'user-a'): AuthState => {
  const value = session(id);
  return { status: 'authenticated', session: value, user: value.user, error: null };
};
const success = (id = 'business-a'): Extract<BusinessContextValue, { status: 'success' }> => ({
  status: 'success',
  error: null,
  isFetching: false,
  data: {
    membershipId: 'member-a',
    role: 'OWNER',
    business: {
      id,
      name: 'Test',
      currency_code: 'ARS',
      timezone: 'America/Buenos_Aires',
      is_active: true,
    },
  },
});
const state = () => purchaseDraftStore.getState();
const seed = async () => {
  await act(() => {
    expect(state().startDraft('business-a', 'operation-a')).toBe(true);
    state().patchDraft('business-a', 'operation-a', { supplierName: 'Original' });
  });
};
beforeEach(() => {
  state().setBusiness(null);
  jest.mocked(useAuth).mockReturnValue(authenticated());
  jest.mocked(useBusiness).mockReturnValue(success());
});
afterEach(() => state().setBusiness(null));

test('BF211 lifecycle establishes context without visual UI or automatic draft', async () => {
  const view = await render(<PurchaseDraftLifecycle />);
  expect(view.toJSON()).toBeNull();
  expect(state().businessId).toBe('business-a');
  expect(state().draft).toBeNull();
});
test('BF211 same identity token refresh and business refetch preserve edits', async () => {
  const view = await render(<PurchaseDraftLifecycle />);
  await seed();
  const draft = state().draft;
  jest.mocked(useAuth).mockReturnValue(authenticated());
  jest.mocked(useBusiness).mockReturnValue({ ...success(), isFetching: true });
  await view.rerender(<PurchaseDraftLifecycle />);
  expect(state().draft).toBe(draft);
});
test('BF211 tenant switch clears prior draft and rejects late callbacks', async () => {
  const view = await render(<PurchaseDraftLifecycle />);
  await seed();
  jest.mocked(useBusiness).mockReturnValue(success('business-b'));
  await view.rerender(<PurchaseDraftLifecycle />);
  expect(state().businessId).toBe('business-b');
  expect(state().draft).toBeNull();
  await act(() => {
    state().startDraft('business-b', 'operation-b');
  });
  expect(state().clearDraft('business-a', 'operation-a')).toBe(false);
  expect(state().patchDraft('business-a', 'operation-a', { notes: 'late' })).toBe(false);
  expect(state().draft?.operationId).toBe('operation-b');
});
test('BF211 different user clears draft even when business ID stays the same', async () => {
  const view = await render(<PurchaseDraftLifecycle />);
  await seed();
  jest.mocked(useAuth).mockReturnValue(authenticated('user-b'));
  await view.rerender(<PurchaseDraftLifecycle />);
  expect(state().businessId).toBe('business-a');
  expect(state().draft).toBeNull();
});
test.each(['unauthenticated', 'initializing', 'error', 'recovering'] as const)(
  'BF211 auth %s clears draft despite stale business context',
  async (status) => {
    const view = await render(<PurchaseDraftLifecycle />);
    await seed();
    const value = session('user-a');
    const auth: AuthState =
      status === 'recovering'
        ? { status, session: value, user: value.user, error: null }
        : status === 'error'
          ? {
              status,
              session: null,
              user: null,
              error: { code: 'UNKNOWN_ERROR', message: 'Test error' },
            }
          : { status, session: null, user: null, error: null };
    jest.mocked(useAuth).mockReturnValue(auth);
    await view.rerender(<PurchaseDraftLifecycle />);
    expect(state().businessId).toBeNull();
    expect(state().draft).toBeNull();
  },
);
test.each(['idle', 'pending', 'error'] as const)(
  'BF211 business %s clears draft',
  async (status) => {
    const view = await render(<PurchaseDraftLifecycle />);
    await seed();
    const business: BusinessContextValue =
      status === 'error'
        ? {
            status,
            data: null,
            isFetching: false,
            error: { code: 'UNKNOWN_ERROR', message: 'Test error' },
          }
        : { status, data: null, error: null, isFetching: false };
    jest.mocked(useBusiness).mockReturnValue(business);
    await view.rerender(<PurchaseDraftLifecycle />);
    expect(state().businessId).toBeNull();
    expect(state().draft).toBeNull();
  },
);
test('BF211 unmount clears all context and draft', async () => {
  const view = await render(<PurchaseDraftLifecycle />);
  await seed();
  await view.unmount();
  expect(state().businessId).toBeNull();
  expect(state().draft).toBeNull();
});
