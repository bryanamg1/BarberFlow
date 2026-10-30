BEGIN;

CREATE TABLE private.sale_voids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, operation_id),
  UNIQUE (sale_id)
);
ALTER TABLE private.sale_voids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.sale_voids FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.prevent_sale_void_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Sale voids are immutable';
END;
$$;
REVOKE ALL ON FUNCTION private.prevent_sale_void_changes() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER sale_voids_append_only BEFORE UPDATE OR DELETE ON private.sale_voids
  FOR EACH ROW EXECUTE FUNCTION private.prevent_sale_void_changes();

-- One read-only snapshot for both public boundaries. No client EXECUTE or
-- private table access. Authorization belongs to the two public entry points.
CREATE FUNCTION private.read_sale_void_history(p_business_id uuid, p_sale_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  sale public.sales%ROWTYPE;
  correction private.sale_voids%ROWTYPE;
  result_items jsonb;
  result_payments jsonb;
  result_movements jsonb;
BEGIN
  SELECT s.* INTO sale FROM public.sales s WHERE s.id=p_sale_id AND s.business_id=p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='PT404', MESSAGE='Sale not found', DETAIL='NOT_FOUND';
  END IF;
  SELECT v.* INTO correction FROM private.sale_voids v WHERE v.sale_id=sale.id;
  IF sale.status NOT IN ('COMPLETED','VOIDED') OR sale.sold_at IS NULL
    OR (sale.status='COMPLETED' AND correction.id IS NOT NULL)
    OR (sale.status='VOIDED' AND correction.id IS NULL)
    OR (correction.id IS NOT NULL AND correction.business_id<>p_business_id)
    OR (sale.client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.clients c
      WHERE c.id=sale.client_id AND c.business_id=p_business_id))
    OR (sale.appointment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.appointments a
      WHERE a.id=sale.appointment_id AND a.business_id=p_business_id AND a.status='COMPLETED'
        AND a.client_id IS NOT DISTINCT FROM sale.client_id))
    OR NOT EXISTS(SELECT 1 FROM public.sale_items i WHERE i.sale_id=sale.id)
    OR (SELECT pg_catalog.sum(i.line_total) FROM public.sale_items i WHERE i.sale_id=sale.id) IS DISTINCT FROM sale.subtotal
    OR EXISTS(SELECT 1 FROM public.sale_items i
      LEFT JOIN public.products p ON p.id=i.product_id LEFT JOIN public.services s ON s.id=i.service_id
      WHERE i.sale_id=sale.id AND ((i.item_type='PRODUCT' AND p.business_id IS DISTINCT FROM p_business_id)
        OR (i.item_type='SERVICE' AND s.business_id IS DISTINCT FROM p_business_id)))
    OR (sale.total=0 AND EXISTS(SELECT 1 FROM public.payments p WHERE p.sale_id=sale.id))
    OR (sale.total>0 AND ((SELECT pg_catalog.count(*) FROM public.payments p WHERE p.sale_id=sale.id)<>1
      OR NOT EXISTS(SELECT 1 FROM public.payments p WHERE p.sale_id=sale.id
        AND p.business_id=p_business_id AND p.amount=sale.total)))
    OR EXISTS(SELECT 1 FROM public.stock_movements m WHERE m.reference_type='SALE' AND m.reference_id=sale.id
      AND (m.business_id<>p_business_id OR m.type<>'SALE' OR m.created_by<>sale.created_by OR m.notes IS NOT NULL))
    OR EXISTS(
      (SELECT i.product_id,-i.quantity,i.unit_cost_snapshot FROM public.sale_items i WHERE i.sale_id=sale.id AND i.item_type='PRODUCT'
       EXCEPT ALL
       SELECT m.product_id,m.quantity_delta,m.unit_cost FROM public.stock_movements m WHERE m.reference_type='SALE' AND m.reference_id=sale.id)
      UNION ALL
      (SELECT m.product_id,m.quantity_delta,m.unit_cost FROM public.stock_movements m WHERE m.reference_type='SALE' AND m.reference_id=sale.id
       EXCEPT ALL
       SELECT i.product_id,-i.quantity,i.unit_cost_snapshot FROM public.sale_items i WHERE i.sale_id=sale.id AND i.item_type='PRODUCT')) THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Incomplete sale history', DETAIL='INCOMPLETE_HISTORY';
  END IF;
  IF correction.id IS NOT NULL AND (
    EXISTS(SELECT 1 FROM public.stock_movements m WHERE m.reference_type='SALE_VOID' AND m.reference_id=correction.id
      AND (m.business_id<>p_business_id OR m.type<>'RETURN' OR m.created_by<>correction.created_by
        OR m.notes IS NOT NULL OR m.occurred_at<>correction.created_at OR m.created_at<>correction.created_at))
    OR EXISTS(
      (SELECT i.product_id,i.quantity,i.unit_cost_snapshot FROM public.sale_items i WHERE i.sale_id=sale.id AND i.item_type='PRODUCT'
       EXCEPT ALL
       SELECT m.product_id,m.quantity_delta,m.unit_cost FROM public.stock_movements m WHERE m.reference_type='SALE_VOID' AND m.reference_id=correction.id)
      UNION ALL
      (SELECT m.product_id,m.quantity_delta,m.unit_cost FROM public.stock_movements m WHERE m.reference_type='SALE_VOID' AND m.reference_id=correction.id
       EXCEPT ALL
       SELECT i.product_id,i.quantity,i.unit_cost_snapshot FROM public.sale_items i WHERE i.sale_id=sale.id AND i.item_type='PRODUCT'))
    ) THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Incomplete sale history', DETAIL='INCOMPLETE_HISTORY';
  END IF;
  SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) ORDER BY i.created_at,i.id) INTO result_items
    FROM (SELECT id,sale_id,item_type,service_id,product_id,item_name_snapshot,
      unit_price_snapshot,quantity,line_total,unit_cost_snapshot,created_at FROM public.sale_items WHERE sale_id=sale.id) i;
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) ORDER BY p.paid_at,p.id),'[]'::jsonb) INTO result_payments
    FROM (SELECT id,business_id,sale_id,payment_method,amount,notes,paid_at,created_by,created_at FROM public.payments WHERE sale_id=sale.id) p;
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) ORDER BY m.created_at,m.id),'[]'::jsonb) INTO result_movements
    FROM (SELECT id,business_id,product_id,type,quantity_delta,unit_cost,reference_type,reference_id,notes,occurred_at,created_by,created_at
      FROM public.stock_movements WHERE reference_type='SALE_VOID' AND reference_id=correction.id) m;
  RETURN pg_catalog.jsonb_build_object(
    'sale',pg_catalog.jsonb_build_object('id',sale.id,'business_id',sale.business_id,'client_id',sale.client_id,
      'appointment_id',sale.appointment_id,'operation_id',sale.operation_id,'status',sale.status,'subtotal',sale.subtotal,
      'discount',sale.discount,'total',sale.total,'sold_at',sale.sold_at,'created_by',sale.created_by,'created_at',sale.created_at,'updated_at',sale.updated_at),
    'items',result_items,'payments',result_payments,
    'correction',CASE WHEN correction.id IS NULL THEN NULL ELSE pg_catalog.to_jsonb(correction) END,
    'stockMovements',result_movements);
