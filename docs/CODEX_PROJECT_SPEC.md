# BarberFlow — Codex Project Specification

Version: 1.0
Status: APPROVED FOR DEVELOPMENT
Primary language: TypeScript
Application: React Native / Expo / Web

---

# 1. Product vision

BarberFlow is a mobile-first management platform for barbers and hair professionals.

Its purpose is to centralize:

- appointment scheduling;
- client management;
- services;
- payments;
- income and expenses;
- product sales;
- refrigerator/snack inventory;
- merchandise purchases;
- financial analytics;
- business configuration.

The initial production version is intended for one barber/owner, but the architecture MUST support multiple business members in the future without requiring a major redesign.

---

# 2. Target platforms

V1 production targets:

- iOS;
- Web.

The application architecture must remain compatible with Android.

Use a shared codebase whenever reasonable.

---

# 3. Technology stack

Frontend:

- React Native
- Expo
- TypeScript
- Expo Router
- React Native Web

Backend:

- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Storage
- Row Level Security

Client data:

- TanStack Query

Local/global UI state:

- Zustand

Forms:

- React Hook Form
- Zod

Dates:

- date-fns

Testing:

- Jest
- React Native Testing Library
- Maestro for critical E2E flows

---

# 4. Architecture principles

Use a feature-based architecture.

Expected dependency direction:

Screen
→ Feature hook
→ Domain/service layer
→ Repository
→ Supabase

React components MUST NOT contain:

- SQL queries;
- accounting rules;
- inventory calculations;
- large data transformation logic;
- direct business rules.

Business logic belongs inside domain/services.

Database interaction belongs inside repositories.

---

# 5. Project structure

app/
src/
  components/
  features/
  lib/
  hooks/
  schemas/
  store/
  utils/
  constants/
  theme/
  types/

supabase/
  migrations/
  seed.sql

tests/
docs/

---

# 6. Core modules

- Authentication
- Business
- Clients
- Services
- Appointments
- Sales
- Payments
- Products
- Inventory
- Purchases
- Expenses
- Analytics
- Settings

---

# 7. Authentication

V1 supports:

- email login;
- password;
- password recovery;
- persistent session;
- logout.

Public registration is not required for the first private release.

All app routes except authentication routes must require a valid session.

---

# 8. Business model

Main hierarchy:

User
→ Business Membership
→ Business

Business resources include:

- clients;
- services;
- appointments;
- sales;
- products;
- inventory;
- purchases;
- expenses.

Do not directly bind business records to the authenticated user if business ownership/membership is the correct relationship.

---

# 9. Business roles

Prepare the architecture for:

OWNER
BARBER

V1 UI only requires OWNER functionality.

Future roles must not require changing primary ownership relationships.

---

# 10. Appointment lifecycle

Supported status values:

PENDING
CONFIRMED
IN_PROGRESS
COMPLETED
CANCELLED
NO_SHOW

Appointments may contain multiple services.

Appointments must have:

- client;
- barber/member;
- start timestamp;
- end timestamp;
- status;
- optional notes.

The application must detect conflicting appointments.

---

# 11. Services

Services contain:

- name;
- description;
- current price;
- duration;
- active flag.

Changing a service price MUST NOT modify historical sales.

Historical transactions use snapshots.

---

# 12. Checkout architecture

All final transactions use a Sale entity.

A Sale may contain:

SERVICE items
and/or
PRODUCT items.

Example:

Haircut        15000
Beard           5000
Coca-Cola       2500
Snack           2000

TOTAL          24500

A sale may optionally reference:

- appointment;
- client.

Direct product sales without appointments must also be supported.

---

# 13. Sale items

Each sale item must snapshot:

- item type;
- item name;
- quantity;
- unit selling price;
- unit cost when relevant;
- line total.

Historical transactions MUST NOT depend on current service/product pricing.

---

# 14. Payments

Payments reference a sale.

Supported initial methods:

CASH
TRANSFER
DEBIT
CREDIT
OTHER

Architecture should permit multiple payments for one sale even if the initial UI only exposes a simpler payment flow.

---

# 15. Products

Products support:

- name;
- category;
- purchase cost;
- sale price;
- active state;
- minimum stock.

Examples:

- Coca-Cola;
- water;
- energy drinks;
- snacks;
- candy.

Products are part of the business inventory system.

---

# 16. Inventory

Inventory changes MUST be traceable.

Stock movement types:

PURCHASE
SALE
LOSS
ADJUSTMENT
RETURN

