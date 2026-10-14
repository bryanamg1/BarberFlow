\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  b uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid()];
  u uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 6));
  p uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 5));
  op uuid := gen_random_uuid();
  result jsonb;
  original jsonb;
  products_before jsonb;
  history_before jsonb;
  old_count bigint;
  actual_stock text;
  rpc record;
  item record;
  actor integer;
  i integer;
  state text;
  message text;
  detail text;
  checks integer := 0;
BEGIN
  SELECT * INTO STRICT rpc FROM pg_proc
  WHERE oid = 'public.adjust_stock(uuid,uuid,uuid,integer,text,text)'::regprocedure;
  IF NOT rpc.prosecdef OR rpc.provolatile <> 'v' OR rpc.proretset OR rpc.pronargs <> 6
     OR rpc.pronargdefaults <> 0 OR rpc.prorettype <> 'jsonb'::regtype
     OR rpc.proowner <> 'postgres'::regrole
     OR rpc.proargnames IS DISTINCT FROM ARRAY['p_business_id','p_operation_id','p_product_id','p_quantity_delta','p_reason','p_notes']::text[]
     OR rpc.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR NOT has_function_privilege('authenticated', rpc.oid, 'EXECUTE')
     OR has_function_privilege('anon', rpc.oid, 'EXECUTE')
     OR has_function_privilege('service_role', rpc.oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM aclexplode(rpc.proacl) a
                WHERE a.grantee NOT IN (rpc.proowner, 'authenticated'::regrole) OR a.is_grantable) THEN
    RAISE EXCEPTION 'BF223 unsafe signature/security/ACL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index ix JOIN pg_class c ON c.oid = ix.indexrelid
    WHERE c.relname = 'stock_movements_adjustment_operation_idx' AND ix.indisunique
      AND ix.indrelid = 'public.stock_movements'::regclass
      AND pg_get_indexdef(ix.indexrelid) LIKE '%(business_id, reference_id) WHERE (reference_type = ''STOCK_ADJUSTMENT''::text)') THEN
    RAISE EXCEPTION 'BF223 exact scoped idempotency index missing';
  END IF;
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') <> 19
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind = 'r' AND (NOT c.relrowsecurity OR c.relforcerowsecurity))
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') <> 41
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stock_movements') <> 12
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.stock_movements'::regclass AND NOT tgisinternal) <> 1 THEN
    RAISE EXCEPTION 'BF223 changed schema/RLS/policies/append-only baseline';
  END IF;
  checks := checks + 3;

  INSERT INTO auth.users (id) SELECT unnest(u);
  INSERT INTO public.businesses (id, name) VALUES (b[1], 'BF223 A'), (b[2], 'BF223 B');
  INSERT INTO public.business_members (business_id, user_id, role, is_active) VALUES
    (b[1], u[1], 'OWNER', true), (b[2], u[1], 'OWNER', true),
    (b[1], u[2], 'BARBER', true), (b[2], u[3], 'OWNER', true),
    (b[1], u[5], 'OWNER', false), (b[1], u[6], 'OWNER', true);
  FOR i IN 1..5 LOOP
    INSERT INTO public.products (id, business_id, name, sale_price, default_purchase_cost, is_active)
    VALUES (p[i], b[CASE WHEN i = 3 THEN 2 ELSE 1 END], 'BF223 ' || i, 10, 4, i <> 2);
  END LOOP;
  INSERT INTO public.stock_movements (business_id, product_id, type, quantity_delta, created_by) VALUES
    (b[1], p[4], 'SALE', -5, u[1]),
    (b[1], p[5], 'PURCHASE', 2147483647, u[1]), (b[1], p[5], 'PURCHASE', 2147483647, u[1]),
    -- A legacy inconsistent row must not contaminate the tenant's balance.
    (b[2], p[1], 'ADJUSTMENT', 9999, u[1]);
  SELECT jsonb_agg(to_jsonb(t) ORDER BY id) INTO products_before FROM public.products t;
  SELECT jsonb_agg(to_jsonb(t) ORDER BY id) INTO history_before FROM public.stock_movements t;
  SELECT count(*) INTO old_count FROM public.stock_movements;

  -- Both the exposed grant and internal identity check are required.
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.adjust_stock(b[1], op, p[1], 1, 'ADJUSTMENT', NULL);
    RAISE EXCEPTION 'Anon accepted';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.adjust_stock(b[1], op, p[1], 1, 'ADJUSTMENT', NULL);
    RAISE EXCEPTION 'Missing identity accepted';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1; END;
  RESET ROLE;

  FOR actor IN 2..5 LOOP
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', u[actor], 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.adjust_stock(b[1], op, p[1], 1, 'ADJUSTMENT', NULL);
      RAISE EXCEPTION 'Unauthorized actor accepted';
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS message = MESSAGE_TEXT;
      IF message <> 'Inventory access denied' THEN RAISE EXCEPTION 'Unsafe access message'; END IF;
      checks := checks + 1;
    END;
    RESET ROLE;
  END LOOP;
  IF (SELECT count(*) FROM public.stock_movements) <> old_count THEN RAISE EXCEPTION 'Denied operation wrote data'; END IF;
  checks := checks + 1;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  FOR item IN SELECT * FROM (VALUES
    (NULL::uuid, p[1], 1, 'ADJUSTMENT'::text),
    (gen_random_uuid(), NULL, 1, 'ADJUSTMENT'),
    (gen_random_uuid(), p[1], NULL, 'ADJUSTMENT'),
    (gen_random_uuid(), p[1], 0, 'ADJUSTMENT'),
    (gen_random_uuid(), p[1], 1, NULL),
    (gen_random_uuid(), p[1], 1, 'LOSS'),
    (gen_random_uuid(), p[1], 0, 'LOSS'),
    (gen_random_uuid(), p[1], 1, 'SALE'),
    (gen_random_uuid(), p[1], 1, 'adjustment'),
    (gen_random_uuid(), p[1], 1, ' ADJUSTMENT ')
  ) t(operation_id, product_id, delta, reason) LOOP
    BEGIN
      PERFORM public.adjust_stock(b[1], item.operation_id, item.product_id, item.delta, item.reason, NULL);
      RAISE EXCEPTION 'Invalid input accepted';
    EXCEPTION WHEN invalid_parameter_value THEN checks := checks + 1; END;
  END LOOP;
  FOR i IN 1..2 LOOP
    BEGIN
      PERFORM public.adjust_stock(b[1], gen_random_uuid(), CASE WHEN i = 1 THEN p[3] ELSE gen_random_uuid() END, 1, 'ADJUSTMENT', NULL);
      RAISE EXCEPTION 'Foreign/unknown product accepted';
    EXCEPTION WHEN no_data_found THEN
      GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE, message = MESSAGE_TEXT;
      IF state <> 'P0002' OR message <> 'Product unavailable' THEN RAISE EXCEPTION 'Reference existence disclosed'; END IF;
      checks := checks + 1;
    END;
  END LOOP;
  BEGIN
    PERFORM public.adjust_stock(NULL, gen_random_uuid(), p[1], 1, 'ADJUSTMENT', NULL);
    RAISE EXCEPTION 'Null business accepted';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1; END;
  BEGIN
    PERFORM public.adjust_stock(gen_random_uuid(), gen_random_uuid(), p[1], 1, 'ADJUSTMENT', NULL);
    RAISE EXCEPTION 'Unknown business accepted';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1; END;

  original := public.adjust_stock(b[1], op, p[1], 10, 'ADJUSTMENT', E'  ajuste original\n');
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(original) k) IS DISTINCT FROM
     ARRAY['business_id','created_at','created_by','id','notes','occurred_at','product_id','quantity_delta','reference_id','reference_type','type','unit_cost']::text[]
     OR original->>'business_id' <> b[1]::text OR original->>'product_id' <> p[1]::text
     OR original->>'created_by' <> u[1]::text OR original->>'reference_id' <> op::text
     OR original->>'reference_type' <> 'STOCK_ADJUSTMENT' OR original->>'type' <> 'ADJUSTMENT'
     OR original->>'quantity_delta' <> '10' OR original->'unit_cost' <> 'null'::jsonb
     OR original->>'notes' <> E'  ajuste original\n' OR original->>'id' IS NULL
     OR (original->>'created_at')::timestamptz <> now() OR (original->>'occurred_at')::timestamptz <> now() THEN
    RAISE EXCEPTION 'Wrong exact movement output/actor/audit/original notes';
  END IF;
  checks := checks + 1;
  result := public.adjust_stock(b[1], op, NULL, 0, 'INVALID', 'changed retry');
  IF result IS DISTINCT FROM original THEN RAISE EXCEPTION 'Authorized retry re-executed changed payload'; END IF;
  checks := checks + 1;
  result := public.adjust_stock(b[1], gen_random_uuid(), p[1], -3, 'LOSS', NULL);
  IF result->>'type' <> 'LOSS' OR result->>'quantity_delta' <> '-3' OR result->'notes' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'Loss semantics or NULL notes changed';
  END IF;
  SELECT current_stock INTO actual_stock FROM public.get_product_stock(b[1], ARRAY[p[1]]);
  IF actual_stock <> '7' THEN RAISE EXCEPTION 'Stock did not derive from adjustment and loss'; END IF;
  checks := checks + 2;
  result := public.adjust_stock(b[1], gen_random_uuid(), p[1], -7, 'ADJUSTMENT', '');
  SELECT current_stock INTO actual_stock FROM public.get_product_stock(b[1], ARRAY[p[1]]);
  IF actual_stock <> '0' OR result->>'notes' <> '' THEN RAISE EXCEPTION 'Exact depletion or empty notes rejected'; END IF;
  checks := checks + 1;
  FOR i IN 1..2 LOOP
    BEGIN
      PERFORM public.adjust_stock(b[1], gen_random_uuid(), p[1], -1, CASE WHEN i = 1 THEN 'LOSS' ELSE 'ADJUSTMENT' END, NULL);
      RAISE EXCEPTION 'Negative ending balance accepted';
    EXCEPTION WHEN SQLSTATE 'PT409' THEN
      GET STACKED DIAGNOSTICS detail = PG_EXCEPTION_DETAIL;
      IF detail <> 'INSUFFICIENT_STOCK' THEN RAISE EXCEPTION 'Missing safe insufficient-stock identifier'; END IF;
      checks := checks + 1;
    END;
  END LOOP;
  result := public.adjust_stock(b[1], gen_random_uuid(), p[2], 4, 'ADJUSTMENT', 'archived');
  IF result->>'product_id' <> p[2]::text THEN RAISE EXCEPTION 'Archived product adjustment failed'; END IF;
  checks := checks + 1;
  BEGIN
    PERFORM public.adjust_stock(b[1], gen_random_uuid(), p[4], 4, 'ADJUSTMENT', NULL);
    RAISE EXCEPTION 'Partially correcting legacy negative balance accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN checks := checks + 1; END;
  PERFORM public.adjust_stock(b[1], gen_random_uuid(), p[4], 5, 'ADJUSTMENT', NULL);
  SELECT current_stock INTO actual_stock FROM public.get_product_stock(b[1], ARRAY[p[4]]);
  IF actual_stock <> '0' THEN RAISE EXCEPTION 'Legacy negative balance recovery incorrect'; END IF;
  PERFORM public.adjust_stock(b[1], gen_random_uuid(), p[5], 1, 'ADJUSTMENT', NULL);
  SELECT current_stock INTO actual_stock FROM public.get_product_stock(b[1], ARRAY[p[5]]);
  IF actual_stock <> '4294967295' THEN RAISE EXCEPTION 'Balance arithmetic narrowed to int4'; END IF;
  checks := checks + 2;
  -- The same operation ID is independent in another authorized business.
  result := public.adjust_stock(b[2], op, p[3], 2, 'ADJUSTMENT', NULL);
  IF result->>'business_id' <> b[2]::text OR result->>'id' = original->>'id' THEN RAISE EXCEPTION 'Replay tag was not tenant scoped'; END IF;
  checks := checks + 1;
  BEGIN
    INSERT INTO public.stock_movements (business_id, product_id, type, quantity_delta, created_by)
    VALUES (b[1], p[1], 'ADJUSTMENT', 1, u[1]);
    RAISE EXCEPTION 'Direct ledger insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1; END;
  RESET ROLE;

  -- Any authorized OWNER can replay; inactive membership cannot use the replay path.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', u[6], 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF public.adjust_stock(b[1], op, p[2], 99, 'ADJUSTMENT', NULL) IS DISTINCT FROM original THEN
    RAISE EXCEPTION 'Authorized OWNER replay changed persisted actor/output';
  END IF;
  checks := checks + 1;
  RESET ROLE;
  UPDATE public.business_members SET is_active = false WHERE business_id = b[1] AND user_id = u[6];
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.adjust_stock(b[1], op, p[1], 1, 'ADJUSTMENT', NULL);
    RAISE EXCEPTION 'Inactive OWNER replay allowed';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1; END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  SELECT count(*) INTO old_count FROM public.stock_movements;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.adjust_stock(b[1], gen_random_uuid(), p[1], 99, 'ADJUSTMENT', NULL);
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P0223', MESSAGE = 'Rollback probe';
  EXCEPTION WHEN SQLSTATE 'P0223' THEN NULL; END;
  RESET ROLE;
  IF (SELECT count(*) FROM public.stock_movements) <> old_count THEN RAISE EXCEPTION 'Rollback left partial movement'; END IF;
  checks := checks + 1;
  BEGIN
    UPDATE public.stock_movements SET quantity_delta = 99 WHERE id = (original->>'id')::uuid;
    RAISE EXCEPTION 'Ledger update accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN checks := checks + 1; END;
  BEGIN
    DELETE FROM public.stock_movements WHERE id = (original->>'id')::uuid;
    RAISE EXCEPTION 'Ledger delete accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN checks := checks + 1; END;
  IF (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.products t) IS DISTINCT FROM products_before
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(history_before) old
                WHERE NOT EXISTS (SELECT 1 FROM public.stock_movements m WHERE to_jsonb(m) = old)) THEN
    RAISE EXCEPTION 'Catalog or preexisting ledger history modified';
  END IF;
  checks := checks + 1;
  -- The partial index must not forbid unrelated duplicate/free-text references.
  INSERT INTO public.stock_movements (business_id, product_id, type, quantity_delta, reference_type, reference_id, created_by)
  VALUES (b[1], p[1], 'RETURN', -1, 'OTHER', op, u[1]), (b[1], p[1], 'LOSS', 1, 'OTHER', op, u[1]);
  BEGIN
    INSERT INTO public.stock_movements (business_id, product_id, type, quantity_delta, reference_type, reference_id, created_by)
    VALUES (b[1], p[1], 'ADJUSTMENT', 1, 'STOCK_ADJUSTMENT', op, u[1]);
    RAISE EXCEPTION 'Duplicate adjustment operation accepted';
  EXCEPTION WHEN unique_violation THEN checks := checks + 1; END;
  RAISE NOTICE 'BF223 targeted SQL PASS: % assertion groups, exact output/ACL/roles/replay/rollback/history/stock controls', checks;
END;
$$;
ROLLBACK;
