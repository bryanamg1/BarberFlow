BEGIN;

CREATE TABLE private.purchase_voids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, operation_id),
  UNIQUE (purchase_id)
);
ALTER TABLE private.purchase_voids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.purchase_voids FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.prevent_purchase_void_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Purchase voids are immutable';
END;
$$;
REVOKE ALL ON FUNCTION private.prevent_purchase_void_changes() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER purchase_voids_append_only BEFORE UPDATE OR DELETE ON private.purchase_voids
  FOR EACH ROW EXECUTE FUNCTION private.prevent_purchase_void_changes();

CREATE FUNCTION public.void_purchase(
  p_business_id uuid, p_operation_id uuid, p_purchase_id uuid, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller_id uuid := auth.uid();
  completion_id uuid;
  purchase public.purchases%ROWTYPE;
  expense public.expenses%ROWTYPE;
  correction private.purchase_voids%ROWTYPE;
  target_correction private.purchase_voids%ROWTYPE;
  locked_product_id uuid;
  result_items jsonb;
  result_movements jsonb;
BEGIN
  IF caller_id IS NULL OR NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Purchase access denied', DETAIL='ACCESS_DENIED';
  END IF;
  IF p_business_id IS NULL OR p_operation_id IS NULL OR p_purchase_id IS NULL
     OR p_reason IS NULL OR pg_catalog.btrim(p_reason)='' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid void input', DETAIL='INVALID_INPUT';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Retry void in a fresh transaction';
  END IF;
  -- Separate domain: equality with a completion UUID is valid.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'barberflow:purchase-void:'||p_business_id::text||':'||p_operation_id::text,0));
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Purchase access denied', DETAIL='ACCESS_DENIED';
  END IF;
  SELECT p.operation_id INTO completion_id FROM public.purchases p
    WHERE p.id=p_purchase_id AND p.business_id=p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Purchase access denied', DETAIL='ACCESS_DENIED';
  END IF;
  -- Match BF216: completion operation BEFORE parent/products, never inverse.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'barberflow:purchase:'||p_business_id::text||':'||completion_id::text,0));
  SELECT p.* INTO purchase FROM public.purchases p
    WHERE p.id=p_purchase_id AND p.business_id=p_business_id FOR UPDATE;
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Purchase access denied', DETAIL='ACCESS_DENIED';
  END IF;
  IF purchase.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Purchase access denied', DETAIL='ACCESS_DENIED';
  END IF;
  IF purchase.operation_id IS DISTINCT FROM completion_id THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Retry void in a fresh transaction';
  END IF;
  SELECT v.* INTO correction FROM private.purchase_voids v
    WHERE v.business_id=p_business_id AND v.operation_id=p_operation_id;
  IF correction.id IS NOT NULL AND (correction.purchase_id<>p_purchase_id OR correction.reason<>p_reason) THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Void operation conflict', DETAIL='CONFLICT';
  END IF;
  SELECT v.* INTO target_correction FROM private.purchase_voids v WHERE v.purchase_id=p_purchase_id;
  IF purchase.status='DRAFT' AND target_correction.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Invalid purchase status', DETAIL='INVALID_STATUS';
  END IF;
  IF (purchase.status='VOIDED' AND target_correction.id IS NULL)
     OR (purchase.status<>'VOIDED' AND target_correction.id IS NOT NULL)
     OR (target_correction.id IS NOT NULL AND target_correction.business_id<>p_business_id) THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Incomplete purchase history', DETAIL='INCOMPLETE_HISTORY';
  END IF;

  -- Read-only historical validation also takes all product locks UUID ASC,
  -- then category/expense, exactly as BF214/215. Never apply initial effects.
  BEGIN
    expense := private.persist_purchase_expense(p_business_id,completion_id,false);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Incomplete purchase history', DETAIL='INCOMPLETE_HISTORY';
  END;
  IF EXISTS (SELECT 1 FROM public.stock_movements m
      WHERE m.reference_type='PURCHASE' AND m.reference_id=purchase.id
        AND (m.created_by<>purchase.created_by OR m.notes IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Incomplete purchase history', DETAIL='INCOMPLETE_HISTORY';
  END IF;

  IF target_correction.id IS NOT NULL THEN
    -- Validate even when a different key requests an already-voided target.
    IF EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.reference_id=target_correction.id AND m.reference_type='PURCHASE_VOID'
        AND (m.business_id<>p_business_id OR m.type<>'ADJUSTMENT'
          OR m.created_by<>target_correction.created_by OR m.notes IS NOT NULL
          OR m.occurred_at<>target_correction.created_at OR m.created_at<>target_correction.created_at))
       OR EXISTS (
         (SELECT i.product_id,-i.quantity,i.unit_cost_snapshot FROM public.purchase_items i WHERE i.purchase_id=purchase.id
          EXCEPT ALL
          SELECT m.product_id,m.quantity_delta,m.unit_cost FROM public.stock_movements m WHERE m.reference_id=target_correction.id AND m.reference_type='PURCHASE_VOID')
         UNION ALL
         (SELECT m.product_id,m.quantity_delta,m.unit_cost FROM public.stock_movements m WHERE m.reference_id=target_correction.id AND m.reference_type='PURCHASE_VOID'
          EXCEPT ALL
          SELECT i.product_id,-i.quantity,i.unit_cost_snapshot FROM public.purchase_items i WHERE i.purchase_id=purchase.id)) THEN
      RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Incomplete purchase history', DETAIL='INCOMPLETE_HISTORY';
    END IF;
    IF correction.id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Invalid purchase status', DETAIL='INVALID_STATUS';
    END IF;
  ELSE
    IF purchase.status<>'COMPLETED' THEN
      RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Invalid purchase status', DETAIL='INVALID_STATUS';
    END IF;
    -- Product locks are retained. Each fresh READ COMMITTED statement observes
    -- earlier committed stock writers; sum in bigint, not per-line arithmetic.
    FOR locked_product_id IN SELECT DISTINCT i.product_id FROM public.purchase_items i
      WHERE i.purchase_id=purchase.id ORDER BY i.product_id LOOP
      IF (SELECT coalesce(pg_catalog.sum(m.quantity_delta),0) FROM public.stock_movements m
          WHERE m.business_id=p_business_id AND m.product_id=locked_product_id)
         < (SELECT pg_catalog.sum(i.quantity) FROM public.purchase_items i
          WHERE i.purchase_id=purchase.id AND i.product_id=locked_product_id) THEN
        RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Insufficient stock', DETAIL='INSUFFICIENT_STOCK';
      END IF;
    END LOOP;
    IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Purchase access denied', DETAIL='ACCESS_DENIED';
    END IF;
    INSERT INTO private.purchase_voids(business_id,purchase_id,operation_id,reason,created_by)
      VALUES(p_business_id,purchase.id,p_operation_id,p_reason,caller_id) RETURNING * INTO correction;
    INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,unit_cost,
      reference_type,reference_id,notes,occurred_at,created_by,created_at)
      SELECT p_business_id,i.product_id,'ADJUSTMENT',-i.quantity,i.unit_cost_snapshot,
        'PURCHASE_VOID',correction.id,NULL,correction.created_at,caller_id,correction.created_at
      FROM public.purchase_items i WHERE i.purchase_id=purchase.id ORDER BY i.id;
    UPDATE public.purchases p SET status='VOIDED' WHERE p.id=purchase.id
      RETURNING p.* INTO purchase;
  END IF;
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Purchase access denied', DETAIL='ACCESS_DENIED';
  END IF;
  -- Historical expense remains immutable. Effective readers exclude it through
  -- its VOIDED parent in the ORIGINAL expense_date period, never via a refund.
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',i.id,'purchase_id',i.purchase_id,
    'product_id',i.product_id,'product_name_snapshot',i.product_name_snapshot,'quantity',i.quantity,
    'unit_cost_snapshot',i.unit_cost_snapshot,'line_total',i.line_total,'created_at',i.created_at) ORDER BY i.id)
    INTO result_items FROM public.purchase_items i WHERE i.purchase_id=purchase.id;
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',m.id,'business_id',m.business_id,'product_id',m.product_id,
    'type',m.type,'quantity_delta',m.quantity_delta,'unit_cost',m.unit_cost,'reference_type',m.reference_type,
    'reference_id',m.reference_id,'notes',m.notes,'occurred_at',m.occurred_at,'created_by',m.created_by,'created_at',m.created_at) ORDER BY m.id)
    INTO result_movements FROM public.stock_movements m
    WHERE m.reference_type='PURCHASE_VOID' AND m.reference_id=correction.id;
  RETURN pg_catalog.jsonb_build_object(
    'purchase',pg_catalog.jsonb_build_object('id',purchase.id,'business_id',purchase.business_id,'operation_id',purchase.operation_id,
      'supplier',purchase.supplier,'status',purchase.status,'total',purchase.total,'purchased_at',purchase.purchased_at,
      'notes',purchase.notes,'created_by',purchase.created_by,'created_at',purchase.created_at,'updated_at',purchase.updated_at),
    'items',result_items,
    'expense',pg_catalog.jsonb_build_object('id',expense.id,'business_id',expense.business_id,'category_id',expense.category_id,
      'source_type',expense.source_type,'purchase_id',expense.purchase_id,'description',expense.description,'amount',expense.amount,
      'payment_method',expense.payment_method,'expense_date',expense.expense_date,'receipt_path',expense.receipt_path,
      'notes',expense.notes,'created_by',expense.created_by,'created_at',expense.created_at,'updated_at',expense.updated_at),
    'correction',pg_catalog.jsonb_build_object('id',correction.id,'business_id',correction.business_id,'purchase_id',correction.purchase_id,
      'operation_id',correction.operation_id,'reason',correction.reason,'created_by',correction.created_by,'created_at',correction.created_at),
    'stockMovements',result_movements);
END;
$$;
REVOKE ALL ON FUNCTION public.void_purchase(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.void_purchase(uuid,uuid,uuid,text) TO authenticated;

COMMIT;
