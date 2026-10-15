# BarberFlow — RPC Contracts

Version: 1.0  
Status: APPROVED

## complete_checkout

BF-180 is **design-only** and freezes the following contract. It installs no SQL
function, endpoint, EXECUTE grants or runtime path. Materializing this contract
belongs to BF-181–BF-188; checkout becomes available only after those implementation
stages are completed and validated. The behavior below is the approved design,
not a claim of implemented checkout functionality.

Exact SQL signature (all seven arguments are required at the SQL boundary):

```sql
complete_checkout(
  p_business_id uuid,
  p_operation_id uuid,
  p_appointment_id uuid,
  p_client_id uuid,
  p_discount_amount numeric,
  p_payment_method text,
  p_items jsonb
) returns jsonb
```

The future application operation is `completeCheckout(businessId, input)`, with
`input = { operationId, appointmentId?, clientId?, discountAmount?, paymentMethod, items }`.
Business is captured explicitly by the caller; it is not inferred in a repository.
Omitted appointment/client become SQL NULL; omitted discount becomes `'0.00'` in the
future adapter. The SQL function has no defaults, avoiding the invalid conceptual
ordering of defaulted arguments before required payment/items arguments.

`p_items` uses exactly the same camelCase item keys as the application DTO:
`{ itemType: 'SERVICE' | 'PRODUCT', itemId: string, quantity: number, unitPriceOverride?: MoneyDecimal }`.
`itemId` is `services.id` or `products.id`, including when an appointment is linked.
Quantity is an integer from 1 through 2147483647. At least one item is required;
there is no new item-count limit or uniqueness rule. Duplicate lines retain their
own quantity/override. The adapter allowlists these keys; the eventual SQL validator
rejects unknown item keys, caller-supplied names, costs, snapshots, actors or totals.
SQL UUID arguments and item references must be valid identifiers. There is no
caller-controlled user identity.

`MoneyDecimal` input is a nonnegative decimal string with exactly two decimal
places, within numeric(12,2): maximum `9999999999.99`. No exponent, float calculation,
locale separator or implicit rounding is used for authoritative amounts. The optional
override may be zero and must meet the same limits. SQL calculations use exact
NUMERIC, validate scale/range before persistence, and reject NaN/infinity/overflow.

### Authorization, appointment and snapshots

The backend operation is **active OWNER only in V1**. BARBER, anon, no membership
and inactive membership are denied. Existing read policies stay unchanged. Derive
`created_by` only from `auth.uid()`; explicitly verify the business and every reference.
Do not add an extra business-is-active condition beyond the membership contract.
Unknown and foreign references have the same safe failure, without existence details.
The future atomic writer will require a narrowly scoped hardened SECURITY DEFINER
because ordinary callers cannot write the ledger: static schema-qualified SQL, explicit
identity/role/tenant checks before replay or return, and EXECUTE only for authenticated.
Do not broaden client table-write grants or introduce service-role frontend access.

A linked appointment must be in the same business and PENDING, CONFIRMED or IN_PROGRESS
for a new operation. CANCELLED, NO_SHOW and COMPLETED are rejected. Derive the sale's
client from the appointment; an explicitly supplied client must match it. A direct
sale may omit appointment and client; any supplied client must belong to the business.
No synthetic walk-in client is created.
COMPLETED is reachable only through checkout; operational status changes must not
provide a second completion path.

The submitted sale items are independent of `appointment_services`: do not require
equal services/quantities and do not copy lines automatically. SERVICE/PRODUCT names
and default sale prices come from the active catalog captured in the transaction;
an explicit validated override replaces only that sale line's price. PRODUCT cost
comes from `products.default_purchase_cost`; SERVICE cost is NULL. Preserve the
appointment's historical snapshots exactly. Later catalog changes cannot rewrite
either appointment or sale snapshots. No browser price/name/cost is authoritative.
Persist SERVICE lines with service_id and a NULL product_id; persist PRODUCT lines
with product_id and a NULL service_id, matching the existing sale_items constraints.

### Atomic effects, payment and discount

