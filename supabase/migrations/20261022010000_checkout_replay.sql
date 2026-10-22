BEGIN;

-- BF187 internal gate, not the BF188 public checkout orchestrator. SQL NULL means
-- a new operation; the caller retains the advisory lock and must compose all
-- stages on this connection/transaction. A non-NULL outcome skips every stage.
CREATE FUNCTION private.get_checkout_replay(p_business_id uuid, p_operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  sale public.sales%ROWTYPE;
  items jsonb;
  payments jsonb;
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
  IF sale.id IS NULL THEN RETURN NULL; END IF;
  -- Last lock on replay. Do not acquire product/business/calendar/appointment
  -- locks: only read immutable history, never rerun stock or completion.
  PERFORM 1 FROM public.business_members m WHERE m.business_id=p_business_id
    AND m.user_id=auth.uid() AND m.role='OWNER' AND m.is_active FOR SHARE;
  IF NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Checkout access denied',DETAIL='CHECKOUT_ACCESS_DENIED';
  END IF;
  IF sale.status NOT IN ('COMPLETED','VOIDED') OR sale.sold_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
  END IF;
  IF (sale.client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.clients c
      WHERE c.id=sale.client_id AND c.business_id=p_business_id))
    OR (sale.appointment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.appointments a
      WHERE a.id=sale.appointment_id AND a.business_id=p_business_id
        AND a.client_id IS NOT DISTINCT FROM sale.client_id))
    OR EXISTS(SELECT 1 FROM public.sale_items i
      LEFT JOIN public.products p ON p.id=i.product_id
      LEFT JOIN public.services s ON s.id=i.service_id
      WHERE i.sale_id=sale.id AND
        ((i.item_type='PRODUCT' AND p.business_id IS DISTINCT FROM p_business_id)
         OR (i.item_type='SERVICE' AND s.business_id IS DISTINCT FROM p_business_id))) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Checkout access denied',DETAIL='CHECKOUT_ACCESS_DENIED';
  END IF;
  SELECT pg_catalog.count(*),pg_catalog.sum(i.line_total) INTO item_count,gross
    FROM public.sale_items i WHERE i.sale_id=sale.id;
  SELECT pg_catalog.count(*) INTO payment_count FROM public.payments p WHERE p.sale_id=sale.id;
  IF (sale.appointment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.appointments a
      WHERE a.id=sale.appointment_id AND a.status='COMPLETED'))
    OR item_count=0 OR gross IS DISTINCT FROM sale.subtotal
    OR (sale.total=0 AND payment_count<>0)
    OR (sale.total>0 AND (payment_count<>1 OR NOT EXISTS(SELECT 1 FROM public.payments p
      WHERE p.sale_id=sale.id AND p.business_id=p_business_id AND p.amount=sale.total)))
    OR EXISTS(SELECT 1 FROM public.stock_movements m WHERE m.reference_type='SALE'
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
    -- Includes missing/partial movements, even when the stored set is empty.
    -- Never repair a committed partial outcome or reprice from today's catalog.
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
  END IF;
  SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) ORDER BY i.created_at,i.id) INTO items
    FROM (SELECT id,sale_id,item_type,service_id,product_id,item_name_snapshot,
      unit_price_snapshot,quantity,line_total,unit_cost_snapshot,created_at
      FROM public.sale_items WHERE sale_id=sale.id) i;
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) ORDER BY p.paid_at,p.id),'[]'::jsonb)
    INTO payments FROM (SELECT id,business_id,sale_id,payment_method,amount,notes,paid_at,created_by,created_at
      FROM public.payments WHERE sale_id=sale.id) p;
  RETURN pg_catalog.jsonb_build_object('sale',pg_catalog.to_jsonb(sale),'items',items,'payments',payments);
END;
$$;
REVOKE ALL ON FUNCTION private.get_checkout_replay(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
