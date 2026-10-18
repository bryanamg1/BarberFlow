BEGIN;

-- The only public purchase writer. All three private stages share the outer
-- RPC transaction; an exception must escape rather than expose partial success.
CREATE FUNCTION public.complete_purchase(
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
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  existing_id uuid;
  apply_initial_effects boolean;
  persisted jsonb;
  expense public.expenses%ROWTYPE;
BEGIN
  IF caller_id IS NULL OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Purchase access denied', DETAIL='ACCESS_DENIED';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Retry purchase in a fresh transaction';
  END IF;
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid purchase', DETAIL='INVALID_INPUT';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'barberflow:purchase:' || p_business_id::text || ':' || p_operation_id::text, 0));
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Purchase access denied', DETAIL='ACCESS_DENIED';
  END IF;

  SELECT p.id INTO existing_id FROM public.purchases AS p
    WHERE p.business_id=p_business_id AND p.operation_id=p_operation_id FOR UPDATE;
  -- Determine the signal BEFORE BF213 while retaining the operation lock.
  -- Missing effects never authorize repair of an existing parent.
  apply_initial_effects := existing_id IS NULL;
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Purchase access denied', DETAIL='ACCESS_DENIED';
  END IF;
  persisted := private.persist_purchase(p_business_id,p_operation_id,p_supplier,
    p_expense_category_id,p_payment_method,p_purchased_at,p_notes,p_items);
  PERFORM private.persist_purchase_stock(p_business_id,p_operation_id,apply_initial_effects);
  expense := private.persist_purchase_expense(p_business_id,p_operation_id,apply_initial_effects);
  IF auth.uid() IS DISTINCT FROM caller_id OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Purchase access denied', DETAIL='ACCESS_DENIED';
  END IF;
  -- BF213 already explicitly projects public11+8 (physical purchases has13).
  -- Explicit expense projection prevents future columns leaking into this API.
  RETURN pg_catalog.jsonb_build_object('purchase',persisted->'purchase','items',persisted->'items',
    'expense',pg_catalog.jsonb_build_object(
      'id',expense.id,'business_id',expense.business_id,'category_id',expense.category_id,
      'source_type',expense.source_type,'purchase_id',expense.purchase_id,'description',expense.description,
      'amount',expense.amount,'payment_method',expense.payment_method,'expense_date',expense.expense_date,
      'receipt_path',expense.receipt_path,'notes',expense.notes,'created_by',expense.created_by,
      'created_at',expense.created_at,'updated_at',expense.updated_at));
END;
$$;

REVOKE ALL ON FUNCTION public.complete_purchase(uuid,uuid,text,uuid,text,timestamptz,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.complete_purchase(uuid,uuid,text,uuid,text,timestamptz,text,jsonb)
  TO authenticated;

COMMIT;