One transaction creates the sale, sale items, optional payment and product SALE
movements, then completes the sale and eligible appointment. Each gross line total
is exactly `unit_price_snapshot * quantity`; subtotal is their exact sum.
`p_discount_amount` persists as **sales.discount**, without renaming the column.
Require `0 <= discount <= subtotal`, zero discount for zero subtotal, and
`total = subtotal - discount`, all within the existing monetary precision/range.

Positive total creates exactly one payment for the full total. Zero total creates
no payment rows and sum(empty payments) is zero. There are no zero payments, split
payments, credit sales, overpayments or external payment-provider calls in this flow.
Payment notes are NULL because this DTO supplies no payment notes; actor/time are
server-managed. HD-006 methods are exactly CASH, BANK_TRANSFER, DEBIT_CARD, CREDIT_CARD
and DIGITAL_WALLET. BF-184 aligns only the payments CHECK to these five values
with a validated forward-only migration. It aborts if incompatible historical
methods exist, without mapping or rewriting them. The separate expenses CHECK
remains legacy and requires its own authorized alignment before expense writes
using HD-006. No external payment processing is introduced.

Global discount allocation for net revenue follows BUSINESS_RULES, Finance:
positive-gross SERVICE/PRODUCT lines are eligible; zero-gross lines receive zero;
allocate proportionally, round to persisted precision in a stable line order and
assign residual to the last eligible line, so allocations sum exactly to the global
discount and net lines sum to sale.total. Checkout persists gross line totals and
the global discount only; no per-line discount/net amount is added. The separately
pending HD-004 pathological allocation rule is not silently adopted or implemented
by this design-only ticket.

For each product, derive current stock from the same-business/product ledger after
locking its product row, aggregate quantities across duplicate product lines and
reject negative resulting stock. Append SALE movements with negative quantities,
transaction-time cost and `reference_type='SALE' / reference_id=sale.id`. Never call
`adjust_stock` for a sale, update a prior movement or persist current stock in products.
No expense, purchase, receipt retention/deletion or refund effect belongs to checkout.
Financial history is immutable: later corrections belong to a separate authorized
void/adjustment flow that preserves sale snapshots and payments and appends
compensating stock movements. It must not delete historical records, rewrite their
snapshots/payments or perform an automatic external refund.

### Idempotency, concurrency and result

Authorize before replay. Serialize the business/operation key with a transaction
advisory lock, then look up the existing `UNIQUE(business_id, operation_id)` sale.
An authorized completed operation returns its persisted sale/items/payments without
re-executing its input or revalidating the current catalog. A later VOIDED sale is
returned in its persisted VOIDED state; it is never completed again. A committed
legacy DRAFT with that key is rejected, not resumed or reported as successful.
No stored request fingerprint or mismatched-payload detection is claimed.

For a new operation, lock the linked appointment before product anchors; lock unique
product IDs in UUID order and read their balances only after acquiring those locks.
Use the same product protocol as adjust_stock and future stock writers. Revalidate
membership, references and appointment status after waits. Different operation IDs
cannot sell/complete one appointment twice. Use READ COMMITTED; reject stale snapshot
isolation with 40001 rather than trust a pre-lock ledger snapshot. Every failure,
deadlock or serialization abort rolls back all effects. There is no automatic
financial retry; an explicit retry retains its operationId.

BF-181 provides only the internal stock slice:
`private.lock_checkout_products(p_business_id uuid, p_product_ids uuid[], p_quantities integer[])`
returns `(product_id uuid, requested_quantity bigint, current_stock bigint)` in UUID
order. Parallel arrays contain PRODUCT lines only; duplicates aggregate before
locking and an empty pair supports service-only sales. The helper locks all product
anchors before reading balances, rejects unavailable/inactive products and insufficient
stock, and performs no ledger or catalog writes. It is SECURITY INVOKER with an empty
search_path and no EXECUTE for client roles. The future authorized server writer must
call it after operation/parent locks, and append SALE movements on the same connection
and transaction before commit. Calling it in a separate client RPC would not preserve
the stock guarantee; BF-181 exposes no such endpoint or completed checkout operation.