Each movement includes:

- product;
- signed quantity delta;
- optional unit cost;
- reference type;
- reference id;
- timestamp;
- notes when applicable.

Never silently mutate inventory without generating a corresponding movement.

---

# 17. Merchandise purchases

A purchase can contain multiple purchase items.

Confirming a purchase must:

1. create the purchase;
2. create purchase items;
3. create inventory PURCHASE movements;
4. generate the corresponding business expense.

The user must not need to manually record the same purchase as an expense.

---

# 18. Expenses

Expenses support:

- category;
- description;
- amount;
- date;
- payment method;
- notes;
- optional receipt.

Expenses may originate from:

MANUAL
PURCHASE

Avoid duplicated accounting records.

---

# 19. Clients

Client profiles include:

- first name;
- last name;
- phone;
- email;
- Instagram;
- birthday;
- notes;
- preferences.

Client profile analytics should derive from real appointments and sales whenever possible.

Do not store easily derivable counters unless justified by performance requirements.

---

# 20. Finance dashboard

Support filters:

TODAY
WEEK
MONTH
YEAR
ALL_TIME

Display:

- total revenue;
- service revenue;
- product revenue;
- expenses;
- merchandise purchases;
- profit;
- appointments;
- clients;
- average ticket;
- products sold;
- cancellations;
- no-shows.

Do not create daily/monthly aggregate columns in normal business tables.

Prefer queries, SQL views, or RPC functions.

---

# 21. Date and timezone rules

Database timestamps use timestamptz.

Store the business timezone separately.

Default initial timezone:

America/Argentina/Buenos_Aires

Never implement appointment logic using device-local time assumptions alone.

---

# 22. Security

Row Level Security is mandatory.

Users may access business data only when a valid business_members record authorizes access.

Frontend filtering is NOT considered a security mechanism.

Never expose Supabase service-role credentials in the application.

---

# 23. Storage

Expected buckets:

avatars
client-photos
receipts
business-assets

Use private buckets where appropriate.

Use signed URLs for private files.

---

# 24. UI direction

Approved visual direction:

Premium dark barber-shop UI.

Main characteristics:

- very dark navy/black backgrounds;
- cyan/turquoise accent;
- rounded elevated cards;
- thin borders;
- restrained glow;
- clean typography;
- high information density without clutter.

The approved concept image is the visual reference.

Do not redesign the application into a light generic SaaS interface.

---

# 25. Main navigation

Primary mobile tabs:

Home
Agenda
Quick Action
Clients
Finances

Quick Action menu:

- New appointment
- New client
- New sale
- New expense
- Merchandise purchase

---

# 26. Main screens

Authentication:
- Login
- Forgot password

Home:
- KPIs
- today's appointments
- next appointment
- low stock alerts

Agenda:
- Day
- Week
- Month

Appointments:
- Create
- Detail
- Edit
- Reschedule
- Cancel
- Complete

Clients:
- List
- Search
- Create
- Detail
- Edit

Finances:
- Overview
- Services
- Products
- Expenses

Products:
- Catalog
- Product detail
- Create/edit
- Stock adjustment
- Purchase
- Direct sale

Settings:
- User profile
- Business
- Opening hours
- Services
- Products
- Payment methods
- Notifications
- Appearance
- Logout

---

# 27. State management rules

TanStack Query owns server state.

Zustand must only hold justified app/client state such as:

- current business;
- checkout draft;
- temporary UI filters;
- app preferences.

Do not duplicate server records into Zustand unnecessarily.

---

# 28. Forms and validation

Use React Hook Form + Zod.

Schemas should be reusable across screens and services.

Never rely exclusively on client-side validation.

Database constraints must protect critical invariants.

---

# 29. Error handling

User-facing errors must be understandable.

Technical details must not leak directly to users.

Async screens must define:

- loading state;
- empty state;
- error state;
- success state where necessary.

---

# 30. Database migrations

All database changes must be version-controlled migrations.

Never rely on undocumented manual production database changes.

Migration changes must include:

- schema;
- constraints;
- indexes;
- RLS;
- policies when necessary.

---

# 31. Testing strategy

Unit test:

- calculations;
- schemas;
- finance helpers;
- inventory rules;
- date helpers.

Integration test:

- repositories;
- domain services;
- checkout behavior.

Critical E2E:

Login
→ create client
→ create appointment
→ add service
→ add product
→ checkout
→ verify inventory
→ verify financial result.

