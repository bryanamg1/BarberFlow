BEGIN;

-- Lock parent before its expense table. Abort the entire migration on legacy
-- methods: never translate or delete financial history to fit a new CHECK.
LOCK TABLE public.purchases, public.expenses IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.expenses WHERE payment_method NOT IN
      ('CASH','BANK_TRANSFER','DEBIT_CARD','CREDIT_CARD','DIGITAL_WALLET')) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Expense payment method alignment requires review of existing history',
      DETAIL='PAYMENT_METHOD_ALIGNMENT_REQUIRED';
  END IF;
END;
$$;
ALTER TABLE public.expenses DROP CONSTRAINT expenses_payment_method_check;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_payment_method_check
  CHECK (payment_method IN ('CASH','BANK_TRANSFER','DEBIT_CARD','CREDIT_CARD','DIGITAL_WALLET'));

-- Nullable legacy snapshots, without defaults/backfill. Only BF213 NEW writes
-- these fields; its public purchase/items projections remain exactly 11 + 8.
ALTER TABLE public.purchases
  ADD COLUMN expense_category_id uuid REFERENCES public.expense_categories(id) ON DELETE RESTRICT,
  ADD COLUMN payment_method text CONSTRAINT purchases_payment_method_check
    CHECK (payment_method IN ('CASH','BANK_TRANSFER','DEBIT_CARD','CREDIT_CARD','DIGITAL_WALLET'));