END;
$$;
REVOKE ALL ON FUNCTION private.read_sale_void_history(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.void_sale(p_business_id uuid, p_operation_id uuid, p_sale_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller_id uuid := auth.uid();
  completion_id uuid;
  sale public.sales%ROWTYPE;
  correction private.sale_voids%ROWTYPE;
  outcome jsonb;
BEGIN
  IF caller_id IS NULL OR NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Sale access denied', DETAIL='ACCESS_DENIED';
  END IF;
  IF p_business_id IS NULL OR p_operation_id IS NULL OR p_sale_id IS NULL
    OR p_reason IS NULL OR pg_catalog.btrim(p_reason)='' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid void input', DETAIL='INVALID_INPUT';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Retry void in a fresh transaction';
  END IF;
  -- Same established pattern as purchase corrections: distinct correction and
  -- checkout domains, then parent, products UUID ASC, membership last.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'barberflow:sale-void:'||p_business_id::text||':'||p_operation_id::text,0));
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Sale access denied', DETAIL='ACCESS_DENIED';
  END IF;
  SELECT s.operation_id INTO completion_id FROM public.sales s WHERE s.id=p_sale_id AND s.business_id=p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='PT404', MESSAGE='Sale not found', DETAIL='NOT_FOUND';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'barberflow:checkout:'||p_business_id::text||':'||completion_id::text,0));
  SELECT s.* INTO sale FROM public.sales s WHERE s.id=p_sale_id AND s.business_id=p_business_id FOR UPDATE;
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Sale access denied', DETAIL='ACCESS_DENIED';
  END IF;
  IF sale.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='PT404', MESSAGE='Sale not found', DETAIL='NOT_FOUND';
  END IF;
  IF sale.operation_id IS DISTINCT FROM completion_id THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Retry void in a fresh transaction';
  END IF;
  SELECT v.* INTO correction FROM private.sale_voids v WHERE v.business_id=p_business_id AND v.operation_id=p_operation_id;
  IF correction.id IS NOT NULL AND (correction.sale_id<>p_sale_id OR correction.reason<>p_reason) THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Void operation conflict', DETAIL='CONFLICT';
  END IF;
  IF sale.status NOT IN ('COMPLETED','VOIDED') THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Invalid sale status', DETAIL='INVALID_STATUS';
  END IF;
  PERFORM p.id FROM public.products p WHERE p.business_id=p_business_id
    AND p.id IN (SELECT i.product_id FROM public.sale_items i WHERE i.sale_id=sale.id AND i.item_type='PRODUCT')
    ORDER BY p.id FOR UPDATE;
  PERFORM 1 FROM public.business_members m WHERE m.business_id=p_business_id AND m.user_id=caller_id
    AND m.role='OWNER' AND m.is_active FOR SHARE;
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Sale access denied', DETAIL='ACCESS_DENIED';
  END IF;
  outcome := private.read_sale_void_history(p_business_id,p_sale_id);
  IF sale.status='VOIDED' THEN
    IF correction.id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Invalid sale status', DETAIL='INVALID_STATUS';
    END IF;
    RETURN outcome;
  END IF;
  INSERT INTO private.sale_voids(business_id,sale_id,operation_id,reason,created_by)
    VALUES(p_business_id,p_sale_id,p_operation_id,p_reason,caller_id) RETURNING * INTO correction;
  INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,unit_cost,
    reference_type,reference_id,notes,occurred_at,created_by,created_at)
    SELECT p_business_id,i.product_id,'RETURN',i.quantity,i.unit_cost_snapshot,
      'SALE_VOID',correction.id,NULL,correction.created_at,caller_id,correction.created_at
    FROM public.sale_items i WHERE i.sale_id=p_sale_id AND i.item_type='PRODUCT' ORDER BY i.id;
  UPDATE public.sales s SET status='VOIDED' WHERE s.id=p_sale_id;
  RETURN private.read_sale_void_history(p_business_id,p_sale_id);
END;
$$;
REVOKE ALL ON FUNCTION public.void_sale(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.void_sale(uuid,uuid,uuid,text) TO authenticated;

CREATE FUNCTION public.get_sale_correction_detail(p_business_id uuid, p_sale_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  outcome jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Sale access denied', DETAIL='ACCESS_DENIED';
  END IF;
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid sale input', DETAIL='INVALID_INPUT';
  END IF;
  outcome := private.read_sale_void_history(p_business_id,p_sale_id);
  RETURN pg_catalog.jsonb_build_object('correction',outcome->'correction','stockMovements',outcome->'stockMovements');
END;
$$;
REVOKE ALL ON FUNCTION public.get_sale_correction_detail(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_sale_correction_detail(uuid,uuid) TO authenticated;

COMMIT;