BF-182 provides only `private.persist_checkout_sale(business UUID, operation UUID,
appointment UUID, client UUID, subtotal NUMERIC, discount NUMERIC, total NUMERIC)`,
returning the existing `sales` row type internally. It validates trusted server-computed
amounts, derives linked client identity, serializes the operation key and parent,
and inserts one COMPLETED sale header or returns an authorized historical replay.
It never promotes a legacy DRAFT, rewrites a VOIDED sale, writes items/payments/stock,
or completes an appointment. It is an invoker helper with no client EXECUTE, not a
public intermediate checkout result. The future writer must acquire the same
`barberflow:checkout:{businessId}:{operationId}` advisory key and appointment lock
before BF-181 product locks; all slices run in that one transaction, with commit
only after every checkout effect succeeds. A sale header alone is not a completed
checkout flow and must never be exposed through a separate client RPC.

BF-183 provides only
`private.persist_checkout_items(p_business_id uuid, p_operation_id uuid, p_items jsonb)`,
returning the existing eleven-column `sale_items` row type, ordered by created_at/id.
It reuses the operation key and existing BF-182 header, never creates another sale,
and atomically inserts the explicit SERVICE/PRODUCT lines. Gross subtotal must match
the server-computed header; neither header totals nor catalog values are repaired.
Catalog names/prices and product cost are captured under UUID-ordered shared locks
(products before services); these preserve BF-181's already-held stronger product
locks without reading stock or replacing its stock-validation protocol. Overrides
are exact two-decimal strings; quantities are positive int4 JSON numbers. Unknown
keys and caller snapshots are rejected. Duplicates retain their separate quantities
and overrides. Existing snapshots replay unchanged before any input/catalog validation,
including for a VOIDED sale. The helper is SECURITY INVOKER, empty search_path, and
has no client-role EXECUTE. The future writer must call it for the fresh header on
the same transaction/connection and commit only after every remaining checkout slice;
this internal item result is not public checkout success. No payment, discount
allocation, stock movement or appointment completion is implemented by BF-183.

BF-184 provides only
`private.persist_checkout_payment(p_business_id uuid, p_operation_id uuid, p_payment_method text)`,
returning the existing nine-column `payments` row type as a set: one row for a
positive total and no rows for a zero total. It reuses the existing sale, operation
key and sale lock; the amount is derived exclusively from `sales.total`, with no
caller amount/audit fields. Before a new payment it checks the persisted item gross
sum against the header subtotal, validates the exact method and derives identity/time.
An existing singular, tenant-consistent full payment replays unchanged before new
input/catalog validation; inconsistent historical payments are rejected, never repaired.
The future public writer must handle authorized historical checkout replay before
executing new slices, including loading the empty payment set of a zero-total sale.
The helper is SECURITY INVOKER with an empty search_path and no client-role EXECUTE;
it never adds a payment to a VOIDED sale. It owns no stock, appointment completion,
refund, receipt or public endpoint. Every new slice still shares one transaction
and connection, with commit only after all checkout effects succeed.

BF-185 provides only
`private.persist_checkout_stock(p_business_id uuid, p_operation_id uuid)`,
returning the existing twelve-column `stock_movements` row type ordered by
occurred_at/id. It consumes the persisted PRODUCT sale items, appending one SALE
movement per line with `quantity_delta = -sale_items.quantity` and
`unit_cost = sale_items.unit_cost_snapshot`. Duplicate lines remain separate;
SERVICE lines create no movement, and a free product still consumes stock.
The sale reference is `reference_type='SALE' / reference_id=sale.id`; identity,
timestamps and IDs are server-managed, and notes are NULL. No client stock,
quantity, cost, type or audit payload is accepted by this slice.

