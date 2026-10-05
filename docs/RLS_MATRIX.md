# BarberFlow — RLS Matrix

Version: 1.0  
Status: APPROVED BASELINE

## Helpers

Create safe helper functions such as `is_business_member(business_id)` and `has_business_role(business_id, role)` based on active `business_members`. Avoid recursive-policy traps.

## Matrix

| Resource | OWNER | BARBER future |
|---|---|---|
| Business | Read/Update | Read |
| Business settings/hours | CRUD | Read |
| Members | CRUD | Limited read |
| Clients | Read/Create/Update/Archive | Read/Create/Update |
| Services | Read/Create/Update/Archive | Read |
| Product categories | Read/Create/Update/Archive | Read |
| Expense categories | Read/Create/Update/Archive | No |
| Appointments | Read/Create; Update operational fields/status; Reschedule/Cancel/Mark no-show, all | Same operational actions, own only |
| Appointment services | Read/Create/Update through appointment workflow; preserve historical snapshots | own, through authorized appointment workflow |
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
