# BarberFlow — Business Rules

Version: 1.0  
Status: APPROVED

## Appointments

Conflict condition: `new_start < existing_end AND new_end > existing_start`. Revalidate server-side when creating/rescheduling. V1 does not allow appointments outside business hours or on closed days. Cancel/no-show preserves history.

Default duration = sum of service duration snapshots unless an explicit allowed override is supplied.

Permissions are Read/Create, Update operational fields/status, Reschedule, Cancel and Mark no-show, subject to role authorization. NO physical delete of historical appointments; service snapshots must preserve history.

## Checkout

Checkout may contain services, products or both. Direct product sales may omit appointment/client. Completion is one atomic server transaction. Never execute sale/payment/stock/appointment completion as independent frontend requests.

Global discount only in V1: `total = subtotal - discount_amount`, with `0 <= discount_amount <= subtotal`. If subtotal is zero, discount_amount must be zero. Allocate the discount proportionally for net revenue metrics as defined under Finance; per-line discount persistence is not required in V1.

Completed sale should be fully paid in V1. Server computes authoritative prices/totals.

## Historical snapshots

Historical transactions never depend on current catalog values. Snapshot transaction-time name, price, cost and duration where relevant.

Configurable clients, services, products and categories permit Read/Create/Update/Archive according to role. NO physical DELETE when associated history exists.

## Inventory

Every stock change creates a movement. Current stock derives from movement sum. V1 rejects negative stock. Revalidate stock in the transaction at commit time.

`stock_movements` is append-only. Once created, a movement permits NO UPDATE and NO DELETE. Corrections create compensating movements through an authorized workflow.

Stock states are derived: NORMAL, LOW when stock <= minimum, OUT when stock=0. Do not persist these states.

## Purchases

Completing purchase atomically creates purchase, purchase items, positive stock movements, a PURCHASE-source expense and updates current default purchase cost. Do not duplicate the expense manually.

## Costs

V1 uses current `default_purchase_cost` as the sale-time cost snapshot. Do not implement FIFO/LIFO/weighted average.

## Voids and corrections

COMPLETED sales permit Read, NO direct UPDATE and NO direct DELETE. Corrections occur through the explicit `void_sale` workflow. Voiding uses compensating RETURN movements for sold products and analytics excludes VOIDED sales. Historical sale items and snapshots are preserved.

COMPLETED purchases permit Read, NO direct UPDATE and NO direct DELETE. Corrections require an explicit void/adjustment workflow that preserves purchase history, creates compensating stock movements when applicable and handles the generated expense consistently. Purchase-generated expenses cannot be independently edited/deleted to bypass this workflow.

## Finance

Revenue derives from COMPLETED sales, not appointments. Total net revenue sums `sale.total`. Net service revenue sums gross SERVICE line totals minus their allocated global discount; net product revenue does the same for PRODUCT lines. Product COGS uses cost snapshot × quantity. Product gross profit = net product revenue - COGS. Average ticket = SUM(completed sale.total) / completed sales count.

### Proportional global discount allocation

For each completed sale, allocate `sale.discount_amount` proportionally to the gross subtotal of each eligible line. Positive-subtotal SERVICE and PRODUCT lines are eligible; zero-subtotal lines receive zero discount.

`line_discount = sale.discount_amount * gross_line_subtotal / sale.subtotal`

`net_line_revenue = gross_line_subtotal - line_discount`

- If subtotal = 0, discount_amount must be 0; no division or allocation is performed.
- discount_amount must never exceed subtotal and must be non-negative.
- Round allocations to the persisted monetary precision using a stable line order. Assign any rounding difference to the last eligible line so that allocated discounts sum exactly to `sale.discount_amount`.
- Always enforce `net service revenue + net product revenue = sale.total`.
- Gross `sale_items.line_total` values and historical snapshots remain unchanged. V1 does not require per-line allocated discounts to be persisted; queries/analytics RPCs may derive them without changing `sales` / `sale_items`.

Example: subtotal 20,000; services 15,000 (75%); products 5,000 (25%); global discount 2,000. Services receive 1,500 discount and yield 13,500 net revenue. Products receive 500 discount and yield 4,500 net revenue. Net revenues sum to sale.total 18,000.

## Idempotency and concurrency

Critical completion operations use `operation_id`. Repeated submission must not duplicate side effects. Availability and stock must be revalidated server-side inside the critical transaction.
