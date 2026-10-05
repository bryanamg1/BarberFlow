# BarberFlow — RPC Contracts

Version: 1.0  
Status: APPROVED

## complete_checkout

Conceptual signature:

```sql
complete_checkout(
  p_business_id uuid,
  p_operation_id uuid,
  p_appointment_id uuid default null,
  p_client_id uuid default null,
  p_discount_amount numeric default 0,
  p_payment_method text,
  p_items jsonb
) returns jsonb
```

Client item contains type, id, quantity and optional non-negative unitPriceOverride. Client is not authoritative for name, default price/cost, stock or totals.

Server flow: auth → membership → idempotency → validate appointment/items → lock/revalidate stock → calculate totals → create sale/items/payment → create SALE movements → complete sale/appointment → return result.

The server validates `0 <= discount_amount <= subtotal`, requires zero discount when subtotal is zero and calculates `total = subtotal - discount_amount`. Per-line discount persistence is not required. COMPLETED sales cannot be directly updated/deleted; corrections use the explicit `void_sale` workflow while preserving historical snapshots.

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