---

# 32. Performance principles

Avoid premature optimization.

However:

- indexes must support frequent appointment/date queries;
- lists must paginate where needed;
- images must be optimized;
- dashboard queries should avoid unnecessary N+1 queries.

Analytics may migrate to SQL views/RPC as complexity increases.

---

# 33. Accessibility

Interactive controls must have:

- appropriate touch targets;
- readable contrast;
- semantic labels;
- accessible screen reader names.

Color alone must not communicate critical states.

---

# 34. Git workflow

Protected branches:

main
develop

`main` represents stable state. `develop` is the development base. Every new ticket branches from `develop` into its own task branch.

Required branch format: `bryan/<type>/<short-task-name>`.

Branch examples:

bryan/feat/appointments-calendar
bryan/feat/products-inventory
bryan/fix/checkout-stock
bryan/chore/expo-bootstrap

BF-010 must branch from `develop` as `bryan/chore/expo-bootstrap`. Creating that branch or starting BF-010 is outside BF-001.

Commits should be small, scoped and descriptive.

Do not mix unrelated refactors with feature work.

---

# 35. Codex operating rules

Before modifying code:

1. inspect the relevant existing implementation;
2. identify impacted modules;
3. preserve established architecture;
4. propose the smallest coherent change.

Do not rewrite working modules without justification.

Do not introduce a new dependency when the project already has an adequate solution.

Do not make speculative changes outside task scope.

For substantial tasks, explicitly reason using:

Persona
Task
Context

Every Codex completion must finish with exactly one section:

"Siguiente paso recomendado:"

containing the concrete next action.

---

# 36. Definition of Done

A task is not complete merely because code compiles.

A feature is Done when:

- functional requirement is implemented;
- TypeScript passes;
- lint passes;
- relevant tests pass;
- loading/error/empty states are handled;
- mobile layout works;
- web layout is not broken;
- accessibility basics are covered;
- security implications are reviewed;
- database changes include migrations and policies;
- documentation is updated when behavior or architecture changes.

---

# 37. Development phases

Phase 0
Product specification

Phase 1
Expo bootstrap

Phase 2
Design system

Phase 3
Supabase foundation

Phase 4
Authentication

Phase 5
Business configuration

Phase 6
Clients

Phase 7
Services

Phase 8
Appointments

Phase 9
Products

Phase 10
Checkout / payments

Phase 11
Inventory / purchases

Phase 12
Expenses

Phase 13
Analytics

Phase 14
Testing

Phase 15
Web polish

Phase 16
Release

---

# 38. Non-goals for V1

Do NOT implement yet unless explicitly added to scope:

- public customer booking portal;
- multiple branches;
- payroll;
- barber commissions;
- public SaaS signup;
- subscriptions;
- WhatsApp automation;
- advanced CRM automation;
- accounting integrations;
- fiscal invoicing;
- loyalty points.

Architecture may prepare for these features but must not increase V1 complexity unnecessarily.

---

# 39. Product principle

The owner should never have to enter the same business transaction twice.

Examples:

Completing checkout automatically updates revenue.

Selling a product automatically updates inventory.

Registering merchandise purchase automatically creates inventory movement and expense.

Completing an appointment automatically updates client history.

Prefer derived information over duplicated mutable state.

---

# 40. Current project status

Product requirements: COMPLETE  
Visual concept: APPROVED  
UX architecture: COMPLETE  
Frontend architecture: COMPLETE  
Database model: COMPLETE  
Business rules: COMPLETE  
Checkout model: COMPLETE  
Inventory model: COMPLETE  
RPC contracts: COMPLETE  
RLS baseline: COMPLETE  
Design system: COMPLETE  
Error contract: COMPLETE  
Architecture ADRs: COMPLETE  
Technical backlog: COMPLETE  
Coding: NOT STARTED

Next milestone: documentation bootstrap and Expo project bootstrap.

---

# 41. Protected architecture decisions

The following decisions are protected and MUST NOT be changed silently:

- feature-first frontend architecture;
- Supabase/PostgreSQL backend;
- business-centric tenancy using `business_members`;
- mandatory Row Level Security;
- unified `sales` + `sale_items` checkout model;
- inventory ledger via `stock_movements`;
- server-side transactional checkout;
- historical snapshots for prices, names, costs and durations;
- TanStack Query for server state;
- Zustand only for justified client/UI state;
- no negative inventory in V1;
- `timestamptz` for stored timestamps;
- one currency per business in V1;
- soft archive for historical entities.

