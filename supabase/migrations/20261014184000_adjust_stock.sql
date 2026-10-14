BEGIN;

-- Operation IDs are scoped to this workflow and tenant, not to the whole ledger.
CREATE UNIQUE INDEX stock_movements_adjustment_operation_idx
  ON public.stock_movements (business_id, reference_id)
  WHERE reference_type = 'STOCK_ADJUSTMENT';

CREATE FUNCTION public.adjust_stock(
  p_business_id uuid,
  p_operation_id uuid,
  p_product_id uuid,
  p_quantity_delta integer,
  p_reason text,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  movement public.stock_movements%ROWTYPE;
  balance bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Inventory access denied';
  END IF;
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid stock adjustment';
  END IF;
  -- A product lock does not refresh a repeatable-read snapshot of its ledger.
  -- PostgREST uses READ COMMITTED; unsupported snapshots must fail before writes.
  IF pg_catalog.current_setting('transaction_isolation') NOT IN ('read committed', 'read uncommitted') THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Retry stock adjustment in a fresh transaction';
  END IF;

  -- Serialize the operation before the product, including retries with a changed
  -- payload/product. Hash collisions only add serialization, never authorization.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'barberflow:stock-adjustment:' || p_business_id::text || ':' || p_operation_id::text, 0));
  IF NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Inventory access denied';
  END IF;
  SELECT m.id, m.business_id, m.product_id, m.type, m.quantity_delta, m.unit_cost,
         m.reference_type, m.reference_id, m.notes, m.occurred_at, m.created_by, m.created_at
    INTO movement
  FROM public.stock_movements AS m
  WHERE m.business_id = p_business_id AND m.reference_type = 'STOCK_ADJUSTMENT'
    AND m.reference_id = p_operation_id;

  IF FOUND THEN
    -- Defend against a privileged legacy row with independently valid but mixed FKs.
    IF NOT EXISTS (SELECT 1 FROM public.products AS p
                   WHERE p.id = movement.product_id AND p.business_id = p_business_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Inventory access denied';
    END IF;
  ELSE
    IF p_product_id IS NULL OR p_quantity_delta IS NULL OR p_quantity_delta = 0
       OR p_reason IS NULL OR p_reason NOT IN ('LOSS', 'ADJUSTMENT')
       OR (p_reason = 'LOSS' AND p_quantity_delta >= 0) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid stock adjustment';
    END IF;
    -- The product anchors serialization even when it has no movements yet.
    -- Archived products are explicitly supported; no catalog fields are changed.
    PERFORM 1 FROM public.products AS p
    WHERE p.id = p_product_id AND p.business_id = p_business_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Product unavailable';
    END IF;
    IF NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Inventory access denied';
    END IF;
    SELECT coalesce(sum(m.quantity_delta), 0::bigint) INTO balance
    FROM public.stock_movements AS m
    WHERE m.business_id = p_business_id AND m.product_id = p_product_id;
    IF balance + p_quantity_delta::bigint < 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Insufficient stock', DETAIL = 'INSUFFICIENT_STOCK';
    END IF;
    INSERT INTO public.stock_movements (
      business_id, product_id, type, quantity_delta, unit_cost, reference_type, reference_id, notes, created_by
    ) VALUES (
      p_business_id, p_product_id, p_reason, p_quantity_delta, NULL,
      'STOCK_ADJUSTMENT', p_operation_id, p_notes, auth.uid()
    ) RETURNING id, business_id, product_id, type, quantity_delta, unit_cost,
                reference_type, reference_id, notes, occurred_at, created_by, created_at
      INTO movement;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'id', movement.id, 'business_id', movement.business_id, 'product_id', movement.product_id,
    'type', movement.type, 'quantity_delta', movement.quantity_delta, 'unit_cost', movement.unit_cost,
    'reference_type', movement.reference_type, 'reference_id', movement.reference_id, 'notes', movement.notes,
    'occurred_at', movement.occurred_at, 'created_by', movement.created_by, 'created_at', movement.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_stock(uuid, uuid, uuid, integer, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.adjust_stock(uuid, uuid, uuid, integer, text, text) TO authenticated;

COMMIT;
