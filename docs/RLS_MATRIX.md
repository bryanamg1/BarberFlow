# BarberFlow — RLS Matrix

Version: 1.0  
Status: APPROVED BASELINE

## Helpers

Create safe helper functions such as `is_business_member(business_id)` and `has_business_role(business_id, role)` based on active `business_members`. Avoid recursive-policy traps.

## Matrix

| Resource | OWNER | BARBER future |
|---|---|---|
| Own profile (authenticated, membership not required) | Read/Create/Update own only; NO DELETE | Same own-profile rule |
| Business | Read/Update; NO direct INSERT/DELETE | Read |
| Business settings | Read/Create/Update; NO DELETE | Read |
| Business hours | CRUD | Read |
| Members | Read/Create/Update/Deactivate; NO DELETE | Read memberships in own businesses |
| Clients | Read/Create/Update/Archive; NO DELETE | Read/Create/Update/Archive; NO DELETE |
| Services | Read/Create/Update/Archive; NO DELETE | Read; NO INSERT/UPDATE/DELETE |
| Product categories | Read/Create/Update/Archive | Read |
| Expense categories | Read/Create/Update/Archive | No |
| Appointments | Read/Create/Update all in own businesses; NO DELETE | Read/Create/Update assigned to own active membership only; NO reassignment/DELETE |
| Appointment services | Read/Create/Update/Delete lines of authorized business appointments | Read/Create/Update/Delete lines of own assigned appointments |
| Products | Read/Create/Update/Archive | Read |
| Stock movements | Read; append through authorized stock workflows only | Read |
| Purchases DRAFT | Read/Create/Update through purchase workflow | No |
| Purchases COMPLETED | Read; corrections through explicit void/adjustment workflow; NO direct UPDATE/DELETE | No |
| Manual expenses | Read/Create/Update | No |
| Purchase-generated expenses | Read; corrections through related purchase workflow only | No |
| Sales DRAFT | Read/Create/Update through sale workflow | own/authorized workflow |
| Sales COMPLETED | Read; corrections through `void_sale`; NO direct UPDATE/DELETE | Read own/authorized; correction workflow only when authorized |
| Payments | Read/Create via workflow | own/authorized |
| Global finance analytics | Read | No |
| Client history | Read | Read |

## Principles

### BF-073 — Business & Membership RLS Policies

Approved scope: exactly `profiles`, `businesses`, `business_members`, `business_settings` and `business_hours`. Policies apply only TO authenticated. All other tables remain deny-by-default until their own tickets.

- `profiles`: SELECT/INSERT/UPDATE only where `id = auth.uid()`, with the same UPDATE USING/WITH CHECK condition; no DELETE and no reading other members' profiles. This rule also applies to authenticated users without a business membership.
- `businesses`: SELECT via `is_business_member(id)`; UPDATE USING/WITH CHECK via `has_business_role(id, ARRAY['OWNER'])`; no direct INSERT or DELETE. Initial business/first-OWNER bootstrap belongs to a later secure server-side flow.
- `business_members`: SELECT lists all memberships of businesses where the caller has an active membership, using `is_business_member(business_id)`. INSERT/UPDATE require an active OWNER of that business; INSERT uses WITH CHECK and UPDATE uses both USING and WITH CHECK. BARBER cannot change membership/role/activity. No DELETE; OWNER deactivates through `is_active=false`.
- `business_settings`: active members may SELECT; active OWNER may INSERT/UPDATE, with WITH CHECK on INSERT and USING/WITH CHECK on UPDATE. No DELETE.
- `business_hours`: active members may SELECT; active OWNER may INSERT/UPDATE/DELETE, with USING/WITH CHECK on UPDATE.

Use only the approved BF-072 helpers. Membership activity controls business access; no additional business-is-active condition. Inactive/nonmember identities and anon have no business access. No role hierarchy, self-OWNER bootstrap policy, new SECURITY DEFINER, FORCE RLS, business RPC or global grant hardening. Existing rows cannot be moved between businesses, including when the caller owns both businesses.

### BF-074 — Clients & Services RLS Policies

Approved scope: exactly `clients` and `services`. Add six policies TO authenticated, for a total of 21 public policies including the 15 BF-073 policies. Subsequent domains receive policies only in their own tickets.

- `clients`: active OWNER and BARBER may SELECT/INSERT/UPDATE within their businesses via `public.is_business_member(business_id)`. SELECT uses USING, INSERT uses WITH CHECK, and UPDATE uses both. No DELETE; archive/reactivate through `is_active`.
- `services`: active OWNER and BARBER may SELECT via `public.is_business_member(business_id)`. Only active OWNER may INSERT/UPDATE via `public.has_business_role(business_id, ARRAY['OWNER'])`, using WITH CHECK on INSERT and USING/WITH CHECK on UPDATE. No DELETE; OWNER archives/reactivates through `is_active`.
- Inactive clients/services remain visible to active members and editable according to the same role rules. Record `is_active` is not an RLS condition; availability filtering belongs to application queries.
- Inactive memberships, authenticated users without membership, and anon have no access to either table. Revoking a membership removes access on subsequent statements.
- `authenticated` cannot UPDATE `business_id`, including callers active in both businesses; preserve UPDATE privileges on every other existing column using the BF-073 column-grant pattern. No cross-business row transfers.

