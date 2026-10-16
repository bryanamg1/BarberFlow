type Router = typeof import('expo-router').router;

export const routerMock = {
  push: jest.fn<ReturnType<Router['push']>, Parameters<Router['push']>>(),
  replace: jest.fn<ReturnType<Router['replace']>, Parameters<Router['replace']>>(),
  back: jest.fn<ReturnType<Router['back']>, Parameters<Router['back']>>(),
  dismissTo: jest.fn<ReturnType<Router['dismissTo']>, Parameters<Router['dismissTo']>>(),
} satisfies Pick<Router, 'push' | 'replace' | 'back' | 'dismissTo'>;

export function resetRouterMocks(): void {
  routerMock.push.mockReset();
  routerMock.replace.mockReset();
  routerMock.back.mockReset();
  routerMock.dismissTo.mockReset();
}