It reuses the existing operation key and sale lock, and invokes BF-181 with the
persisted product IDs/quantities on the same transaction/connection. The future
orchestrator must still acquire BF-181 product locks before BF-183 catalog locks;
re-acquiring locks here does not release them or replace that lock order.
Balances come from the ledger under those retained product locks. New writes
require the existing item subtotal and payment set to match the sale header.
An exact existing per-line movement multiset replays without consulting current
prices/costs, product activity or stock, including for a VOIDED sale. Partial,
foreign or inconsistent historical sets are rejected without repair. The future
public orchestrator handles historical empty sets before invoking new stages.
The helper is SECURITY INVOKER, empty search_path, with no client-role EXECUTE.
No stock column, payment mutation, appointment completion or public checkout is
introduced; all checkout effects must succeed before the shared transaction commits.

Final output is exactly `{ sale, items, payments }`, containing persisted values:

- SaleRow (13): id, business_id, client_id, appointment_id, operation_id, status,
  subtotal, discount, total, sold_at, created_by, created_at, updated_at.
- SaleItemRow (11): id, sale_id, item_type, service_id, product_id,
  item_name_snapshot, unit_price_snapshot, quantity, line_total, unit_cost_snapshot,
  created_at.
- PaymentRow (9): id, business_id, sale_id, payment_method, amount, notes, paid_at,
  created_by, created_at.

UUIDs/timestamptz values are strings, quantities are integers, and bounded persisted
numeric(12,2) row amounts are JSON numbers, consistent with ordinary row projections;
they are never used for authoritative client arithmetic. References/cost/notes retain
their actual nullability. Items are ordered by created_at/id ASC and payments by
paid_at/id ASC for a stable replay. Do not include appointment, Session, tokens,
draft estimates, stock balances or unrelated records in this result.

Future fixed error identifiers: 42501/CHECKOUT_ACCESS_DENIED;
22023/INVALID_CHECKOUT (including uniformly unavailable references);
PT409/INSUFFICIENT_STOCK; PT409/INVALID_APPOINTMENT_STATUS. Use fixed allowlisted
details for PT409; never parse SQL prose or expose constraints/foreign IDs.
40001/40P01 abort the transaction without automatic retry. These are future error
contracts; BF-180 introduces no executable error response or SQL implementation.

Future validation must cover authorization/tenant negatives, linked statuses and
client consistency, exact item keys and overrides, duplicate quantities, monetary
limits/zero-total/full-discount behavior, current-catalog snapshots/history
preservation, one full payment, stock races, same-key replay, different-key appointment
races, rollback at each stage, isolation/deadlock handling and exact persisted output.
These are acceptance criteria, not claims of implemented checkout behavior.

## complete_purchase

Inputs: business, operation id, supplier, payment method, purchased_at, notes, item list(productId, quantity, unitCost). Atomically validates, creates purchase/items, PURCHASE movements, generated expense, updates default purchase cost and completes purchase.

COMPLETED purchases cannot be directly updated/deleted. Corrections require an explicit void/adjustment workflow that handles stock and the generated expense consistently. Created stock movements are append-only; corrections append compensating movements.

## create_appointment_with_services

Inputs: business, client, barber member, start time, optional duration override, notes, service list. Server validates membership, open day/hours, ownership/activity, duration and conflicts, then creates appointment + service snapshots.

## get_availability

Inputs: business, barber, date, duration. Slot interval derives from business settings. Response is advisory; creation revalidates.

## adjust_stock

Inputs: business, product, signed quantity delta, reason, notes. Server verifies authorization, product ownership and non-negative resulting stock, then creates LOSS/ADJUSTMENT movement.

## Analytics RPCs

Expected: `get_dashboard_summary`, `get_revenue_by_day`, `get_expense_summary`, `get_top_services`, `get_top_products`, `get_client_stats`, `get_low_stock_products`. All validate membership/role and aggregate server-side.

Revenue analytics use COMPLETED sale totals and net SERVICE/PRODUCT revenue after proportional allocation of each sale's global discount. Apply the eligibility, zero-subtotal and last-eligible-line rounding rules in `BUSINESS_RULES.md`, Finance, so that net service revenue + net product revenue = sale.total exactly. Allocations may be derived in queries/RPCs without changing `sales` / `sale_items` or persisting per-line discounts. VOIDED sales are excluded.
