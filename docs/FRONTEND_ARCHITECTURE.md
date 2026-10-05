# BarberFlow — Frontend Architecture

Version: 1.0  
Status: APPROVED

## Architecture

Use feature-first architecture. Dependency direction:

```text
Screen
  ↓
Feature UI
  ↓
Feature Hook
  ↓
Domain Service
  ↓
Repository
  ↓
Supabase
```

Screens compose UI and navigation only. They must not contain SQL, accounting logic, inventory math or complex domain rules.

Feature-specific components live inside their feature. Shared UI primitives live in `src/components/ui`.

## Feature structure

```text
src/features/<feature>/
  components/
  hooks/
  services/
  repositories/
  schemas/
  types/
  utils/
  constants/
```

Create only folders actually needed.

## Core features

- auth
- business
- clients
- services
- appointments
- sales
- payments
- products
- inventory
- purchases
- expenses
- analytics

## Server state

TanStack Query is the source of truth for server state. Query keys must be centralized per feature.

Zustand is limited to justified UI/client state such as checkout draft, purchase draft, current business reference, temporary filters and UI preferences. Do not store full client/product/appointment collections in Zustand.

## Forms

Use React Hook Form + Zod.

Expected schemas include `client`, `service`, `appointment`, `product`, `expense`, `checkout`, `purchase` and `stock-adjustment`.

## Data access

Repositories own `supabase.from(...)`, `supabase.rpc(...)` and storage calls. Services map raw technical errors to domain errors. UI never shows raw Postgres messages.

## Routing

Use Expo Router with `(auth)` and `(app)` route groups. Session bootstrap should load session → profile → active membership → business before rendering protected app routes.

Mobile tabs: Home, Agenda, Quick Action, Clients, Finances. The center Quick Action opens a sheet/menu.

## Web

Do not stretch mobile UI to desktop width. Use responsive content widths, grids, side-by-side panels and wider chart layouts while keeping shared business logic.

## Environment

Allowed client variables:
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Never expose the service-role key. Validate environment centrally in `src/lib/env.ts`. Use one shared Supabase client in `src/lib/supabase/client.ts`.

## Naming

- Components: `PascalCase.tsx`
- Hooks: `useSomething.ts`
- Services: `somethingService.ts`
- Repositories: `somethingRepository.ts`
- Schemas: `something.schema.ts`
- Types: `something.types.ts`

Use aliases such as `@/components`, `@/features`, `@/lib`, `@/theme`, `@/utils`, `@/types`.
