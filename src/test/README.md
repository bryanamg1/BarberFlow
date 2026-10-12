# Component tests

Run `npm run test:ui -- --runTestsByPath tests/ui/shared-infrastructure.test.tsx`
for a focused test, `npm run test:ui` for native component tests, or `npm test`
for the existing Node suite followed by component tests. Jest discovers only
`tests/ui/**/*.test.ts(x)`; Node keeps `tests/*.test.cjs`.

Use `await renderWithProviders(ui)` and RNTL `screen` queries. It returns the
normal render result plus its isolated `queryClient`. Inject a client from
`createTestQueryClient()` when inspecting cache or invalidation. An optional
`wrapper` can add a provider required by a particular consumer. Do not import
the production QueryProvider or singleton client into this harness.

RNTL unmounts automatically; the setup then clears all factory/injected clients
(including their mutations and in-flight queries), restores real timers, and
Jest resets mocks/restores spies before the next test. Do not share clients
across tests or use `test.concurrent` with shared `screen`/router mocks.

`routerMock` exposes typed `push`, `replace`, and `back` spies. Global setup mocks
only `router`/`useRouter`. Route-specific parameters, Links or integration
navigation should be mocked explicitly by the consuming test. Call
`resetRouterMocks()` when clearing calls within a test; Jest resets them between
tests. No real navigation executes.

Mock public `useAuth` and `useBusiness` hooks at the feature boundary, without
mounting real Auth/Business providers or importing Supabase. Use `jest.MockedFunction`
with `typeof useAuth` / `typeof useBusiness` so fixtures conform to the exported
`AuthState` / `BusinessContextValue` unions. Auth supports initializing,
authenticated, unauthenticated, recovering and error; Business supports idle,
pending, success and error. The proof tests demonstrate this strategy.

Await RNTL14 `render`, `rerender`, `fireEvent` and `userEvent` operations. Prefer
role/label/text queries, `findBy*` for async elements and `waitFor` for async
assertions. Use controllable promises for pending requests, not sleeps. Form
tests use real RHF and field/button primitives while mocking service boundaries.
Never swallow render errors, blanket-mute consoles, or use real credentials,
sessions or remote requests. Native component tests are not browser/device E2E.
