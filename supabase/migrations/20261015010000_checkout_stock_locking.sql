BEGIN;

-- Internal slice only: no checkout endpoint or SALE writes. The future atomic
-- writer calls this after its operation/parent locks, on the SAME transaction.
-- Arguments contain only PRODUCT lines; empty arrays support service-only sales.
CREATE FUNCTION private.lock_checkout_products(
  p_business_id uuid,
  p_product_ids uuid[],
  p_quantities integer[]
)
RETURNS TABLE (product_id uuid, requested_quantity bigint, current_stock bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  ids uuid[];
  quantities bigint[];
  target_id uuid;
  active boolean;
  balance bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Checkout access denied', DETAIL = 'CHECKOUT_ACCESS_DENIED';
  END IF;
  -- A lock does not refresh a repeatable-read ledger snapshot. VOLATILE gives
  -- the post-wait commands fresh READ COMMITTED snapshots, as in adjust_stock.
  IF pg_catalog.current_setting('transaction_isolation') NOT IN ('read committed', 'read uncommitted') THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Retry checkout in a fresh transaction';
  END IF;
  IF p_product_ids IS NULL OR p_quantities IS NULL
     OR pg_catalog.cardinality(p_product_ids) <> pg_catalog.cardinality(p_quantities)
     OR coalesce(pg_catalog.array_ndims(p_product_ids), 1) <> 1
     OR coalesce(pg_catalog.array_ndims(p_quantities), 1) <> 1
     OR pg_catalog.array_position(p_product_ids, NULL) IS NOT NULL
     OR pg_catalog.array_position(p_quantities, NULL) IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_quantities) AS q(quantity) WHERE q.quantity <= 0) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
  END IF;

  -- Aggregate duplicates before locking; ordinality pairs even non-1-based arrays.
  -- Keep bigint demand: individually valid int4 lines may sum beyond int4.
  SELECT coalesce(pg_catalog.array_agg(r.id ORDER BY r.id), ARRAY[]::uuid[]),
         coalesce(pg_catalog.array_agg(r.quantity ORDER BY r.id), ARRAY[]::bigint[])
    INTO ids, quantities
  FROM (
    SELECT i.id, pg_catalog.sum(q.quantity) AS quantity
    FROM pg_catalog.unnest(p_product_ids) WITH ORDINALITY AS i(id, ordinal)
    JOIN pg_catalog.unnest(p_quantities) WITH ORDINALITY AS q(quantity, ordinal) USING (ordinal)
    GROUP BY i.id
  ) AS r;

  -- Existing products anchor even a zero-row ledger. All anchors are acquired
  -- in UUID order BEFORE any balance read and remain held after this returns.
  FOREACH target_id IN ARRAY ids LOOP
    SELECT p.is_active INTO active FROM public.products AS p
    WHERE p.id = target_id AND p.business_id = p_business_id FOR UPDATE;
    IF NOT FOUND OR NOT active THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
    END IF;
  END LOOP;
  IF NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Checkout access denied', DETAIL = 'CHECKOUT_ACCESS_DENIED';
  END IF;

  FOR position IN 1..pg_catalog.cardinality(ids) LOOP
    SELECT coalesce(pg_catalog.sum(m.quantity_delta), 0::bigint) INTO balance
    FROM public.stock_movements AS m
    WHERE m.business_id = p_business_id AND m.product_id = ids[position];
    IF balance < quantities[position] THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Insufficient stock', DETAIL = 'INSUFFICIENT_STOCK';
    END IF;
    product_id := ids[position];
    requested_quantity := quantities[position];
    current_stock := balance;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Called only by the future authorized server writer, never as a separate
-- client RPC whose transaction would end before the SALE ledger append.
REVOKE ALL ON FUNCTION private.lock_checkout_products(uuid, uuid[], integer[])
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
