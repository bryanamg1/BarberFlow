import { act, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet, type ViewStyle } from 'react-native';
import type { TestInstance } from 'test-renderer';

import { HomeScreen } from '@/features/analytics/screens/HomeScreen';
import { useHomeDashboardSummary } from '@/features/analytics/hooks/useHomeDashboardSummary';
import { useNextAppointment } from '@/features/analytics/hooks/useNextAppointment';
import { theme } from '@/theme';
import { agendaContext } from './helpers/agendaFixture';
import { financeSummary } from './helpers/financeFixture';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useIsFocused: () => true }));
jest.mock('@/features/analytics/hooks/useHomeDashboardSummary', () => ({
  useHomeDashboardSummary: jest.fn(),
}));
jest.mock('@/features/analytics/hooks/useNextAppointment', () => ({
  useNextAppointment: jest.fn(),
}));
// Real financial and next widgets; independent producers retain their own tested data lifecycle.
jest.mock('@/features/analytics/components/HomeTodayAppointments', () => ({
  HomeTodayAppointments: () => {
    const React = jest.requireActual('react'),
      { Text } = jest.requireActual('react-native');
    return React.createElement(Text, null, 'Today operativo');
  },
}));
jest.mock('@/features/analytics/components/HomeLowStock', () => ({
  HomeLowStock: () => {
    const React = jest.requireActual('react'),
      { Text } = jest.requireActual('react-native');
    return React.createElement(Text, null, 'Stock operativo');
  },
}));
const original = Dimensions.get('window');
const widths = [320, 390, 767, 768, 1024, 1200, 1280];
const resize = async (width: number) =>
  act(() => Dimensions.set({ window: { ...original, width } }));
beforeEach(() => {
  agendaContext();
  jest
    .mocked(useHomeDashboardSummary)
    .mockReturnValue({ status: 'success', data: financeSummary() });
  jest.mocked(useNextAppointment).mockReturnValue({ status: 'success', data: null });
});
afterEach(async () => resize(original.width));

function ancestor(start: TestInstance, predicate: (style: ViewStyle | undefined) => boolean) {
  let node: TestInstance | null = start;
  while (node) {
    if (predicate(StyleSheet.flatten(node.props.style))) return node;
    node = node.parent;
  }
  throw new Error('Expected layout ancestor');
}

describe.each(['OWNER', 'BARBER'] as const)('%s', (role) => {
  test.each(widths)(
    'width %s keeps role semantics, labels and mobile reading order',
    async (width) => {
      agendaContext({ role });
      await resize(width);
      await render(<HomeScreen />);
      const content = ancestor(
        screen.getByRole('heading', { name: 'Inicio' }),
        (s) => s?.width === '100%',
      );
      expect(StyleSheet.flatten(content.props.style)).toMatchObject({
        paddingHorizontal: theme.spacing[16],
        paddingVertical: theme.spacing[16],
        gap: theme.spacing[24],
        alignSelf: 'center',
        maxWidth: width >= 768 ? 1200 : undefined,
      });
      const pair = ancestor(
        screen.getByText('Today operativo'),
        (s) => s?.gap === theme.spacing[24],
      );
      expect(StyleSheet.flatten(pair.props.style).flexDirection).toBe(
        width >= 768 ? 'row' : undefined,
      );
      expect(screen.getByText('No hay próximos turnos')).toBeTruthy();
      expect(screen.getByText('Stock operativo')).toBeTruthy();
      if (role === 'OWNER') {
        expect(screen.getByLabelText(/^Ingresos de hoy:/)).toBeTruthy();
        expect(screen.getByLabelText('Turnos de hoy: 2')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Resumen financiero' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Ver finanzas' })).toBeTruthy();
      } else {
        expect(screen.queryByLabelText(/^Ingresos/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Ver finanzas' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Resumen financiero' })).toBeNull();
      }
      expect(useHomeDashboardSummary).toHaveBeenCalledTimes(1);
      expect(useNextAppointment).toHaveBeenCalledTimes(1);
    },
  );
});
