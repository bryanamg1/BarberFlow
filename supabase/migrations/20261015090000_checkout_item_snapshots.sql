BEGIN;

-- Internal slice only. The authorized future checkout writer owns the operation,
-- parent and BF181 product locks and invokes BF182/BF183 on this same transaction.
-- No public intermediate success, new sale creation or stock/payment effects.
CREATE FUNCTION private.persist_checkout_items(
  p_business_id uuid,
  p_operation_id uuid,
  p_items jsonb
)
RETURNS SETOF public.sale_items
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  sale public.sales%ROWTYPE;
  line jsonb;
  prepared jsonb := '[]'::jsonb;
  reference_id uuid;
  product_ids uuid[] := ARRAY[]::uuid[];
  service_ids uuid[] := ARRAY[]::uuid[];
  quantity_value numeric;
  price numeric;
  cost numeric;
  gross numeric;
  subtotal numeric := 0;
  snapshot_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Checkout access denied', DETAIL = 'CHECKOUT_ACCESS_DENIED';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') NOT IN ('read committed', 'read uncommitted') THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Retry checkout in a fresh transaction';
  END IF;
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'barberflow:checkout:' || p_business_id::text || ':' || p_operation_id::text, 0));
  IF NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Checkout access denied', DETAIL = 'CHECKOUT_ACCESS_DENIED';
  END IF;
  SELECT s.id,s.business_id,s.client_id,s.appointment_id,s.operation_id,s.status,
    s.subtotal,s.discount,s.total,s.sold_at,s.created_by,s.created_at,s.updated_at INTO sale FROM public.sales AS s
  WHERE s.business_id = p_business_id AND s.operation_id = p_operation_id FOR UPDATE;
  IF NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Checkout access denied', DETAIL = 'CHECKOUT_ACCESS_DENIED';
  END IF;
  IF sale.id IS NULL OR sale.status = 'DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
  END IF;
  IF (sale.client_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.clients c WHERE c.id = sale.client_id AND c.business_id = p_business_id))
     OR (sale.appointment_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.appointments a WHERE a.id = sale.appointment_id AND a.business_id = p_business_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Checkout access denied', DETAIL = 'CHECKOUT_ACCESS_DENIED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.sale_items i WHERE i.sale_id = sale.id) THEN
    -- Historical replay never revalidates/reprices the catalog or submitted input.
    RETURN QUERY SELECT i.id,i.sale_id,i.item_type,i.service_id,i.product_id,
      i.item_name_snapshot,i.unit_price_snapshot,i.quantity,i.line_total,i.unit_cost_snapshot,i.created_at
      FROM public.sale_items i WHERE i.sale_id = sale.id ORDER BY i.created_at,i.id;
    RETURN;
  END IF;
  IF sale.status <> 'COMPLETED' OR pg_catalog.jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
  END IF;
  IF pg_catalog.jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
  END IF;
  FOR line IN SELECT value FROM pg_catalog.jsonb_array_elements(p_items) LOOP
    IF pg_catalog.jsonb_typeof(line) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
    END IF;
    IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(line) k
              WHERE k NOT IN ('itemType','itemId','quantity','unitPriceOverride'))
       OR line->>'itemType' IS NULL OR line->>'itemType' NOT IN ('SERVICE','PRODUCT')
       OR pg_catalog.jsonb_typeof(line->'itemType') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(line->'itemId') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(line->'quantity') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
    END IF;
    BEGIN
      reference_id := (line->>'itemId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
    END;
    quantity_value := (line->>'quantity')::numeric;
    IF quantity_value NOT BETWEEN 1 AND 2147483647 OR quantity_value <> pg_catalog.trunc(quantity_value) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
    END IF;
    IF line ? 'unitPriceOverride' THEN
      IF pg_catalog.jsonb_typeof(line->'unitPriceOverride') IS DISTINCT FROM 'string'
         OR line->>'unitPriceOverride' !~ '^[0-9]+\.[0-9]{2}$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
      END IF;
      BEGIN
        price := (line->>'unitPriceOverride')::numeric;
      EXCEPTION WHEN numeric_value_out_of_range THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
      END;
      IF price > 9999999999.99 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
      END IF;
    END IF;
    IF line->>'itemType' = 'PRODUCT' THEN
      product_ids := pg_catalog.array_append(product_ids,reference_id);
    ELSE
      service_ids := pg_catalog.array_append(service_ids,reference_id);
    END IF;
  END LOOP;

  -- Catalog stability only: no stock reads/demand aggregation or BF181 replacement.
  -- Product anchors precede service rows; each set is locked in UUID order.
  PERFORM p.id FROM (
    SELECT id FROM public.products WHERE business_id = p_business_id AND id = ANY(product_ids)
    ORDER BY id FOR SHARE
  ) p;
  PERFORM s.id FROM (
    SELECT id FROM public.services WHERE business_id = p_business_id AND id = ANY(service_ids)
    ORDER BY id FOR SHARE
  ) s;
  IF NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Checkout access denied', DETAIL = 'CHECKOUT_ACCESS_DENIED';
  END IF;

  FOR line IN SELECT value FROM pg_catalog.jsonb_array_elements(p_items) LOOP
    reference_id := (line->>'itemId')::uuid;
    quantity_value := (line->>'quantity')::numeric;
    IF line->>'itemType' = 'SERVICE' THEN
      SELECT s.name,s.price,NULL::numeric INTO snapshot_name,price,cost FROM public.services s
      WHERE s.id = reference_id AND s.business_id = p_business_id AND s.is_active;
    ELSE
      SELECT p.name,p.sale_price,p.default_purchase_cost INTO snapshot_name,price,cost FROM public.products p
      WHERE p.id = reference_id AND p.business_id = p_business_id AND p.is_active;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
    END IF;
    IF line ? 'unitPriceOverride' THEN price := (line->>'unitPriceOverride')::numeric; END IF;
    gross := price * quantity_value;
    subtotal := subtotal + gross;
    IF price NOT BETWEEN 0 AND 9999999999.99 OR price = 'NaN'::numeric
       OR gross NOT BETWEEN 0 AND 9999999999.99 OR subtotal > 9999999999.99
       OR (cost IS NOT NULL AND (cost NOT BETWEEN 0 AND 9999999999.99 OR cost = 'NaN'::numeric)) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
    END IF;
    prepared := prepared || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'item_type',line->>'itemType','reference_id',reference_id,'name',snapshot_name,
      'price',price,'quantity',quantity_value,'gross',gross,'cost',cost));
  END LOOP;
  -- BF182 receives server-computed header amounts; do not silently repair them.
  IF subtotal <> sale.subtotal THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
  END IF;
  INSERT INTO public.sale_items(sale_id,item_type,service_id,product_id,item_name_snapshot,
    unit_price_snapshot,quantity,line_total,unit_cost_snapshot)
  SELECT sale.id,t->>'item_type',
    CASE WHEN t->>'item_type' = 'SERVICE' THEN (t->>'reference_id')::uuid END,
    CASE WHEN t->>'item_type' = 'PRODUCT' THEN (t->>'reference_id')::uuid END,
    t->>'name',(t->>'price')::numeric,(t->>'quantity')::integer,(t->>'gross')::numeric,(t->>'cost')::numeric
  FROM pg_catalog.jsonb_array_elements(prepared) t;
  IF NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Checkout access denied', DETAIL = 'CHECKOUT_ACCESS_DENIED';
  END IF;
  RETURN QUERY SELECT i.id,i.sale_id,i.item_type,i.service_id,i.product_id,
    i.item_name_snapshot,i.unit_price_snapshot,i.quantity,i.line_total,i.unit_cost_snapshot,i.created_at
    FROM public.sale_items i WHERE i.sale_id = sale.id ORDER BY i.created_at,i.id;
END;
$$;

REVOKE ALL ON FUNCTION private.persist_checkout_items(uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
