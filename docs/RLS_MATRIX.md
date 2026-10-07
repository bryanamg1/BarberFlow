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

Approved scope: exactly `appointments` and `appointment_services`. Add seven policies TO authenticated, for exactly 28 public policies including BF-073/BF-074. BF-076–079 remain unspecified and their ten tables remain without policies.

- `appointments`: active OWNER may SELECT/INSERT/UPDATE all appointments of that business. Active BARBER may SELECT/INSERT/UPDATE only appointments assigned to their own membership. Match `barber_member_id` to `business_members.id`, `user_id = auth.uid()`, the appointment business and active BARBER membership; use `has_business_role(business_id, ARRAY['OWNER'])` for OWNER. UPDATE requires authorization both before and after the change, preventing BARBER reassignment or taking another barber's appointment.
- INSERT requires `created_by = auth.uid()`. INSERT/UPDATE require the referenced client and assigned member to belong to the same business. OWNER may assign/reassign any member of that business, including inactive members, preserving historical access; the caller's membership must be active. Archived clients do not invalidate tenant consistency.
- `authenticated` cannot UPDATE `appointments.business_id` or `appointments.created_by`; preserve every other existing column's UPDATE privilege. No appointment DELETE policy. Valid status CHECKs remain unchanged; no state-transition, conflict, availability or business-hours rules are implemented by RLS.
- `appointment_services`: SELECT inherits parent visibility. INSERT/UPDATE/DELETE independently require OWNER of the parent business or its assigned active BARBER, in addition to the parent RLS check; visibility alone does not grant writes. INSERT/UPDATE accept nullable `service_id`; when present, the service must belong to the parent's business, without requiring catalog activity.
- `authenticated` cannot UPDATE `appointment_services.appointment_id`; preserve every other existing column's UPDATE privilege. Authorized editors may change line snapshots and remove lines. BF-075 adds no status-based snapshot immutability; catalog changes still never rewrite snapshots automatically. Deleting a line never deletes its appointment.
- Inactive memberships and authenticated users without membership have no appointment/line access; reactivation restores access according to the current role and assignment. Anon remains blocked. Even an OWNER of both businesses cannot transfer an appointment, spoof its creator or attach a client/member/service from the other tenant.

Reuse unchanged BF-072 helpers and BF-073 membership visibility; no new helper, SECURITY DEFINER, RPC, redundant business_id, FORCE RLS or global grant hardening. The inherited TRUNCATE/REFERENCES/TRIGGER/MAINTAIN debt and service_role privileges remain unchanged.

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
