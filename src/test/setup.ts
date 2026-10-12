// Import first: RNTL registers its automatic unmount before our cache cleanup.
import '@testing-library/react-native';

import { clearTestQueryClients } from './createTestQueryClient';

jest.mock('expo-router', () => {
  const { routerMock } =
    jest.requireActual<typeof import('./routerTestUtils')>('./routerTestUtils');
  return { router: routerMock, useRouter: () => routerMock };
});

afterEach(() => {
  clearTestQueryClients();
  jest.useRealTimers();
});
