# BarberFlow — Database Schema Specification

Version: 1.0  
Status: APPROVED

## General rules

- UUID primary keys for main entities.
- Prefer `gen_random_uuid()`.
- Persist timestamps as `timestamptz`.
- Persist money as fixed numeric, e.g. `numeric(12,2)`.
- Never use float/double for persisted money.
- Use `is_active`/archive semantics where destructive deletion would break history.
- Business-owned tables require RLS.
- Historical mutability follows `RLS_MATRIX.md`: configurable entities archive rather than physically deleting associated history; historical appointments cannot be physically deleted; COMPLETED sales/purchases permit NO direct UPDATE/DELETE; `stock_movements` is append-only with NO UPDATE/DELETE after creation. Corrections use explicit workflows and compensating movements.

## Tables

### profiles
`id uuid PK -> auth.users.id`, `first_name`, `last_name`, optional `phone`, optional `avatar_path`, timestamps.

### businesses
`id`, `name`, optional contact/address/logo, `currency_code` default ARS, `timezone` default America/Argentina/Buenos_Aires, `is_active`, timestamps.

### business_members
`id`, `business_id`, `user_id`, role OWNER|BARBER, `is_active`, timestamps, UNIQUE(business_id,user_id).

### business_settings
`business_id` unique, appointment interval default 30, default buffer 0, overlapping default false, low stock notifications default true.

### business_hours
`business_id`, `day_of_week` 0..6, open/close time, `is_closed`, UNIQUE(business_id,day_of_week).

### clients
`business_id`, names/contact/social/birthday/notes/preferences, `is_active`, timestamps. Do not persist total_spent/visit_count/last_visit.

### services
`business_id`, name, description, `price numeric(12,2) >=0`, `duration_minutes >0`, `is_active`, timestamps.

### appointments
`business_id`, `client_id`, `barber_member_id`, `start_at`, `end_at`, status, notes, `created_by`, timestamps; CHECK end_at > start_at.

Statuses: PENDING, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED, NO_SHOW.

### appointment_services
`appointment_id`, optional `service_id`, name/price/duration snapshots, quantity >0, line_total, created_at.

### product_categories
`business_id`, name, `is_active`, timestamps.

### products
`business_id`, category, name, optional sku/description, `default_purchase_cost >=0`, `sale_price >=0`, `minimum_stock >=0`, `is_active`, timestamps.

### sales
`business_id`, `operation_id`, optional appointment/client, status DRAFT|COMPLETED|VOIDED, subtotal, discount, total, sold_at, created_by, timestamps, UNIQUE(business_id,operation_id).

### sale_items
`sale_id`, item_type SERVICE|PRODUCT, one relevant service/product reference, name snapshot, quantity >0, cost snapshot when relevant, unit price snapshot, line_total.

Sale item line totals represent gross subtotals. `sale.total = sale.subtotal - sale.discount_amount` conceptually refers to the existing sale-level discount field; it does not add or rename a schema field. Net SERVICE/PRODUCT revenue derives by proportionally allocating that global discount as specified in `BUSINESS_RULES.md`, Finance. Allocated discounts need not be persisted per line in V1; historical snapshots and the `sales` / `sale_items` model remain unchanged.

### payments
`business_id`, `sale_id`, payment_method CASH|TRANSFER|DEBIT|CREDIT|OTHER, amount >0, paid_at, optional notes.

### purchases
`business_id`, `operation_id`, supplier, status DRAFT|COMPLETED|VOIDED, total, purchased_at, notes, created_by, timestamps, UNIQUE(business_id,operation_id).

### purchase_items
`purchase_id`, `product_id`, product name snapshot, quantity >0, unit_cost >=0, line_total.

### stock_movements
`business_id`, `product_id`, type PURCHASE|SALE|LOSS|ADJUSTMENT|RETURN, signed `quantity_delta`, optional unit_cost/reference/notes, occurred_at, created_by, created_at. Current stock = SUM(quantity_delta).

### expense_categories
`business_id`, name, `is_active`, timestamps. Seeds: Insumos, Herramientas, Alquiler, Servicios, Publicidad, Transporte, Mantenimiento, Mercadería, Otros.

### expenses
`business_id`, category, source_type MANUAL|PURCHASE, optional purchase_id, description, amount >=0, payment method, expense date, optional receipt/notes, created_by, timestamps. PURCHASE source requires purchase_id.

## Recommended indexes

- appointments: `(business_id,start_at)`, `(barber_member_id,start_at)`, `(client_id,start_at)`, `(business_id,status)`
- sales: `(business_id,sold_at)`, `(client_id,sold_at)`, `appointment_id`
- expenses: `(business_id,expense_date)`
- stock movements: `(business_id,product_id,occurred_at)`
- products: `(business_id,is_active)`, `category_id`
- clients: `(business_id,is_active)`, `phone`

## Suggested migration order

001 extensions → profiles → businesses → business_members → settings → hours → clients → services → appointments → appointment_services → product_categories → products → sales → sale_items → payments → purchases → purchase_items → stock_movements → expense_categories → expenses → indexes → RLS helpers → policies → RPCs → seeds.
