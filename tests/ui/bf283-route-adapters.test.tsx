import { screen } from '@testing-library/react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import AppLayout from '@/app/(app)/_layout';
import EditAppointmentRoute from '@/app/(app)/appointments/[id]/edit';
import EditProductRoute from '@/app/(app)/products/[id]/edit';
import CategoryRoute from '@/app/(app)/products/categories';
import CreateCategoryRoute from '@/app/(app)/products/categories/new';
import EditCategoryRoute from '@/app/(app)/products/categories/[id]/edit';
import NewPurchaseRoute from '@/app/(app)/purchases/new';
import SaleHistoryRoute from '@/app/(app)/sales';
import { renderWithProviders } from '@/test/renderWithProviders';

jest.mock('expo-router', () => ({
  Stack: Object.assign(
    jest.fn(() => null),
    { Screen: () => null },
  ),
  useLocalSearchParams: jest.fn(),
}));
jest.mock('@/features/appointments/screens/AppointmentEditScreen', () => ({
  AppointmentEditScreen: jest.fn(() => null),
}));
jest.mock('@/features/products/screens/ProductFormScreen', () => ({
  ProductFormScreen: jest.fn(() => null),
}));
jest.mock('@/features/products/screens/ProductCategoriesScreen', () => ({
  ProductCategoriesScreen: () => null,
}));
jest.mock('@/features/products/screens/ProductCategoryCreateScreen', () => ({
  ProductCategoryCreateScreen: () => null,
}));
jest.mock('@/features/products/screens/ProductCategoryEditScreen', () => ({
  ProductCategoryEditScreen: jest.fn(() => null),
}));
jest.mock('@/features/purchases/screens/PurchaseFormScreen', () => ({
  PurchaseFormScreen: () => null,
}));
jest.mock('@/features/sales/screens/SaleHistoryScreen', () => ({ SaleHistoryScreen: () => null }));
jest.mock('@/lib/supabase/client', () => {
  throw new Error('Route registration must not access data');
});
beforeEach(() => jest.mocked(useLocalSearchParams).mockReturnValue({ id: 'fixture' }));

test('BF283 renders final stack options with tabs header hidden and all new existing screens configured', async () => {
  await renderWithProviders(<AppLayout />);
  const props = jest.mocked(Stack).mock.calls[0][0];
  const children = props.children as React.ReactElement<{
    name: string;
    options: { title?: string; headerShown?: boolean; presentation?: string };
  }>[];
  const options = new Map(children.map((child) => [child.props.name, child.props.options]));
  expect(options.get('(tabs)')?.headerShown).toBe(false);
  for (const [name, title] of [
    ['appointments/[id]/edit', 'Editar cita'],
    ['products/[id]/edit', 'Editar producto'],
    ['products/categories/index', 'Categorías'],
    ['products/categories/new', 'Crear categoría'],
    ['products/categories/[id]/edit', 'Editar categoría'],
    ['purchases/new', 'Nueva compra'],
    ['sales/index', 'Historial de ventas'],
  ])
    expect(options.get(name)).toEqual({ title });
  expect(children.every((child) => child.props.options.presentation === undefined)).toBe(true);
  expect(screen.queryByRole('dialog')).toBeNull();
});
for (const [name, Route] of [
  ['appointment edit', EditAppointmentRoute],
  ['product edit', EditProductRoute],
  ['category list', CategoryRoute],
  ['category create', CreateCategoryRoute],
  ['category edit', EditCategoryRoute],
  ['purchase new', NewPurchaseRoute],
  ['sale history', SaleHistoryRoute],
] as const)
  test(`BF283 direct ${name} adapter mounts without a prior screen or data access`, async () => {
    await renderWithProviders(<Route />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
for (const [name, Route, modulePath, exportName, prop] of [
  [
    'appointment',
    EditAppointmentRoute,
    '@/features/appointments/screens/AppointmentEditScreen',
    'AppointmentEditScreen',
    'appointmentId',
  ],
  [
    'product',
    EditProductRoute,
    '@/features/products/screens/ProductFormScreen',
    'ProductFormScreen',
    'productId',
  ],
  [
    'category',
    EditCategoryRoute,
    '@/features/products/screens/ProductCategoryEditScreen',
    'ProductCategoryEditScreen',
    'productCategoryId',
  ],
] as const)
  test.each([undefined, [], ['ambiguous', 'id']])(
    `BF283 ${name} missing/ambiguous identifier delegates null to its existing feature guard`,
    async (id) => {
      jest.mocked(useLocalSearchParams).mockReturnValue(id === undefined ? {} : { id });
      await renderWithProviders(<Route />);
      const component = jest.requireMock<Record<string, jest.Mock>>(modulePath)[exportName];
      expect(component.mock.calls[0][0][prop]).toBeNull();
    },
  );
