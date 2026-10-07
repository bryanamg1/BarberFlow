# BarberFlow — Technical Backlog

Version: 1.0  
Status: APPROVED BASELINE

Priorities: P0 blocks development/integrity, P1 core V1, P2 enhancement, P3 nice-to-have.

## Epic 0 Documentation
BF-001 [P0] Install specification/documentation baseline; BF-002 frontend architecture; BF-003 transactional checkout ADR; BF-004 inventory ledger ADR; BF-005 design system docs.

## Epic 1 Bootstrap
BF-010 Expo+TypeScript; BF-011 Expo Router; BF-012 aliases; BF-013 ESLint; BF-014 Prettier; BF-015 env validation; BF-016 Supabase client; BF-017 feature-first structure.

## Epic 2 Theme
BF-020 colors; BF-021 spacing; BF-022 typography; BF-023 radius; BF-024 shadows; BF-025 Inter font.

## Epic 3 Shared UI
BF-030 Button; 031 IconButton; 032 Input; 033 PasswordInput; 034 SearchInput; 035 Card; 036 Badge; 037 Avatar; 038 Modal/BottomSheet; 039 EmptyState; 040 LoadingState; 041 ErrorState.

## Epic 4 Database foundation
BF-050 extensions; 051 profiles; 052 businesses; 053 members; 054 settings; 055 hours; 056 clients; 057 services; 058 appointments; 059 appointment_services.

## Epic 5 Commerce DB
BF-060 product_categories; 061 products; 062 sales; 063 sale_items; 064 payments; 065 purchases; 066 purchase_items; 067 stock_movements; 068 expense_categories; 069 expenses.

## Epic 6 Security
BF-070 indexes; 071 enable RLS; 072 membership helpers; BF-073 Business & Membership RLS Policies; BF-074 Clients & Services RLS Policies; BF-075 Appointments RLS Policies; 076-079 policies by domain (individual scopes remain to be defined).

BF-073 includes exactly `profiles`, `businesses`, `business_members`, `business_settings` and `business_hours`. Apply the explicit BF-073 contract in `RLS_MATRIX.md`; no policies on other tables, no business/first-OWNER bootstrap, no new helpers or SECURITY DEFINER functions, and no global grant hardening.

BF-074 includes exactly `clients` and `services`. Apply the explicit BF-074 contract in `RLS_MATRIX.md`: six new authenticated policies, no DELETE, immutable `business_id`, and no policies for future domains or global grant hardening.

BF-075 includes exactly `appointments` and `appointment_services`. Apply the explicit BF-075 contract in `RLS_MATRIX.md`: seven new authenticated policies; OWNER manages business appointments, BARBER only their assigned appointments; parent-derived line authorization, tenant-consistent references and immutable tenant/audit/parent columns. No appointment DELETE, new helpers, state machine, future-domain policies or global grant hardening.

## Epic 7 Seed
BF-080 demo business; 081 owner linkage; 082 services; 083 categories; 084 products; 085 clients.

## Epic 8 Auth
BF-090 repository; 091 service; 092 login schema; 093 form; 094 screen; 095 bootstrap; 096 protected routing; 097 logout; 098 recovery.

## Epic 9 Business context
BF-100 repository; 101 current business service; 102 hook; 103 context/store; 104 settings repo; 105 hours queries.

## Epic 10 Clients
BF-110-121 schemas, repository, service, keys, hooks, list/search/screen/create/detail/edit/stats.

## Epic 11 Services
BF-130-135 schemas, repository, hooks, list, create, edit/archive.

## Epic 12 Appointment domain
BF-140-147 types, schema, repository, service, availability RPC, create RPC, hooks, error mapping.

## Epic 13 Agenda UI
BF-150-157 month/week/day views, cards, tabs, screen, date navigation, detail.

## Epic 14 Create appointment
BF-160-167 client/service selectors, duration, date, slots, notes, form, conflict UX.

## Epic 15 Products
BF-170-176 schema, repo, hooks, list, form, low stock, badge.

## Epic 16 Checkout DB
BF-180-188 complete_checkout design, stock locking, sale/items/payment/movements, appointment completion, idempotency, tests.

## Epic 17 Checkout frontend
BF-190-198 draft/store, service/product items, summary, discount, payment, mutation, success, cache invalidation.

## Epic 18 Direct product sale
BF-200-204 screen, selector, quantity, checkout reuse, no-client support.

## Epic 19 Purchases
BF-210-216 schema, draft, form, complete_purchase RPC, stock, expense, tests.

## Epic 20 Inventory
BF-220-225 repo, stock query, history, adjust RPC, adjustment UI, low-stock alerts.

## Epic 21 Expenses
BF-230-236 schema, repo, hooks, list, form, receipt, generated expense display.

## Epic 22 Analytics DB
BF-240-245 dashboard/revenue/expense/top services/top products/client stats RPCs.

## Epic 23 Finance UI
BF-250-256 period, cards, chart, tabs, screen.

## Epic 24 Home
BF-260-265 KPIs, next appointment, today list, low stock, finance summary, screen.

## Epic 25 Settings
BF-270-276 settings/profile/business/hours/payment methods/notifications/theme.

## Epic 26 Navigation
BF-280-284 bottom tabs, center action, sheet, stack, modals.

## Epic 27 Web
BF-290-295 responsive primitives and desktop Home/Agenda/Clients/Finance/navigation.

## Epic 28 Tests
BF-300-308 conflicts, checkout, inventory, purchase, finance, login E2E, checkout E2E, purchase E2E, insufficient stock E2E.

## Epic 29 Production
BF-310-317 production Supabase/migrations/RLS audit/EAS/web/TestFlight/QA/App Store.

## Initial execution sequence
BF-001 → BF-010 → BF-011 → BF-012 → BF-013 → BF-014 → BF-015 → BF-017 → theme → shared UI → database → security → auth. Do not batch unrelated tickets.

## Official functional sequence

Clients → Services → Agenda / Appointments → Products → Checkout → Purchases / Inventory → Expenses → Finance.

Products (BF-170-176) must precede Checkout (BF-180-198) because checkout depends on the product catalog, prices, costs and stock. Purchases / Inventory (BF-210-225), Expenses (BF-230-236) and Finance (BF-240-256) follow in that order. Existing ticket IDs are unchanged.
