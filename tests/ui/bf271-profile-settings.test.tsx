import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { uuid } from 'expo-modules-core';
import ProfileRoute from '@/app/(app)/settings/profile';
import { useAuth } from '@/features/auth/context/AuthContext';
import {
  useBusiness,
  type BusinessContextValue,
} from '@/features/business/context/BusinessContext';
import { ProfileSettingsScreen } from '@/features/business/screens/ProfileSettingsScreen';
import { SettingsScreen } from '@/features/business/screens/SettingsScreen';
import { avatarPicker } from '@/features/business/services/avatarPicker';
import { profileService } from '@/features/business/services/profileService';
import type { ProfileRow } from '@/features/business/schemas/profile.schema';
import { storageService } from '@/lib/storage';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetRouterMocks, routerMock } from '@/test/routerTestUtils';

jest.mock('@/features/auth/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/business/context/BusinessContext', () => ({ useBusiness: jest.fn() }));
jest.mock('@/features/auth/components/LogoutButton', () => ({ LogoutButton: () => null }));
jest.mock('@/features/business/services/avatarPicker', () => ({
  avatarPicker: { pick: jest.fn() },
}));
jest.mock('@/features/business/services/profileService', () => ({
  profileService: { get: jest.fn(), update: jest.fn() },
  profileError: (code: string) => ({ code, message: 'Error seguro ' + code }),
}));
jest.mock('@/lib/storage', () => ({
  storageService: { upload: jest.fn(), remove: jest.fn(), createSignedUrl: jest.fn() },
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
const user = '00000000-0000-4000-8000-000000000271';
const other = '00000000-0000-4000-8000-000000000272';
const file = '00000000-0000-4000-8000-000000000273';
const old = `avatars/${user}/00000000-0000-4000-8000-000000000274.png`;
const next = `avatars/${user}/${file}.png`;
const initial: ProfileRow = {
  id: user,
  first_name: 'Ana',
  last_name: 'Pérez',
  phone: null,
  avatar_path: old,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};
const authMock = jest.mocked(useAuth),
  businessMock = jest.mocked(useBusiness),
  profileMock = jest.mocked(profileService),
  storageMock = jest.mocked(storageService),
  pickerMock = jest.mocked(avatarPicker);
const auth = (id = user) =>
  ({
    status: 'authenticated',
    initializing: false,
    user: { id, email: `${id}@example.test` },
    session: {},
    error: null,
  }) as unknown as ReturnType<typeof useAuth>;
const business = (role: 'OWNER' | 'BARBER' = 'OWNER', id = 'business'): BusinessContextValue => ({
  status: 'success',
  isFetching: false,
  error: null,
  data: {
    membershipId: 'membership-' + id,
    role,
    business: { id, name: 'Fixture', currency_code: 'ARS', timezone: 'UTC', is_active: true },
  },
});
const body = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function ready() {
  const view = await renderWithProviders(<ProfileSettingsScreen />);
  await screen.findByLabelText('Nombre');
  return view;
}
beforeEach(() => {
  resetRouterMocks();
  jest.spyOn(uuid, 'v4').mockReturnValue(file);
  authMock.mockReturnValue(auth());
  businessMock.mockReturnValue(business());
  profileMock.get.mockImplementation(async (id) => ({ data: { ...initial, id }, error: null }));
  profileMock.update.mockImplementation(async (id, input) => ({
    data: { ...initial, ...input, id },
    error: null,
  }));
  pickerMock.pick.mockResolvedValue({ status: 'selected', body, contentType: 'image/png' });
  storageMock.upload.mockResolvedValue({ data: { path: next }, error: null });
  storageMock.remove.mockResolvedValue({ data: null, error: null });
  storageMock.createSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://signed.example.test/transient' },
    error: null,
  });
});
test('thin route exposes ProfileSettingsScreen and safe named return', async () => {
  expect(ProfileRoute).toBe(ProfileSettingsScreen);
  await ready();
  await fireEvent.press(screen.getByRole('button', { name: 'Volver a Configuración' }));
  expect(routerMock.dismissTo).toHaveBeenCalledWith('/settings');
});
test.each(['OWNER', 'BARBER'] as const)(
  '%s has self-only profile form and read-only auth email',
  async (role) => {
    businessMock.mockReturnValue(business(role));
    await ready();
    expect(profileMock.get).toHaveBeenCalledWith(user);
    expect(screen.getByLabelText('Correo electrónico')).toHaveProp('readOnly', true);
    expect(screen.getByLabelText('Correo electrónico')).toHaveProp('value', `${user}@example.test`);
    expect(screen.getByRole('image', { name: 'Avatar del perfil' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Guardar perfil' })).toBeDisabled();
  },
);
test('settings has one profile entry independent of OWNER admin links', async () => {
  businessMock.mockReturnValue(business('BARBER'));
  await renderWithProviders(<SettingsScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Editar perfil' }));
  expect(routerMock.push).toHaveBeenCalledWith('/settings/profile');
});
test('loading has no editable stale profile', async () => {
  profileMock.get.mockReturnValue(new Promise(() => {}));
  await renderWithProviders(<ProfileSettingsScreen />);
  expect(screen.getByText('Cargando perfil…')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Nombre')).toBeNull();
});
test('no business context prevents reads and offers unavailable state', async () => {
  businessMock.mockReturnValue({ status: 'idle', isFetching: false, data: null, error: null });
  await renderWithProviders(<ProfileSettingsScreen />);
  expect(screen.getByText('Perfil no disponible')).toBeOnTheScreen();
  expect(profileMock.get).not.toHaveBeenCalled();
});
test('read failure uses safe feedback and explicit retry', async () => {
  profileMock.get.mockResolvedValueOnce({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'Sin conexión segura' },
  });
  await renderWithProviders(<ProfileSettingsScreen />);
  await screen.findByText('Sin conexión segura');
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByLabelText('Nombre');
  expect(profileMock.get).toHaveBeenCalledTimes(2);
});
test('text save sends only dirty original text and adopts persisted result', async () => {
  const stored = { ...initial, first_name: '  A  ' };
  profileMock.update.mockResolvedValue({ data: stored, error: null });
  profileMock.get
    .mockResolvedValueOnce({ data: initial, error: null })
    .mockResolvedValue({ data: stored, error: null });
  await ready();
  await fireEvent.changeText(screen.getByLabelText('Nombre'), '  A  ');
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar perfil' }));
  await screen.findByText('Perfil guardado.');
  expect(profileMock.update).toHaveBeenCalledWith(user, { first_name: '  A  ' });
  expect(screen.getByLabelText('Nombre')).toHaveProp('value', '  A  ');
  expect(screen.getByRole('button', { name: 'Guardar perfil' })).toBeDisabled();
  expect(storageMock.upload).not.toHaveBeenCalled();
});
test('clear phone explicitly persists null, without normalizing empty names', async () => {
  profileMock.get.mockResolvedValue({ data: { ...initial, phone: '555' }, error: null });
  await ready();
  await fireEvent.changeText(screen.getByLabelText('Nombre'), '');
  await fireEvent.press(screen.getByRole('button', { name: 'Quitar teléfono' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar perfil' }));
  await waitFor(() =>
    expect(profileMock.update).toHaveBeenCalledWith(user, { first_name: '', phone: null }),
  );
});
test.each(['image/jpeg', 'image/png'] as const)(
  'avatar %s persists new pointer before cleaning previous image',
  async (contentType) => {
    const order: string[] = [];
    pickerMock.pick.mockResolvedValue({ status: 'selected', body, contentType });
    storageMock.upload.mockImplementation(async () => {
      order.push('upload');
      return { data: { path: next }, error: null };
    });
    profileMock.update.mockImplementation(async (id, input) => {
      order.push('pointer');
      return { data: { ...initial, ...input, id }, error: null };
    });
    storageMock.remove.mockImplementation(async () => {
      order.push('cleanup');
      return { data: null, error: null };
    });
    await ready();
    await fireEvent.press(screen.getByRole('button', { name: 'Cambiar avatar' }));
    await screen.findByText('Avatar guardado.');
    expect(order).toEqual(['upload', 'pointer', 'cleanup']);
    expect(storageMock.upload).toHaveBeenCalledWith({
      target: { kind: 'avatar' },
      objectUuid: file,
      body,
      contentType,
    });
    expect(profileMock.update).toHaveBeenCalledWith(user, { avatar_path: next });
    expect(storageMock.remove).toHaveBeenCalledWith(old);
  },
);
test('cancel does not upload, persist or clean', async () => {
  pickerMock.pick.mockResolvedValue({ status: 'cancelled' });
  await ready();
  await fireEvent.press(screen.getByRole('button', { name: 'Cambiar avatar' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cambiar avatar' })).toBeEnabled());
  expect(storageMock.upload).not.toHaveBeenCalled();
  expect(profileMock.update).not.toHaveBeenCalled();
  expect(storageMock.remove).not.toHaveBeenCalled();
});
test('permission failure exposes safe ACCESS_DENIED without upload', async () => {
  pickerMock.pick.mockResolvedValue({
    status: 'error',
    error: { code: 'ACCESS_DENIED', message: 'Sin permiso' },
  });
  await ready();
  await fireEvent.press(screen.getByRole('button', { name: 'Cambiar avatar' }));
  await screen.findByText('Sin permiso');
  expect(storageMock.upload).not.toHaveBeenCalled();
});
test.each([
  'INVALID_INPUT',
  'ACCESS_DENIED',
  'NOT_FOUND',
  'NETWORK_ERROR',
  'UNKNOWN_ERROR',
] as const)('Storage %s leaves original pointer and useful text draft untouched', async (code) => {
  storageMock.upload.mockResolvedValue({
    data: null,
    error: { code, message: 'Fallo seguro ' + code },
  });
  await ready();
  await fireEvent.changeText(screen.getByLabelText('Nombre'), 'Draft');
  await fireEvent.press(screen.getByRole('button', { name: 'Cambiar avatar' }));
  await screen.findByText('Fallo seguro ' + code);
  expect(profileMock.update).not.toHaveBeenCalled();
  expect(storageMock.remove).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Nombre')).toHaveProp('value', 'Draft');
});
test('pointer failure never deletes original or possibly committed new object', async () => {
  profileMock.update.mockResolvedValue({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'Confirmación desconocida' },
  });
  await ready();
  await fireEvent.press(screen.getByRole('button', { name: 'Cambiar avatar' }));
  await screen.findByText('Confirmación desconocida');
  expect(storageMock.remove).not.toHaveBeenCalled();
});
test('cleanup failure reports successful persistence without undo', async () => {
  storageMock.remove.mockResolvedValue({
    data: null,
    error: { code: 'NOT_FOUND', message: 'No disponible' },
  });
  await ready();
  await fireEvent.press(screen.getByRole('button', { name: 'Cambiar avatar' }));
  await screen.findByText('Avatar guardado. No se pudo limpiar el archivo anterior.');
  expect(profileMock.update).toHaveBeenCalledTimes(1);
});
test('double press blocked synchronously during selection and upload', async () => {
  const pending = deferred<Awaited<ReturnType<typeof avatarPicker.pick>>>();
  pickerMock.pick.mockReturnValue(pending.promise);
  await ready();
  const button = screen.getByRole('button', { name: 'Cambiar avatar' });
  await fireEvent.press(button);
  await fireEvent.press(button);
  expect(pickerMock.pick).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Guardar perfil' })).toBeDisabled();
  await act(async () => pending.resolve({ status: 'cancelled' }));
});
test('user switch during selection ignores stale bytes and allows the new identity', async () => {
  const pending = deferred<Awaited<ReturnType<typeof avatarPicker.pick>>>();
  pickerMock.pick.mockReturnValueOnce(pending.promise);
  const view = await ready();
  await fireEvent.press(screen.getByRole('button', { name: 'Cambiar avatar' }));
  authMock.mockReturnValue(auth(other));
  await view.rerender(<ProfileSettingsScreen />);
  await screen.findByLabelText('Nombre');
  await act(async () => pending.resolve({ status: 'selected', body, contentType: 'image/png' }));
  expect(storageMock.upload).not.toHaveBeenCalled();
  expect(profileMock.update).not.toHaveBeenCalled();
});
test('logout during upload prevents late pointer write or cleanup', async () => {
  const pending = deferred<Awaited<ReturnType<typeof storageService.upload>>>();
  storageMock.upload.mockReturnValue(pending.promise);
  const view = await ready();
  await fireEvent.press(screen.getByRole('button', { name: 'Cambiar avatar' }));
  await waitFor(() => expect(storageMock.upload).toHaveBeenCalledTimes(1));
  authMock.mockReturnValue({ status: 'unauthenticated', user: null, session: null, error: null });
  await view.rerender(<ProfileSettingsScreen />);
  await act(async () => pending.resolve({ data: { path: next }, error: null }));
  expect(profileMock.update).not.toHaveBeenCalled();
  expect(storageMock.remove).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Nombre')).toBeNull();
});
test('unmount during upload never starts pointer write', async () => {
  const pending = deferred<Awaited<ReturnType<typeof storageService.upload>>>();
  storageMock.upload.mockReturnValue(pending.promise);
  const view = await ready();
  await fireEvent.press(screen.getByRole('button', { name: 'Cambiar avatar' }));
  await waitFor(() => expect(storageMock.upload).toHaveBeenCalledTimes(1));
  await view.unmount();
  await act(async () => pending.resolve({ data: { path: next }, error: null }));
  expect(profileMock.update).not.toHaveBeenCalled();
});
test('foreign upload path cannot become own profile pointer', async () => {
  storageMock.upload.mockResolvedValue({
    data: { path: `avatars/${other}/${file}.png` },
    error: null,
  });
  await ready();
  await fireEvent.press(screen.getByRole('button', { name: 'Cambiar avatar' }));
  await screen.findByText('Error seguro ACCESS_DENIED');
  expect(profileMock.update).not.toHaveBeenCalled();
});
test('signed image failure leaves initials and usable form', async () => {
  storageMock.createSignedUrl.mockResolvedValue({
    data: null,
    error: { code: 'NOT_FOUND', message: 'Imagen no disponible' },
  });
  await ready();
  await screen.findByText('Imagen no disponible');
  expect(screen.getByText('AP', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Cambiar avatar' })).toBeEnabled();
});

test('A to B to A never revives an obsolete selection or busy state', async () => {
  const pending = deferred<Awaited<ReturnType<typeof avatarPicker.pick>>>();
  pickerMock.pick.mockReturnValueOnce(pending.promise);
  const view = await ready();
  await fireEvent.press(screen.getByRole('button', { name: 'Cambiar avatar' }));
  authMock.mockReturnValue(auth(other));
  await view.rerender(<ProfileSettingsScreen />);
  await screen.findByLabelText('Nombre');
  authMock.mockReturnValue(auth());
  await view.rerender(<ProfileSettingsScreen />);
  await screen.findByLabelText('Nombre');
  await act(async () => pending.resolve({ status: 'selected', body, contentType: 'image/png' }));
  expect(storageMock.upload).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Cambiar avatar' })).toBeEnabled();
});

test('business switch during upload invalidates the captured workflow', async () => {
  const pending = deferred<Awaited<ReturnType<typeof storageService.upload>>>();
  storageMock.upload.mockReturnValueOnce(pending.promise);
  const view = await ready();
  await fireEvent.press(screen.getByRole('button', { name: 'Cambiar avatar' }));
  await waitFor(() => expect(storageMock.upload).toHaveBeenCalledTimes(1));
  businessMock.mockReturnValue(business('OWNER', 'other-business'));
  await view.rerender(<ProfileSettingsScreen />);
  await screen.findByLabelText('Nombre');
  await act(async () => pending.resolve({ data: { path: next }, error: null }));
  expect(profileMock.update).not.toHaveBeenCalled();
  expect(storageMock.remove).not.toHaveBeenCalled();
});

test('failed text save preserves the draft for explicit retry', async () => {
  profileMock.update.mockResolvedValueOnce({
    data: null,
    error: { code: 'NETWORK_ERROR', message: 'Reintenta guardar' },
  });
  await ready();
  await fireEvent.changeText(screen.getByLabelText('Nombre'), 'Draft preservado');
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar perfil' }));
  await screen.findByText('Reintenta guardar');
  expect(screen.getByLabelText('Nombre')).toHaveProp('value', 'Draft preservado');
  expect(screen.getByRole('button', { name: 'Guardar perfil' })).toBeEnabled();
});
