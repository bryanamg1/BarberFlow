BEGIN;

-- BF188 is the only public checkout writer. Every stage shares the outer RPC
-- transaction; no header/items/payment/stock/completion can commit separately.
CREATE FUNCTION public.complete_checkout(
  p_business_id uuid,
  p_operation_id uuid,
  p_appointment_id uuid,
  p_client_id uuid,
  p_discount_amount numeric,
  p_payment_method text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  outcome jsonb;
  line jsonb;
  reference_id uuid;
  product_ids uuid[] := ARRAY[]::uuid[];
  quantities integer[] := ARRAY[]::integer[];
  service_ids uuid[] := ARRAY[]::uuid[];
  quantity_value numeric;
  price numeric;
  gross numeric;
  subtotal numeric := 0;
  appointment_status text;
  appointment_client uuid;
BEGIN
  -- BF187 authorizes before lookup, retains the operation lock and rejects
  -- incomplete history. Do not validate new input or current stock on replay.
  outcome := private.get_checkout_replay(p_business_id,p_operation_id);
  IF outcome IS NOT NULL THEN RETURN outcome; END IF;
  IF p_discount_amount IS NULL OR NOT (p_discount_amount BETWEEN 0 AND 9999999999.99
      AND p_discount_amount=pg_catalog.trunc(p_discount_amount,2))
    OR p_payment_method IS NULL OR p_payment_method NOT IN
      ('CASH','BANK_TRANSFER','DEBIT_CARD','CREDIT_CARD','DIGITAL_WALLET')
    OR pg_catalog.jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
  END IF;
  IF pg_catalog.jsonb_array_length(p_items)=0 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
  END IF;
  -- Only boundary parsing needed to acquire anchors/compute trusted amounts.
  -- BF183 remains the owner of item validation and snapshot persistence.
  FOR line IN SELECT value FROM pg_catalog.jsonb_array_elements(p_items) LOOP
    IF pg_catalog.jsonb_typeof(line) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
    END IF;
    IF line->>'itemType' IS NULL OR line->>'itemType' NOT IN ('SERVICE','PRODUCT')
      OR pg_catalog.jsonb_typeof(line->'itemId') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(line->'quantity') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
    END IF;
    reference_id := (line->>'itemId')::uuid;
    quantity_value := (line->>'quantity')::numeric;
    IF quantity_value NOT BETWEEN 1 AND 2147483647 OR quantity_value<>pg_catalog.trunc(quantity_value) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
    END IF;
    IF line ? 'unitPriceOverride' THEN
      IF pg_catalog.jsonb_typeof(line->'unitPriceOverride') IS DISTINCT FROM 'string'
        OR line->>'unitPriceOverride' !~ '^[0-9]+\.[0-9]{2}$' THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
      END IF;
      price := (line->>'unitPriceOverride')::numeric;
      IF price>9999999999.99 THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
      END IF;
    END IF;
    IF line->>'itemType'='PRODUCT' THEN
      product_ids:=pg_catalog.array_append(product_ids,reference_id);
      quantities:=pg_catalog.array_append(quantities,quantity_value::integer);
    ELSE
      service_ids:=pg_catalog.array_append(service_ids,reference_id);
    END IF;
  END LOOP;
  -- Match182: parent before financial business lock, both before product anchors.
  --182 retains ownership of eligibility/client checks and sale persistence.
  IF p_appointment_id IS NOT NULL THEN
    SELECT a.status,a.client_id INTO appointment_status,appointment_client FROM public.appointments a
      WHERE a.id=p_appointment_id AND a.business_id=p_business_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
    END IF;
    IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Checkout access denied',DETAIL='CHECKOUT_ACCESS_DENIED';
    END IF;
    -- Preflight eligibility before stock so a consumed/terminal appointment is
    -- never misreported as insufficient stock. BF182 still rechecks/persists.
    IF appointment_status NOT IN ('PENDING','CONFIRMED','IN_PROGRESS')
      OR EXISTS(SELECT 1 FROM public.sales s WHERE s.business_id=p_business_id
        AND s.appointment_id=p_appointment_id AND s.status IN ('COMPLETED','VOIDED')) THEN
      RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Appointment is not eligible for checkout',DETAIL='INVALID_APPOINTMENT_STATUS';
    END IF;
    IF p_client_id IS NOT NULL AND p_client_id IS DISTINCT FROM appointment_client THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
    END IF;
  END IF;
  IF p_client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.clients c
    WHERE c.id=p_client_id AND c.business_id=p_business_id) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
  END IF;
  PERFORM b.id FROM public.businesses b WHERE b.id=p_business_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Checkout access denied',DETAIL='CHECKOUT_ACCESS_DENIED';
  END IF;
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Checkout access denied',DETAIL='CHECKOUT_ACCESS_DENIED';
  END IF;
  PERFORM private.lock_checkout_products(p_business_id,product_ids,quantities);
  PERFORM s.id FROM public.services s WHERE s.business_id=p_business_id AND s.id=ANY(service_ids)
    ORDER BY s.id FOR SHARE;
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Checkout access denied',DETAIL='CHECKOUT_ACCESS_DENIED';
  END IF;
  FOR line IN SELECT value FROM pg_catalog.jsonb_array_elements(p_items) LOOP
    reference_id := (line->>'itemId')::uuid;
    IF line->>'itemType'='PRODUCT' THEN
      SELECT p.sale_price INTO price FROM public.products p
        WHERE p.id=reference_id AND p.business_id=p_business_id AND p.is_active;
    ELSE
      SELECT s.price INTO price FROM public.services s
        WHERE s.id=reference_id AND s.business_id=p_business_id AND s.is_active;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
    END IF;
    IF line ? 'unitPriceOverride' THEN price := (line->>'unitPriceOverride')::numeric; END IF;
    gross:=price*(line->>'quantity')::numeric;
    subtotal:=subtotal+gross;
    IF gross NOT BETWEEN 0 AND 9999999999.99 OR subtotal>9999999999.99 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
    END IF;
  END LOOP;
  IF p_discount_amount>subtotal THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
  END IF;
  PERFORM private.persist_checkout_sale(p_business_id,p_operation_id,p_appointment_id,p_client_id,
    subtotal,p_discount_amount,subtotal-p_discount_amount);
  PERFORM private.persist_checkout_items(p_business_id,p_operation_id,p_items);
  PERFORM private.persist_checkout_payment(p_business_id,p_operation_id,p_payment_method);
  PERFORM private.persist_checkout_stock(p_business_id,p_operation_id);
  IF p_appointment_id IS NOT NULL THEN
    PERFORM private.complete_checkout_appointment(p_business_id,p_operation_id);
  END IF;
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Checkout access denied',DETAIL='CHECKOUT_ACCESS_DENIED';
  END IF;
  -- Same result builder for first execution and replay, including final history
  -- consistency checks. Any failure here rolls back all stages as well.
  RETURN private.get_checkout_replay(p_business_id,p_operation_id);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range
  OR check_violation OR foreign_key_violation OR not_null_violation THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
END;
$$;
REVOKE ALL ON FUNCTION public.complete_checkout(uuid,uuid,uuid,uuid,numeric,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.complete_checkout(uuid,uuid,uuid,uuid,numeric,text,jsonb)
  TO authenticated;

COMMIT;