Reuse BF-072 helpers without changes. No new helpers, SECURITY DEFINER, RPC, business logic, FORCE RLS, future-domain policies or global grant hardening; service_role and the inherited TRUNCATE/REFERENCES/TRIGGER/MAINTAIN debt remain unchanged.

### BF-075 — Appointments RLS Policies

Approved scope: exactly `appointments` and `appointment_services`. BF-075 added seven policies TO authenticated, bringing its baseline to exactly 28 public policies including BF-073/BF-074. Inventory subsequently opens only under BF-076 below; BF-077–079 remain unspecified.

- `appointments`: active OWNER may SELECT/INSERT/UPDATE all appointments of that business. Active BARBER may SELECT/INSERT/UPDATE only appointments assigned to their own membership. Match `barber_member_id` to `business_members.id`, `user_id = auth.uid()`, the appointment business and active BARBER membership; use `has_business_role(business_id, ARRAY['OWNER'])` for OWNER. UPDATE requires authorization both before and after the change, preventing BARBER reassignment or taking another barber's appointment.
- INSERT requires `created_by = auth.uid()`. INSERT/UPDATE require the referenced client and assigned member to belong to the same business. OWNER may assign/reassign any member of that business, including inactive members, preserving historical access; the caller's membership must be active. Archived clients do not invalidate tenant consistency.
- `authenticated` cannot UPDATE `appointments.business_id` or `appointments.created_by`; preserve every other existing column's UPDATE privilege. No appointment DELETE policy. Valid status CHECKs remain unchanged; no state-transition, conflict, availability or business-hours rules are implemented by RLS.
- `appointment_services`: SELECT inherits parent visibility. INSERT/UPDATE/DELETE independently require OWNER of the parent business or its assigned active BARBER, in addition to the parent RLS check; visibility alone does not grant writes. INSERT/UPDATE accept nullable `service_id`; when present, the service must belong to the parent's business, without requiring catalog activity.
- `authenticated` cannot UPDATE `appointment_services.appointment_id`; preserve every other existing column's UPDATE privilege. Authorized editors may change line snapshots and remove lines. BF-075 adds no status-based snapshot immutability; catalog changes still never rewrite snapshots automatically. Deleting a line never deletes its appointment.
- Inactive memberships and authenticated users without membership have no appointment/line access; reactivation restores access according to the current role and assignment. Anon remains blocked. Even an OWNER of both businesses cannot transfer an appointment, spoof its creator or attach a client/member/service from the other tenant.

Reuse unchanged BF-072 helpers and BF-073 membership visibility; no new helper, SECURITY DEFINER, RPC, redundant business_id, FORCE RLS or global grant hardening. The inherited TRUNCATE/REFERENCES/TRIGGER/MAINTAIN debt and service_role privileges remain unchanged.

### BF-076 — Inventory RLS Policies

Approved scope: exactly `product_categories`, `products` and `stock_movements`. Add seven policies TO authenticated, for exactly 35 public policies including the unchanged 28 BF-073/BF-074/BF-075 policies. BF-077–079 remain unspecified; `sales`, `sale_items`, `payments`, `purchases`, `purchase_items`, `expense_categories` and `expenses` still have no policies.

- `product_categories`: active OWNER and BARBER may SELECT via `public.is_business_member(business_id)`. Only active OWNER may INSERT/UPDATE via `public.has_business_role(business_id, ARRAY['OWNER'])`; INSERT uses WITH CHECK, UPDATE uses both USING and WITH CHECK. No DELETE policy; OWNER archives/reactivates through `is_active`.
- `products`: the same member SELECT and OWNER INSERT/UPDATE rules. INSERT/UPDATE additionally require `category_id IS NULL` or a category with the same `business_id` as the product. The category may be archived. This tenant correlation applies even to OWNER of both businesses. No DELETE policy; OWNER archives/reactivates through `is_active`.
- Archived categories/products remain visible and editable according to the same roles. Neither record nor category `is_active` filters RLS; availability filtering belongs to application queries.
- `authenticated` cannot UPDATE either catalog's `business_id`, including OWNER active in both tenants. Revoke table-level UPDATE and preserve UPDATE on every other existing column, following BF-073–BF-075.
- `stock_movements`: active OWNER and BARBER may SELECT via `public.is_business_member(business_id)`, without filtering PURCHASE/SALE/LOSS/ADJUSTMENT/RETURN. No client INSERT/UPDATE/DELETE policies; even OWNER cannot write the ledger directly. Future authorized checkout, purchase, adjustment and return workflows create movements; no such RPC is added here.
- Inactive memberships, authenticated users without membership and anon have no access. Revocation removes access on subsequent statements; reactivation restores the scope of the current role.