-- BF213 is an internal persistence slice, NOT a completed public purchase.
-- BF214/BF215 must run on the same transaction/connection before public
-- activation in BF216. No ledger, current cost or expense effects here.
CREATE OR REPLACE FUNCTION private.persist_purchase(
  p_business_id uuid,
  p_operation_id uuid,
  p_supplier text,
  p_expense_category_id uuid,
  p_payment_method text,
  p_purchased_at timestamptz,
  p_notes text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  purchase public.purchases%ROWTYPE;
  line jsonb;
  product_id uuid;
  product_ids uuid[] := ARRAY[]::uuid[];
  product_active boolean;
  quantity_value numeric;
  cost numeric;
  computed_total numeric;
  oversized boolean;
  items_result jsonb;
BEGIN
  IF caller_id IS NULL OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Purchase access denied', DETAIL = 'ACCESS_DENIED';
  END IF;
  -- Post-wait authorization/catalog checks require fresh command snapshots.
  IF pg_catalog.current_setting('transaction_isolation') NOT IN ('read committed', 'read uncommitted') THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Retry purchase in a fresh transaction';
  END IF;
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid purchase', DETAIL = 'INVALID_INPUT';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'barberflow:purchase:' || p_business_id::text || ':' || p_operation_id::text, 0));
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Purchase access denied', DETAIL = 'ACCESS_DENIED';
  END IF;
  SELECT p.id, p.business_id, p.operation_id, p.supplier, p.status, p.total,
         p.purchased_at, p.notes, p.created_by, p.created_at, p.updated_at, p.expense_category_id, p.payment_method
    INTO purchase
  FROM public.purchases AS p
  WHERE p.business_id = p_business_id AND p.operation_id = p_operation_id
  FOR UPDATE;
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Purchase access denied', DETAIL = 'ACCESS_DENIED';
  END IF;

  IF purchase.id IS NOT NULL THEN
    IF purchase.status NOT IN ('COMPLETED', 'VOIDED') THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Invalid purchase status', DETAIL = 'INVALID_STATUS';
    END IF;
    -- Replay returns immutable history before checking any new payload or
    -- mutable catalog state. Inconsistent legacy rows are never repaired.
    IF NOT EXISTS (SELECT 1 FROM public.purchase_items AS i WHERE i.purchase_id = purchase.id)
       OR (SELECT pg_catalog.sum(i.line_total) FROM public.purchase_items AS i
           WHERE i.purchase_id = purchase.id) IS DISTINCT FROM purchase.total
       OR EXISTS (
         SELECT 1 FROM public.purchase_items AS i
         WHERE i.purchase_id = purchase.id AND NOT EXISTS (
           SELECT 1 FROM public.products AS p WHERE p.id = i.product_id AND p.business_id = p_business_id))
       OR EXISTS (
         SELECT i.product_id FROM public.purchase_items AS i WHERE i.purchase_id = purchase.id
         GROUP BY i.product_id HAVING pg_catalog.min(i.unit_cost_snapshot) <> pg_catalog.max(i.unit_cost_snapshot)) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid purchase', DETAIL = 'INVALID_INPUT';
    END IF;
  ELSE
    IF p_supplier IS NULL OR pg_catalog.length(pg_catalog.btrim(p_supplier)) = 0
       OR p_expense_category_id IS NULL OR p_payment_method IS NULL
       OR p_payment_method NOT IN ('CASH', 'BANK_TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD', 'DIGITAL_WALLET')
       OR p_purchased_at IS NULL OR NOT pg_catalog.isfinite(p_purchased_at)
       OR pg_catalog.jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid purchase', DETAIL = 'INVALID_INPUT';
    END IF;
    IF pg_catalog.jsonb_array_length(p_items) = 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid purchase', DETAIL = 'INVALID_INPUT';
    END IF;
    FOR line IN SELECT value FROM pg_catalog.jsonb_array_elements(p_items) LOOP
      IF pg_catalog.jsonb_typeof(line) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid purchase', DETAIL = 'INVALID_INPUT';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(line) AS k
                 WHERE k NOT IN ('productId', 'quantity', 'unitCost'))
         OR pg_catalog.jsonb_typeof(line->'productId') IS DISTINCT FROM 'string'
         OR pg_catalog.jsonb_typeof(line->'quantity') IS DISTINCT FROM 'number'
         OR pg_catalog.jsonb_typeof(line->'unitCost') IS DISTINCT FROM 'string'
         OR line->>'unitCost' !~ '^[0-9]+\.[0-9]{2}$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid purchase', DETAIL = 'INVALID_INPUT';
      END IF;
      BEGIN
        product_id := (line->>'productId')::uuid;
        cost := (line->>'unitCost')::numeric;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid purchase', DETAIL = 'INVALID_INPUT';
      END;
      quantity_value := (line->>'quantity')::numeric;
      IF quantity_value NOT BETWEEN 1 AND 2147483647
         OR quantity_value <> pg_catalog.trunc(quantity_value) OR cost > 9999999999.99 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid purchase', DETAIL = 'INVALID_INPUT';
      END IF;
      product_ids := pg_catalog.array_append(product_ids, product_id);
    END LOOP;
    -- Compare parsed UUIDs and exact amounts; aliases/casing/leading zeros
    -- cannot bypass the consistent-cost rule. Keep duplicate physical lines.
    IF EXISTS (
      SELECT (value->>'productId')::uuid FROM pg_catalog.jsonb_array_elements(p_items)
      GROUP BY (value->>'productId')::uuid
      HAVING pg_catalog.min((value->>'unitCost')::numeric) <> pg_catalog.max((value->>'unitCost')::numeric)) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid purchase', DETAIL = 'INVALID_INPUT';
    END IF;

    -- Same row anchors as checkout/adjustment, without outgoing-stock checks.
    -- Lock all products in UUID order before snapshots and retain through commit.
    FOR product_id IN SELECT DISTINCT v FROM pg_catalog.unnest(product_ids) AS v ORDER BY v LOOP
      SELECT p.is_active INTO product_active FROM public.products AS p
      WHERE p.id = product_id AND p.business_id = p_business_id FOR UPDATE;
      IF NOT FOUND OR NOT product_active THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid purchase', DETAIL = 'INVALID_INPUT';
      END IF;
    END LOOP;
    IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Purchase access denied', DETAIL = 'ACCESS_DENIED';
    END IF;
    PERFORM c.id FROM public.expense_categories AS c
    WHERE c.id = p_expense_category_id AND c.business_id = p_business_id AND c.is_active FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid purchase', DETAIL = 'INVALID_INPUT';
    END IF;
    IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Purchase access denied', DETAIL = 'ACCESS_DENIED';
    END IF;

    SELECT pg_catalog.sum((value->>'quantity')::numeric * (value->>'unitCost')::numeric),
           pg_catalog.bool_or((value->>'quantity')::numeric * (value->>'unitCost')::numeric > 9999999999.99)
      INTO computed_total, oversized FROM pg_catalog.jsonb_array_elements(p_items);
    IF oversized OR computed_total > 9999999999.99 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid purchase', DETAIL = 'INVALID_INPUT';
    END IF;

    INSERT INTO public.purchases (business_id, operation_id, supplier, status, total, purchased_at, notes, created_by, expense_category_id, payment_method)
    VALUES (p_business_id, p_operation_id, p_supplier, 'COMPLETED', computed_total, p_purchased_at, p_notes, caller_id, p_expense_category_id, p_payment_method)
    RETURNING id, business_id, operation_id, supplier, status, total, purchased_at, notes, created_by, created_at, updated_at, expense_category_id, payment_method
      INTO purchase;
    -- Existing financial-currency/FK triggers can wait too; losing access
    -- during those waits must roll back this header, not leave a partial row.
    IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Purchase access denied', DETAIL = 'ACCESS_DENIED';
    END IF;
    INSERT INTO public.purchase_items (purchase_id, product_id, product_name_snapshot, quantity, unit_cost_snapshot, line_total)
    SELECT purchase.id, p.id, p.name, (e.value->>'quantity')::numeric::integer, (e.value->>'unitCost')::numeric,
           (e.value->>'quantity')::numeric * (e.value->>'unitCost')::numeric
    FROM pg_catalog.jsonb_array_elements(p_items) AS e(value)
    JOIN public.products AS p ON p.id = (e.value->>'productId')::uuid AND p.business_id = p_business_id;
  END IF;

  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', i.id, 'purchase_id', i.purchase_id, 'product_id', i.product_id,
    'product_name_snapshot', i.product_name_snapshot, 'quantity', i.quantity,
    'unit_cost_snapshot', i.unit_cost_snapshot, 'line_total', i.line_total, 'created_at', i.created_at
  ) ORDER BY i.created_at, i.id) INTO items_result
  FROM public.purchase_items AS i WHERE i.purchase_id = purchase.id;
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Purchase access denied', DETAIL = 'ACCESS_DENIED';
  END IF;
  RETURN pg_catalog.jsonb_build_object('purchase', pg_catalog.jsonb_build_object(
    'id', purchase.id, 'business_id', purchase.business_id, 'operation_id', purchase.operation_id,
    'supplier', purchase.supplier, 'status', purchase.status, 'total', purchase.total,
    'purchased_at', purchase.purchased_at, 'notes', purchase.notes, 'created_by', purchase.created_by,
    'created_at', purchase.created_at, 'updated_at', purchase.updated_at
  ), 'items', items_result);
