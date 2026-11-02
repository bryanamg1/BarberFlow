import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Dimensions, StyleSheet, type ViewStyle } from 'react-native';
import type { TestInstance } from 'test-renderer';

import { AgendaScreen } from '@/features/appointments/screens/AgendaScreen';
import { appointmentsService } from '@/features/appointments/services/appointmentsService';
import { renderWithProviders } from '@/test/renderWithProviders';
import { routerMock, resetRouterMocks } from '@/test/routerTestUtils';
import { theme } from '@/theme';
import { agendaContext, agendaRow } from './helpers/agendaFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  router: jest.requireActual('@/test/routerTestUtils').routerMock,
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@/features/appointments/services/appointmentsService', () => ({
  appointmentsService: { listByRange: jest.fn() },
}));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('No direct SDK from responsive UI');
});

const original = Dimensions.get('window');
const widths = [320, 390, 767, 768, 1024, 1200, 1280];
const resize = async (width: number) =>
  act(() => Dimensions.set({ window: { ...original, width } }));
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  agendaContext();
  resetRouterMocks();
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-02T01:00:00Z'));
  jest
    .mocked(appointmentsService.listByRange)
    .mockResolvedValue({ data: [agendaRow('original')], error: null });
});
afterEach(async () => {
  notifyManager.setScheduler(defaultScheduler);
  await resize(original.width);
});

function ancestor(start: TestInstance, predicate: (style: ViewStyle | undefined) => boolean) {
  let node: TestInstance | null = start;
  while (node) {
    if (predicate(StyleSheet.flatten(node.props.style))) return node;
    node = node.parent;
  }
  throw new Error('Missing responsive ancestor');
}
function expectLayout(width: number) {
  const content = ancestor(
    screen.getByRole('heading', { name: 'Agenda' }),
    (s) => s?.width === '100%',
  );
  expect(StyleSheet.flatten(content.props.style)).toMatchObject({
    alignSelf: 'center',
    paddingHorizontal: theme.spacing[16],
    paddingVertical: theme.spacing[16],
    gap: theme.spacing[16],
    maxWidth: width >= 768 ? 1200 : undefined,
  });
  const toolbar = ancestor(
    screen.getByLabelText('Navegación de fechas'),
    (s) => s?.gap === theme.spacing[16] && s.flexDirection !== undefined,
  );
  expect(StyleSheet.flatten(toolbar.props.style).flexDirection).toBe(
    width >= 768 ? 'row' : 'column',
  );
}
describe.each(['Día', 'Semana', 'Mes'] as const)('%s', (view) => {
  test.each(widths)(
    'width %s preserves selected view, D23 continuation, identity and single active query',
    async (width) => {
      await resize(width);
      await renderWithProviders(<AgendaScreen />);
      await screen.findByRole('button', { name: /^Turno, Continúa/ });
      if (view !== 'Día') {
        await fireEvent.press(screen.getByRole('button', { name: view }));
        await waitFor(() =>
          expect(screen.getAllByRole('button', { name: /^Turno,/ })).toHaveLength(2),
        );
      }
      expectLayout(width);
      expect(screen.getByText(`Vista actual: ${view}`)).toBeTruthy();
      expect(screen.getByRole('button', { name: view }).props.accessibilityState.selected).toBe(
        true,
      );
      const readCount = jest.mocked(appointmentsService.listByRange).mock.calls.length;
      expect(readCount).toBe(view === 'Día' ? 1 : 2);
      const expectedRange = jest.mocked(appointmentsService.listByRange).mock.calls.at(-1)![1];
      for (const nextWidth of [width >= 768 ? 390 : 1024, width]) {
        await resize(nextWidth);
        expectLayout(nextWidth);
        expect(screen.getByText(`Vista actual: ${view}`)).toBeTruthy();
        expect(appointmentsService.listByRange).toHaveBeenCalledTimes(readCount);
        expect(jest.mocked(appointmentsService.listByRange).mock.calls.at(-1)![1]).toEqual(
          expectedRange,
        );
        expect(screen.getAllByRole('button', { name: /^Turno,/ })).toHaveLength(
          view === 'Día' ? 1 : 2,
        );
        expect(screen.getByRole('button', { name: /^Turno, Continúa/ })).toBeTruthy();
      }
      await fireEvent.press(screen.getByRole('button', { name: /^Turno, Continúa/ }));
      expect(routerMock.push).toHaveBeenCalledWith({
        pathname: '/appointments/[id]',
        params: { id: 'original' },
      });
    },
  );
});

test('navigated civil date survives reflow; previous/next/Today retain business timezone', async () => {
  agendaContext({ timezone: 'America/Argentina/Buenos_Aires' });
  await resize(390);
  await renderWithProviders(<AgendaScreen />);
  await screen.findByRole('heading', { name: 'jueves, 1 de octubre de 2026' });
  await fireEvent.press(screen.getByRole('button', { name: 'Día siguiente' }));
  await screen.findByRole('heading', { name: 'viernes, 2 de octubre de 2026' });
  await waitFor(() => expect(appointmentsService.listByRange).toHaveBeenCalledTimes(2));
  await resize(1280);
  expect(screen.getByRole('heading', { name: 'viernes, 2 de octubre de 2026' })).toBeTruthy();
  expect(appointmentsService.listByRange).toHaveBeenCalledTimes(2);
  expect(appointmentsService.listByRange).toHaveBeenLastCalledWith('b', {
    from: '2026-10-02T03:00:00.000Z',
    to: '2026-10-03T03:00:00.000Z',
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Día anterior' }));
  await screen.findByRole('heading', { name: 'jueves, 1 de octubre de 2026' });
  await fireEvent.press(screen.getByRole('button', { name: 'Día siguiente' }));
  await screen.findByRole('heading', { name: 'viernes, 2 de octubre de 2026' });
  await fireEvent.press(
    screen.getByRole('button', { name: 'Ir a hoy en la zona horaria del negocio' }),
  );
  await screen.findByRole('heading', { name: 'jueves, 1 de octubre de 2026' });
});