If a task appears to require changing one of these decisions, STOP implementation and identify the ADR affected, explain the reason, propose the alternative, analyze impact, and wait for approval.

---

# 42. Database baseline

Primary entities:

- `profiles`
- `businesses`
- `business_members`
- `business_settings`
- `business_hours`
- `clients`
- `services`
- `appointments`
- `appointment_services`
- `product_categories`
- `products`
- `sales`
- `sale_items`
- `payments`
- `purchases`
- `purchase_items`
- `stock_movements`
- `expense_categories`
- `expenses`

Rules:

- main IDs use UUID;
- timestamps use `timestamptz`;
- money uses fixed numeric types such as `numeric(12,2)`;
- inventory is derived from `stock_movements`;
- sales and purchases use `operation_id` for idempotency;
- historical transactions use snapshots;
- configurable historical entities use `is_active` instead of destructive deletion where appropriate.

See `DATABASE_SCHEMA.md` for exact fields and constraints.

---

# 43. Appointment rules

Two active appointments for the same barber conflict when:

`new_start < existing_end AND new_end > existing_start`

Conflict statuses:

- PENDING
- CONFIRMED
- IN_PROGRESS

Ignored:

- CANCELLED
- NO_SHOW

V1 does not allow appointments outside business hours or on closed days. Availability shown in UI is advisory and MUST be revalidated server-side when creating or rescheduling.

---

# 44. Checkout rules

All final business transactions use a unified Sale model. A sale may contain service and product items together. Direct product sales are supported without appointment or client.

Checkout MUST execute transactionally server-side. Conceptually:

1. validate authenticated user and business membership;
2. enforce idempotency;
3. validate appointment if provided;
4. validate service/product items;
5. lock/revalidate stock;
6. calculate authoritative totals;
7. create sale;
8. create sale item snapshots;
9. create payment;
10. create SALE inventory movements;
11. mark sale completed;
12. mark appointment completed if applicable;
13. commit.

The frontend MUST NOT coordinate these as independent mutations.

V1 supports a global sale discount: `total = subtotal - discount_amount`, with `0 <= discount_amount <= subtotal`. If subtotal is zero, discount_amount must be zero. Financial analytics allocate the discount proportionally as defined in section 46; per-line discount persistence is not required in V1.

COMPLETED sales permit read access but NO direct UPDATE or DELETE. Corrections occur only through the explicit `void_sale` workflow, with compensating RETURN stock movements where applicable; analytics excludes VOIDED sales.

---

# 45. Inventory and purchase rules

Every stock change MUST create a `stock_movements` row. Movement types:

- PURCHASE
- SALE
- LOSS
- ADJUSTMENT
- RETURN

Current stock derives from `SUM(quantity_delta)`. V1 forbids negative stock.

`stock_movements` is append-only: once created, a movement permits NO UPDATE or DELETE. Corrections create compensating movements instead of rewriting the ledger.

Completing a merchandise purchase MUST atomically:

1. create purchase;
2. create purchase items;
3. create PURCHASE stock movements;
4. create corresponding business expense;
5. update current default purchase cost;
6. mark purchase completed.

Do not ask the user to record the same purchase expense twice.

COMPLETED purchases permit read access but NO direct UPDATE or DELETE. Corrections require an explicit void/adjustment workflow that preserves history and handles related stock movements and the generated expense consistently.

---

# 46. Financial rules

Revenue source of truth is completed sales, not completed appointments.

- Net service revenue = gross completed SERVICE sale item totals minus their allocated global discount.
- Net product revenue = gross completed PRODUCT sale item totals minus their allocated global discount.
- Product COGS = product `unit_cost_snapshot × quantity`.
- Product gross profit = net product revenue - product COGS.
- Average ticket = SUM(completed sale.total) / completed sales count.
- Simple business result = SUM(completed sale.total) - recorded expenses.

For each completed sale, allocate the global discount proportionally to each eligible line's gross subtotal: `line_discount = sale.discount_amount * gross_line_subtotal / sale.subtotal`. Positive-subtotal SERVICE and PRODUCT lines are eligible; zero-subtotal lines receive zero discount. Gross line totals and snapshots remain unchanged.

Round allocations to the persisted monetary precision in a stable line order. Assign any rounding difference to the last eligible line so that `SUM(line_discount) = sale.discount_amount` exactly. If subtotal is zero, discount_amount must be zero; discount_amount must never exceed subtotal.