Reuse BF-072 helpers unchanged. Keep the existing append-only trigger, derived stock as `SUM(quantity_delta)`, all 19 RLS tables with FORCE off and service_role privileges unchanged. No new SECURITY DEFINER, function, trigger, persisted balance, future-domain policy or global grant hardening. The inherited TRUNCATE/REFERENCES/TRIGGER/MAINTAIN grants remain separate security debt; RLS does not protect TRUNCATE.

### BF-077 — Sales & Payments RLS Policies

Approved scope: exactly `sales`, `sale_items` and `payments`. Add three SELECT policies TO authenticated, for exactly 38 public policies. The prior 35 policies remain unchanged. BF-078–079 remain unspecified; `purchases`, `purchase_items`, `expense_categories` and `expenses` still have no policies. Earlier ticket counts above describe their historical baselines.

- `sales_select_authorized`: active OWNER reads all sales of their OWNER businesses; active BARBER reads only sales with `created_by = auth.uid()` in their BARBER businesses. DRAFT, COMPLETED and VOIDED have the same read authorization. Client/appointment relationships do not grant access to someone else's sale.
- `sale_items_select_authorized`: derive business and creator from the parent sale. Require both the matching parent ID and the explicit OWNER/BARBER predicate used for sales. No redundant business_id or independent creator is added to sale_items.
- `payments_select_authorized`: active OWNER reads business payments; active BARBER reads only payments they created in their BARBER businesses. Require the referenced sale's business_id to equal the payment's business_id, including for OWNER of both businesses. A BARBER's own payment remains visible even when another user created its parent sale; that sale and its lines remain hidden unless separately authorized.
- Approved exception to the original no-new-helper restriction: create only the unexposed schema `private` and `private.can_read_payment(uuid)`. The boolean, read-only, STABLE SECURITY DEFINER helper accepts only a payment ID; it reads persisted payment/sale fields, derives identity from auth.uid(), checks the caller's payment authorization and tenant consistency internally, and returns false for unknown/NULL/unauthorized/inactive cases. It has an empty search_path, schema-qualified references, no dynamic SQL and no arbitrary user_id argument. Creation and ACL restrictions are atomic. EXECUTE is granted only to authenticated (apart from inherent owner authority); PUBLIC, anon and service_role cannot execute it. Authenticated has USAGE but no CREATE on private. Do not expose private through the API or extra_search_path; there is no business RPC/API endpoint.
- No INSERT, UPDATE or DELETE policies on any of the three tables, including OWNER and every sale status. Checkout and corrections belong to future transactional workflows. Preserve immutable historical snapshots by denying direct client writes.
- Active membership is mandatory even for own-created rows. Revocation removes access on subsequent statements; reactivation restores only the current role's scope. OWNER/BARBER multi-business access applies independently per business. Anon, inactive users and users without membership remain blocked.

Keep both BF-072 helpers and the four public functions unchanged; BF-077 adds exactly one private function (three SECURITY DEFINER functions across public/private in total). No table/column/index/trigger changes, FORCE RLS, existing service_role/table grant changes, global grant hardening or policies outside scope. The inherited TRUNCATE/REFERENCES/TRIGGER/MAINTAIN debt remains separate; RLS does not protect TRUNCATE. The helper reads a statement snapshot and does not cache authorization across statements. Its bypass of parent RLS is limited to deciding whether the caller can read that payment; it does not return sale data.

### BF-078 — Purchases RLS Policies

Approved scope: exactly `purchases` and `purchase_items`. Add two SELECT policies TO authenticated, for exactly 40 public policies; the previous 38 policies remain unchanged. `expense_categories` and `expenses` still have no policies. BF-079 remains undefined; earlier sections describe their historical ticket baselines.

- `purchases_select_owners`: active OWNER reads purchases of their OWNER businesses via `public.has_business_role(business_id, ARRAY['OWNER'])`. BARBER cannot read purchases, including records they created, regardless of generic membership, product access or known IDs. Supplier, costs and acquisition history remain OWNER-only.
- `purchase_items_select_owners`: require a parent purchase whose ID matches `purchase_id` and explicitly require active OWNER of that parent's business. Product business/visibility never grants access to a purchase line; no redundant business_id or new cross-business write validation is added.
- No INSERT, UPDATE or DELETE policies for either table, including OWNER and all DRAFT/COMPLETED/VOIDED records. Supplier, totals, operation_id, creator, status, timestamps and historical line snapshots cannot be edited directly by clients. Future transactional completion/correction workflows own writes; no complete_purchase, stock movement, generated expense or product cost update is implemented here.
- OWNER A/B are isolated; OWNER AB may read both authorized businesses but cannot write directly. Inactive membership removes access on subsequent statements; reactivation restores only current OWNER scope. BARBER, users without membership and anon have no access. Status does not change RLS authorization.

