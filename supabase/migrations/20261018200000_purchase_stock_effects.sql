BEGIN;

-- Internal stage only. The future orchestrator must derive this flag while
-- holding the purchase operation lock: true ONLY for a parent it just created
-- in this transaction, false for an authorized replay. Never accept the flag
-- from the public caller or infer it from missing movements/timestamps/status.
-- BF213 -> BF214 -> BF215 must share one transaction/connection before BF216
-- exposes completion. This function neither creates expenses nor activates it.
CREATE FUNCTION private.persist_purchase_stock(
  p_business_id uuid,
  p_operation_id uuid,
  p_apply_initial_effects boolean
)
RETURNS SETOF public.stock_movements
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  purchase public.purchases%ROWTYPE;
  product_id uuid;
  product_active boolean;
  movement_count bigint;
BEGIN
  IF caller_id IS NULL OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Purchase access denied', DETAIL = 'ACCESS_DENIED';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') NOT IN ('read committed', 'read uncommitted') THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Retry purchase in a fresh transaction';
  END IF;
  IF p_operation_id IS NULL OR p_apply_initial_effects IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid purchase', DETAIL = 'INVALID_INPUT';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'barberflow:purchase:' || p_business_id::text || ':' || p_operation_id::text, 0));
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Purchase access denied', DETAIL = 'ACCESS_DENIED';
  END IF;
  SELECT p.id, p.business_id, p.operation_id, p.supplier, p.status, p.total,
         p.purchased_at, p.notes, p.created_by, p.created_at, p.updated_at
    INTO purchase
  FROM public.purchases AS p
  WHERE p.business_id = p_business_id AND p.operation_id = p_operation_id FOR UPDATE;
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Purchase access denied', DETAIL = 'ACCESS_DENIED';
  END IF;
  IF purchase.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid purchase', DETAIL = 'INVALID_INPUT';
  END IF;
  IF purchase.status NOT IN ('COMPLETED', 'VOIDED')
     OR (p_apply_initial_effects AND purchase.status <> 'COMPLETED') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Invalid purchase status', DETAIL = 'INVALID_STATUS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.purchase_items AS i WHERE i.purchase_id = purchase.id)
     OR (SELECT pg_catalog.sum(i.line_total) FROM public.purchase_items AS i
         WHERE i.purchase_id = purchase.id) IS DISTINCT FROM purchase.total
     OR EXISTS (
       SELECT i.product_id FROM public.purchase_items AS i WHERE i.purchase_id = purchase.id
       GROUP BY i.product_id HAVING pg_catalog.min(i.unit_cost_snapshot) <> pg_catalog.max(i.unit_cost_snapshot)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid purchase', DETAIL = 'INVALID_INPUT';
  END IF;

  -- Same product anchors/order as BF181/BF223, retained through the next stage.
  -- Replay does not require an active catalog, but still validates tenant IDs.
  FOR product_id IN SELECT DISTINCT i.product_id FROM public.purchase_items AS i
                    WHERE i.purchase_id = purchase.id ORDER BY i.product_id LOOP
    SELECT p.is_active INTO product_active FROM public.products AS p
    WHERE p.id = product_id AND p.business_id = p_business_id FOR UPDATE;
    IF NOT FOUND OR (p_apply_initial_effects AND NOT product_active) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid purchase', DETAIL = 'INVALID_INPUT';
    END IF;
  END LOOP;
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Purchase access denied', DETAIL = 'ACCESS_DENIED';
  END IF;

  SELECT pg_catalog.count(*) INTO movement_count FROM public.stock_movements AS m
  WHERE m.reference_type = 'PURCHASE' AND m.reference_id = purchase.id;
  IF p_apply_initial_effects THEN
    -- Even a complete set rejects NEW_OPERATION: reapplying reference cost
    -- would undo a later purchase. Only the replay branch can return history.
    IF movement_count <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid purchase', DETAIL = 'INVALID_INPUT';
    END IF;
    INSERT INTO public.stock_movements (business_id, product_id, type, quantity_delta,
      unit_cost, reference_type, reference_id, notes, created_by)
    SELECT p_business_id, i.product_id, 'PURCHASE', i.quantity,
      i.unit_cost_snapshot, 'PURCHASE', purchase.id, NULL, caller_id
    FROM public.purchase_items AS i WHERE i.purchase_id = purchase.id
    ORDER BY i.product_id, i.id;

    -- Equal-cost duplicates are validated above; MIN selects that common cost,
    -- never a last line or average. Serialized application, not purchased_at,
    -- determines precedence. Existing updated_at trigger remains authoritative.
    UPDATE public.products AS p SET default_purchase_cost = costs.unit_cost
    FROM (SELECT i.product_id, pg_catalog.min(i.unit_cost_snapshot) AS unit_cost
          FROM public.purchase_items AS i WHERE i.purchase_id = purchase.id
          GROUP BY i.product_id) AS costs
    WHERE p.id = costs.product_id AND p.business_id = p_business_id;
  ELSE
    -- Zero is incomplete history, not evidence of a newly created operation.
    -- Exact multiset comparison preserves duplicate lines without an item FK.
    IF movement_count = 0
       OR EXISTS (SELECT 1 FROM public.stock_movements AS m
         WHERE m.reference_type = 'PURCHASE' AND m.reference_id = purchase.id
           AND (m.business_id <> p_business_id OR m.type <> 'PURCHASE'))
       OR EXISTS (
         (SELECT i.product_id, i.quantity, i.unit_cost_snapshot FROM public.purchase_items AS i
            WHERE i.purchase_id = purchase.id
          EXCEPT ALL
          SELECT m.product_id, m.quantity_delta, m.unit_cost FROM public.stock_movements AS m
            WHERE m.reference_type = 'PURCHASE' AND m.reference_id = purchase.id)
         UNION ALL
         (SELECT m.product_id, m.quantity_delta, m.unit_cost FROM public.stock_movements AS m
            WHERE m.reference_type = 'PURCHASE' AND m.reference_id = purchase.id
          EXCEPT ALL
          SELECT i.product_id, i.quantity, i.unit_cost_snapshot FROM public.purchase_items AS i
            WHERE i.purchase_id = purchase.id)) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid purchase', DETAIL = 'INVALID_INPUT';
    END IF;
    -- A complete set witnesses this stage. Do not compare/reapply current cost:
    -- subsequent purchases or catalog edits can legitimately have replaced it.
  END IF;

  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Purchase access denied', DETAIL = 'ACCESS_DENIED';
  END IF;
  RETURN QUERY SELECT m.id, m.business_id, m.product_id, m.type, m.quantity_delta, m.unit_cost,
    m.reference_type, m.reference_id, m.notes, m.occurred_at, m.created_by, m.created_at
  FROM public.stock_movements AS m
  WHERE m.reference_type = 'PURCHASE' AND m.reference_id = purchase.id
  ORDER BY m.occurred_at, m.id;
END;
$$;

REVOKE ALL ON FUNCTION private.persist_purchase_stock(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
