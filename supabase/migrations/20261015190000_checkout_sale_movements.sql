BEGIN;

-- Internal slice only: all checkout stages must share this transaction/connection.
-- One row per persisted PRODUCT item preserves duplicate lines and int4 deltas.
CREATE FUNCTION private.persist_checkout_stock(p_business_id uuid, p_operation_id uuid)
RETURNS SETOF public.stock_movements
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  sale public.sales%ROWTYPE;
  ids uuid[];
  quantities integer[];
  movement_count bigint;
  item_count bigint;
  payment_count bigint;
  gross numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Checkout access denied',DETAIL='CHECKOUT_ACCESS_DENIED';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Retry checkout in a fresh transaction';
  END IF;
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'barberflow:checkout:' || p_business_id::text || ':' || p_operation_id::text,0));
  IF NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Checkout access denied',DETAIL='CHECKOUT_ACCESS_DENIED';
  END IF;
  SELECT s.id,s.business_id,s.client_id,s.appointment_id,s.operation_id,s.status,
    s.subtotal,s.discount,s.total,s.sold_at,s.created_by,s.created_at,s.updated_at
    INTO sale FROM public.sales s
    WHERE s.business_id=p_business_id AND s.operation_id=p_operation_id FOR UPDATE;
  IF NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Checkout access denied',DETAIL='CHECKOUT_ACCESS_DENIED';
  END IF;
  IF sale.id IS NULL OR sale.status='DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
  END IF;
  IF (sale.client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.clients c
        WHERE c.id=sale.client_id AND c.business_id=p_business_id))
     OR (sale.appointment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.appointments a
        WHERE a.id=sale.appointment_id AND a.business_id=p_business_id))
     OR EXISTS(SELECT 1 FROM public.sale_items i JOIN public.products p ON p.id=i.product_id
        WHERE i.sale_id=sale.id AND i.item_type='PRODUCT' AND p.business_id<>p_business_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Checkout access denied',DETAIL='CHECKOUT_ACCESS_DENIED';
  END IF;
  SELECT pg_catalog.count(*) INTO movement_count FROM public.stock_movements m
    WHERE m.reference_type='SALE' AND m.reference_id=sale.id;
  IF movement_count>0 THEN
    -- Exact multiset equality, not just equal aggregate stock: duplicates and
    -- historical per-line cost are preserved. Never repair a partial legacy set.
    IF EXISTS(SELECT 1 FROM public.stock_movements m WHERE m.reference_type='SALE'
        AND m.reference_id=sale.id AND (m.business_id<>p_business_id OR m.type<>'SALE'))
      OR EXISTS(
        (SELECT i.product_id,-i.quantity,i.unit_cost_snapshot FROM public.sale_items i
          WHERE i.sale_id=sale.id AND i.item_type='PRODUCT'
         EXCEPT ALL
         SELECT m.product_id,m.quantity_delta,m.unit_cost FROM public.stock_movements m
          WHERE m.reference_type='SALE' AND m.reference_id=sale.id)
        UNION ALL
        (SELECT m.product_id,m.quantity_delta,m.unit_cost FROM public.stock_movements m
          WHERE m.reference_type='SALE' AND m.reference_id=sale.id
         EXCEPT ALL
         SELECT i.product_id,-i.quantity,i.unit_cost_snapshot FROM public.sale_items i
          WHERE i.sale_id=sale.id AND i.item_type='PRODUCT')) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
    END IF;
  ELSE
    IF sale.status<>'COMPLETED' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
    END IF;
    SELECT pg_catalog.count(*),pg_catalog.sum(i.line_total) INTO item_count,gross
      FROM public.sale_items i WHERE i.sale_id=sale.id;
    SELECT pg_catalog.count(*) INTO payment_count FROM public.payments p WHERE p.sale_id=sale.id;
    IF item_count=0 OR gross IS DISTINCT FROM sale.subtotal
       OR (sale.total=0 AND payment_count<>0)
       OR (sale.total>0 AND (payment_count<>1 OR NOT EXISTS(SELECT 1 FROM public.payments p
         WHERE p.sale_id=sale.id AND p.business_id=p_business_id AND p.amount=sale.total))) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
    END IF;
    SELECT coalesce(pg_catalog.array_agg(i.product_id ORDER BY i.product_id,i.id),ARRAY[]::uuid[]),
      coalesce(pg_catalog.array_agg(i.quantity ORDER BY i.product_id,i.id),ARRAY[]::integer[])
      INTO ids,quantities FROM public.sale_items i WHERE i.sale_id=sale.id AND i.item_type='PRODUCT';
    -- Reuse BF181, including duplicate demand aggregation, UUID lock order,
    -- post-wait OWNER checks and fresh ledger balances. Locks survive this call.
    PERFORM private.lock_checkout_products(p_business_id,ids,quantities);
    INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,unit_cost,
      reference_type,reference_id,notes,created_by)
      SELECT p_business_id,i.product_id,'SALE',-i.quantity,i.unit_cost_snapshot,
        'SALE',sale.id,NULL,auth.uid()
      FROM public.sale_items i WHERE i.sale_id=sale.id AND i.item_type='PRODUCT'
      ORDER BY i.product_id,i.id;
    IF NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Checkout access denied',DETAIL='CHECKOUT_ACCESS_DENIED';
    END IF;
  END IF;
  RETURN QUERY SELECT m.id,m.business_id,m.product_id,m.type,m.quantity_delta,m.unit_cost,
    m.reference_type,m.reference_id,m.notes,m.occurred_at,m.created_by,m.created_at
    FROM public.stock_movements m WHERE m.reference_type='SALE' AND m.reference_id=sale.id
    ORDER BY m.occurred_at,m.id;
END;
$$;
REVOKE ALL ON FUNCTION private.persist_checkout_stock(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