Reuse BF-072 helpers and `private.can_read_payment(uuid)` unchanged. Preserve idempotency UNIQUE(business_id, operation_id), all schema/FKs/indexes/triggers, service_role and existing grants. No new helper, SECURITY DEFINER, FORCE RLS or future-domain policy. The inherited TRUNCATE/REFERENCES/TRIGGER/MAINTAIN debt remains separate; RLS does not protect TRUNCATE.

Every business-owned table enables RLS. Frontend filters are not authorization. INSERT/UPDATE must validate membership with WITH CHECK. Global finance/purchase/expense operations require OWNER. Critical RPCs verify auth and role independently. The service-role key never reaches Expo/Web clients.

Prefer restricting direct writes that could bypass critical invariants such as completed sale creation, checkout stock movements and purchase-generated expenses.

## Historical mutability limits

These limits apply in addition to role permissions; OWNER access does not bypass them. This is a documentation contract, not an implemented SQL policy.

- Configurable clients, services, products and categories permit Read/Create/Update/Archive. NO physical DELETE when associated history exists.
- Appointments permit Read/Create, Update operational fields/status, Reschedule, Cancel and Mark no-show. NO physical delete of historical appointments. Changes must preserve historical service snapshots and use the authorized appointment workflow.
- COMPLETED sales permit Read, NO direct UPDATE and NO direct DELETE. Corrections occur through the explicit `void_sale` workflow, with compensating RETURN movements where applicable; historical sale items remain preserved.
- COMPLETED purchases permit Read, NO direct UPDATE and NO direct DELETE. Corrections require an explicit void/adjustment workflow that preserves history and handles related stock and generated expenses consistently.
- `stock_movements` is append-only: once created, NO UPDATE and NO DELETE. Corrections create compensating movements. Direct inserts must not bypass the authorized checkout, purchase or stock adjustment workflows.
- Purchase-generated expenses cannot be independently edited/deleted to bypass the related purchase correction workflow. Completed financial records must not be rewritten through their child records or related workflows.

### BF-079 — Expenses RLS Policies

Approved scope: exactly `expense_categories` and `expenses`. Six policies TO authenticated, for exactly 46 public policies. The previous 40 policies remain unchanged; all 19 public tables now have policies. Earlier sections retain their historical ticket baselines.

- `expense_categories_select_owners`, `expense_categories_insert_owners`, `expense_categories_update_owners`: active OWNER only via `public.has_business_role(business_id, ARRAY['OWNER'])`; INSERT WITH CHECK, UPDATE USING and WITH CHECK. Archived categories remain visible/editable. No DELETE; archive through `is_active`. Authenticated cannot UPDATE `business_id`, even OWNER AB; preserve every other existing category column's UPDATE privilege.
- `expenses_select_owners`: active OWNER only, and category must belong to the expense business. PURCHASE also requires its referenced purchase to belong to that same business. Privileged/legacy inconsistent references are hidden even from OWNER AB. Category activity and expense creator do not restrict OWNER reads.
- `expenses_insert_manual_owners`: active OWNER, `source_type = 'MANUAL'`, `purchase_id IS NULL`, same-business category (including archived) and `created_by = auth.uid()`.
- `expenses_update_manual_owners`: any active OWNER of the expense business can edit MANUAL expenses, independently of original creator. USING and WITH CHECK require OWNER/MANUAL/NULL purchase; WITH CHECK additionally requires the same-business category. Exactly seven fields are directly editable: `category_id`, `description`, `amount`, `payment_method`, `expense_date`, `receipt_path`, `notes`.
- Direct authenticated UPDATE cannot change `id`, `business_id`, `source_type`, `purchase_id`, `created_by`, `created_at` or `updated_at`, enforced with column grants. The existing timestamp trigger continues managing `updated_at`. No PURCHASE INSERT/UPDATE, and no expense DELETE.
- BARBER has no access, even for own-created expenses. Inactive membership, nonmember and anon are blocked. Revocation removes access on subsequent statements and reactivation restores current OWNER scope.

Reuse BF-072 helpers and `private.can_read_payment` unchanged; no new SECURITY DEFINER, helper, schema/CHECK/index/trigger change, purchase completion, automatic expense, Storage policy, frontend change or dependency upgrade. FORCE remains off in all 19 tables. Preserve service_role and all unrelated grants, including inherited TRUNCATE/REFERENCES/TRIGGER/MAINTAIN debt; RLS does not protect TRUNCATE.