END;
$$;

REVOKE ALL ON FUNCTION private.persist_purchase(uuid, uuid, text, uuid, text, timestamptz, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- Internal expense slice only. The trusted future orchestrator supplies NEW
-- versus REPLAY; a missing expense/context never authorizes backfill. BF216
-- owns public activation and must compose BF213 -> BF214 -> BF215 in one TX.
CREATE FUNCTION private.persist_purchase_expense(
  p_business_id uuid,
  p_operation_id uuid,
  p_apply_initial_effects boolean
)
RETURNS public.expenses
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  purchase public.purchases%ROWTYPE;
  expense public.expenses%ROWTYPE;
  category_active boolean;
  business_timezone text;
  civil_date date;
BEGIN
  IF caller_id IS NULL OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Purchase access denied', DETAIL='ACCESS_DENIED';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Retry purchase in a fresh transaction';
  END IF;
  IF p_operation_id IS NULL OR p_apply_initial_effects IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid purchase', DETAIL='INVALID_INPUT';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'barberflow:purchase:' || p_business_id::text || ':' || p_operation_id::text, 0));
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Purchase access denied', DETAIL='ACCESS_DENIED';
  END IF;
  SELECT p.id,p.business_id,p.operation_id,p.supplier,p.status,p.total,p.purchased_at,p.notes,
         p.created_by,p.created_at,p.updated_at,p.expense_category_id,p.payment_method
    INTO purchase FROM public.purchases AS p
    WHERE p.business_id=p_business_id AND p.operation_id=p_operation_id FOR UPDATE;
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Purchase access denied', DETAIL='ACCESS_DENIED';
  END IF;
  IF purchase.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid purchase', DETAIL='INVALID_INPUT';
  END IF;
  IF purchase.status NOT IN ('COMPLETED','VOIDED')
     OR (p_apply_initial_effects AND purchase.status<>'COMPLETED') THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Invalid purchase status', DETAIL='INVALID_STATUS';
  END IF;
  IF purchase.expense_category_id IS NULL OR purchase.payment_method IS NULL
     OR purchase.payment_method NOT IN ('CASH','BANK_TRANSFER','DEBIT_CARD','CREDIT_CARD','DIGITAL_WALLET') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid purchase', DETAIL='INVALID_INPUT';
  END IF;

  -- Read-only validation of the complete ledger, including item/total/tenant
  -- history and UUID-ordered product anchors. NEVER reapply BF214 here.
  PERFORM private.persist_purchase_stock(p_business_id,p_operation_id,false);
  SELECT c.is_active INTO category_active FROM public.expense_categories AS c
    WHERE c.id=purchase.expense_category_id AND c.business_id=p_business_id FOR SHARE;
  IF NOT FOUND OR (p_apply_initial_effects AND NOT category_active) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid purchase', DETAIL='INVALID_INPUT';
  END IF;
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Purchase access denied', DETAIL='ACCESS_DENIED';
  END IF;
  SELECT e.id,e.business_id,e.category_id,e.source_type,e.purchase_id,e.description,e.amount,
         e.payment_method,e.expense_date,e.receipt_path,e.notes,e.created_by,e.created_at,e.updated_at
    INTO expense FROM public.expenses AS e WHERE e.purchase_id=purchase.id FOR UPDATE;
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Purchase access denied', DETAIL='ACCESS_DENIED';
  END IF;

  IF p_apply_initial_effects THEN
    IF expense.id IS NOT NULL OR purchase.created_by<>caller_id OR purchase.purchased_at IS NULL
       OR NOT pg_catalog.isfinite(purchase.purchased_at) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid purchase', DETAIL='INVALID_INPUT';
    END IF;
    -- BF213's existing currency trigger already retains this business anchor;
    -- reusing it also stabilizes timezone while deriving the initial civil date.
    SELECT b.timezone INTO business_timezone FROM public.businesses AS b
      WHERE b.id=p_business_id FOR NO KEY UPDATE;
    IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Purchase access denied', DETAIL='ACCESS_DENIED';
    END IF;
    BEGIN
      civil_date := (purchase.purchased_at AT TIME ZONE business_timezone)::date;
    EXCEPTION WHEN invalid_parameter_value OR datetime_field_overflow THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid purchase', DETAIL='INVALID_INPUT';
    END;
    IF civil_date IS NULL OR NOT pg_catalog.isfinite(civil_date)
       OR civil_date<DATE '0001-01-01' OR civil_date>DATE '9999-12-31' THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid purchase', DETAIL='INVALID_INPUT';
    END IF;
    INSERT INTO public.expenses(business_id,category_id,source_type,purchase_id,description,amount,
      payment_method,expense_date,receipt_path,notes,created_by)
    VALUES(purchase.business_id,purchase.expense_category_id,'PURCHASE',purchase.id,'Compra de productos',
      purchase.total,purchase.payment_method,civil_date,NULL,purchase.notes,purchase.created_by)
    RETURNING id,business_id,category_id,source_type,purchase_id,description,amount,payment_method,
      expense_date,receipt_path,notes,created_by,created_at,updated_at INTO expense;
    -- Currency coordination/FK waits during INSERT require fresh authorization.
  ELSE
    -- Complete historical expense only. No date recomputation against today's
    -- timezone and no reconstruction from a retry payload or mutable catalog.
    IF expense.id IS NULL OR expense.business_id<>purchase.business_id OR expense.source_type<>'PURCHASE'
       OR expense.purchase_id<>purchase.id OR expense.amount IS DISTINCT FROM purchase.total
       OR expense.category_id<>purchase.expense_category_id OR expense.payment_method<>purchase.payment_method
       OR expense.created_by<>purchase.created_by OR expense.description<>'Compra de productos'
       OR expense.notes IS DISTINCT FROM purchase.notes OR expense.receipt_path IS NOT NULL
       OR NOT pg_catalog.isfinite(expense.expense_date)
       OR expense.expense_date<DATE '0001-01-01' OR expense.expense_date>DATE '9999-12-31' THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid purchase', DETAIL='INVALID_INPUT';
    END IF;
  END IF;
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Purchase access denied', DETAIL='ACCESS_DENIED';
  END IF;
  RETURN expense;
END;
$$;
REVOKE ALL ON FUNCTION private.persist_purchase_expense(uuid,uuid,boolean)
  FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
