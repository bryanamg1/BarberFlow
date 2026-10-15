# BarberFlow — RPC Contracts

Version: 1.0  
Status: APPROVED

## complete_checkout

BF-180 freezes the following contract. The current function is a **fail-closed
skeleton**: an authenticated active OWNER receives `0A000 / CHECKOUT_NOT_READY`,
with no writes and no successful response. Checkout becomes available only after
BF-181–188 are implemented and validated. No frontend adapter or UI invokes it yet.

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
The current no-write skeleton is SECURITY INVOKER with empty search_path. The final
atomic writer will require a narrowly scoped hardened SECURITY DEFINER because
ordinary callers cannot write the ledger: static schema-qualified SQL, explicit
identity/role/tenant checks before replay or return, and EXECUTE only for authenticated.
Do not broaden client table-write grants or introduce service-role frontend access.

A linked appointment must be in the same business and PENDING, CONFIRMED or IN_PROGRESS
for a new operation. CANCELLED, NO_SHOW and COMPLETED are rejected. Derive the sale's
client from the appointment; an explicitly supplied client must match it. A direct
sale may omit appointment and client; any supplied client must belong to the business.
No synthetic walk-in client is created.

The submitted sale items are independent of `appointment_services`: do not require
equal services/quantities and do not copy lines automatically. SERVICE/PRODUCT names
and default sale prices come from the active catalog captured in the transaction;
an explicit validated override replaces only that sale line's price. PRODUCT cost
comes from `products.default_purchase_cost`; SERVICE cost is NULL. Preserve the
appointment's historical snapshots exactly. Later catalog changes cannot rewrite
either appointment or sale snapshots. No browser price/name/cost is authoritative.

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
and DIGITAL_WALLET. **Current payments CHECK uses CASH/TRANSFER/DEBIT/CREDIT/OTHER**:
it must be explicitly aligned before payment writes are enabled. BF-180 does not
change that CHECK, migrate historical methods or invent a mapping to OTHER.

Global discount allocation for net revenue follows BUSINESS_RULES, Finance:
positive-gross SERVICE/PRODUCT lines are eligible; zero-gross lines receive zero;
allocate proportionally, round to persisted precision in a stable line order and
assign residual to the last eligible line, so allocations sum exactly to the global
discount and net lines sum to sale.total. Checkout persists gross line totals and
the global discount only; no per-line discount/net amount is added. The separately
pending HD-004 pathological allocation rule is not silently adopted or implemented
by this checkout skeleton.

For each product, derive current stock from the same-business/product ledger after
locking its product row, aggregate quantities across duplicate product lines and
reject negative resulting stock. Append SALE movements with negative quantities,
transaction-time cost and `reference_type='SALE' / reference_id=sale.id`. Never call
`adjust_stock` for a sale, update a prior movement or persist current stock in products.
No expense, purchase, receipt retention/deletion or refund effect belongs to checkout.

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
40001/40P01 abort the transaction without automatic retry. The current skeleton
returns only access denial or 0A000 with detail CHECKOUT_NOT_READY; it does not yet
implement item validation, snapshots, money, locks, replay or any completion effect.

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