Always enforce `net service revenue + net product revenue = sale.total`. For subtotal 20,000 (services 15,000, products 5,000) and global discount 2,000, allocated discounts are 1,500 and 500, producing net revenues 13,500 and 4,500 and sale.total 18,000.

V1 does not require storing per-line discount allocations. Queries/analytics RPCs may derive them from historical sale item snapshots without changing the `sales` / `sale_items` model. See `BUSINESS_RULES.md`, Finance.

Do not call the simple business result formal fiscal/accounting net profit.

---

# 47. RPC baseline

Critical RPCs:

- `complete_checkout`
- `complete_purchase`
- `create_appointment_with_services`
- `get_availability`
- `adjust_stock`

Analytics RPCs may include:

- `get_dashboard_summary`
- `get_revenue_by_day`
- `get_expense_summary`
- `get_top_services`
- `get_top_products`
- `get_client_stats`
- `get_low_stock_products`

See `RPC_CONTRACTS.md`.

---

# 48. RLS baseline

RLS is mandatory for business-owned data. Authorization derives from active `business_members` membership. OWNER is the only role exposed by V1 UI, but policies MUST remain compatible with future BARBER support.

Financial analytics, purchases and global expenses are OWNER-only. Hiding UI is not authorization.

Clients, services, products and categories use Read/Create/Update/Archive permissions; physical DELETE is forbidden when associated history exists. Appointment permissions are Read/Create, update operational fields/status, Reschedule, Cancel and Mark no-show; historical appointments must not be physically deleted.

COMPLETED sales and purchases permit NO direct UPDATE or DELETE; corrections require their explicit workflows. `stock_movements` is append-only with NO UPDATE or DELETE after creation. Role authorization never overrides these historical mutability limits. Purchase-generated expenses may only be corrected through the related purchase workflow.

See `RLS_MATRIX.md`.

---

# 49. Frontend architecture baseline

Use feature-first architecture. Dependency direction:

Screen → Feature UI → Feature Hook → Domain Service → Repository → Supabase

Feature-specific components remain inside their feature. Globally reusable primitives belong in `src/components/ui`. TanStack Query owns server state. Zustand is restricted to justified client/UI state such as checkout draft, purchase draft and temporary filters.

See `FRONTEND_ARCHITECTURE.md`.

---

# 50. Design system baseline

Approved visual direction: premium dark barber-shop UI with cyan/turquoise primary accent and restrained gold secondary accent.

Primary tokens are defined in `DESIGN_SYSTEM.md`.

---

# 51. Error contract

The application uses normalized domain errors. UI MUST NOT display raw SQL/Postgres/Supabase messages.

Key codes include:

- `APPOINTMENT_CONFLICT`
- `APPOINTMENT_OUTSIDE_BUSINESS_HOURS`
- `INSUFFICIENT_STOCK`
- `INVALID_DISCOUNT`
- `CHECKOUT_FAILED`
- `DUPLICATE_OPERATION`
- `BUSINESS_ACCESS_DENIED`

See `ERROR_CONTRACT.md`.

---

# 52. Required companion documents

Codex MUST treat these as part of the specification:

- `docs/FRONTEND_ARCHITECTURE.md`
- `docs/DATABASE_SCHEMA.md`
- `docs/BUSINESS_RULES.md`
- `docs/RPC_CONTRACTS.md`
- `docs/RLS_MATRIX.md`
- `docs/DESIGN_SYSTEM.md`
- `docs/ERROR_CONTRACT.md`
- `docs/BACKLOG.md`
- `docs/adr/*.md`

When documents conflict, this file plus accepted ADRs take precedence unless a later explicitly approved revision says otherwise.

---

# 53. Development order

1. documentation / repository rules;
2. Expo bootstrap;
3. Expo Router;
4. tooling / aliases / lint / env;
5. design tokens and shared UI;
6. Supabase foundation;
7. database migrations and RLS;
8. authentication;
9. business context;
10. clients;
11. services;
12. appointments / agenda;
13. products;
14. transactional checkout;
15. purchases / inventory;
16. expenses;
17. analytics / finance;
18. web polish;
19. E2E and release hardening.

Official functional sequence: Clients → Services → Agenda / Appointments → Products → Checkout → Purchases / Inventory → Expenses → Finance. Products must precede Checkout because checkout depends on the product catalog, prices, costs and stock. Existing ticket IDs remain unchanged.
