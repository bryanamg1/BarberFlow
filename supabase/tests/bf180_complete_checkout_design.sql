\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  b uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid()];
  u uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 5));
  s uuid := gen_random_uuid();
  p uuid := gen_random_uuid();
  proc record;
  item record;
  actor integer;
  payload jsonb;
  state text;
  message text;
  detail text;
  before_rows jsonb := '{}'::jsonb;
  after_rows jsonb := '{}'::jsonb;
  rows jsonb;
  checks integer := 0;
BEGIN
  SELECT * INTO STRICT proc FROM pg_proc
  WHERE oid = 'public.complete_checkout(uuid,uuid,uuid,uuid,numeric,text,jsonb)'::regprocedure;
  IF proc.prosecdef OR proc.proretset OR proc.provolatile <> 'v'
     OR proc.proowner <> 'postgres'::regrole OR proc.pronargs <> 7 OR proc.pronargdefaults <> 0
     OR proc.prorettype <> 'jsonb'::regtype
     OR proc.proargnames IS DISTINCT FROM ARRAY['p_business_id','p_operation_id','p_appointment_id','p_client_id','p_discount_amount','p_payment_method','p_items']::text[]
     OR proc.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR NOT has_function_privilege('authenticated', proc.oid, 'EXECUTE')
     OR has_function_privilege('anon', proc.oid, 'EXECUTE')
     OR has_function_privilege('service_role', proc.oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM aclexplode(proc.proacl) a
                WHERE a.grantee NOT IN (proc.proowner, 'authenticated'::regrole) OR a.is_grantable) THEN
    RAISE EXCEPTION 'Unsafe BF180 skeleton signature/security/ACL';
  END IF;
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') <> 19
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') <> 41
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind = 'r' AND (NOT c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'BF180 changed table/RLS/policy baseline';
  END IF;
  -- Frozen result projection must describe the actual persisted row contracts.
  FOR item IN SELECT * FROM (VALUES
    ('sales', ARRAY['id','business_id','client_id','appointment_id','operation_id','status','subtotal','discount','total','sold_at','created_by','created_at','updated_at']::text[]),
    ('sale_items', ARRAY['id','sale_id','item_type','service_id','product_id','item_name_snapshot','unit_price_snapshot','quantity','line_total','unit_cost_snapshot','created_at']::text[]),
    ('payments', ARRAY['id','business_id','sale_id','payment_method','amount','notes','paid_at','created_by','created_at']::text[])
  ) expected(table_name, columns) LOOP
    IF (SELECT array_agg(column_name::text ORDER BY ordinal_position)
        FROM information_schema.columns WHERE table_schema = 'public' AND table_name = item.table_name)
       IS DISTINCT FROM item.columns THEN RAISE EXCEPTION 'Frozen output projection differs from actual schema'; END IF;
    checks := checks + 1;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
             AND table_name = 'sales' AND column_name = 'discount_amount')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                     AND table_name = 'sales' AND column_name = 'discount' AND numeric_precision = 12 AND numeric_scale = 2)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sales'::regclass
                     AND conname = 'sales_business_id_operation_id_key' AND contype = 'u') THEN
    RAISE EXCEPTION 'Money/idempotency schema contract changed';
  END IF;
  checks := checks + 3;

  INSERT INTO auth.users (id) SELECT unnest(u);
  INSERT INTO public.businesses (id, name) VALUES (b[1], 'BF180 A'), (b[2], 'BF180 B');
  INSERT INTO public.business_members (business_id, user_id, role, is_active) VALUES
    (b[1], u[1], 'OWNER', true), (b[1], u[2], 'BARBER', true),
    (b[2], u[3], 'OWNER', true), (b[1], u[5], 'OWNER', false);
  INSERT INTO public.services (id, business_id, name, price, duration_minutes)
  VALUES (s, b[1], 'BF180 valid service', 10, 30);
  INSERT INTO public.products (id, business_id, name, sale_price, default_purchase_cost)
  VALUES (p, b[1], 'BF180 valid product', 20, 10);
  INSERT INTO public.stock_movements (business_id, product_id, type, quantity_delta, created_by)
  VALUES (b[1], p, 'PURCHASE', 10, u[1]);
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), ''[]''::jsonb) FROM public.%I t', item.tablename) INTO rows;
    before_rows := before_rows || jsonb_build_object(item.tablename, rows);
  END LOOP;
  FOR actor IN 1..5 LOOP
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', u[actor], 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    -- The closed gate rejects all payloads, not just an empty/zero-cost checkout.
    -- These checks do NOT claim that BF181 input validation is implemented.
    FOREACH payload IN ARRAY ARRAY[
      jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',s,'quantity',1)),
      jsonb_build_array(jsonb_build_object('itemType','PRODUCT','itemId',p,'quantity',2,'unitPriceOverride','0.00')),
      jsonb_build_array(jsonb_build_object('itemType','PRODUCT','itemId',p,'quantity',2,'created_by','forged','total',0)),
      '[]'::jsonb, '{}'::jsonb, 'null'::jsonb
    ] LOOP
      BEGIN
        PERFORM public.complete_checkout(b[1], gen_random_uuid(), NULL, NULL, 0, 'CASH', payload);
        RAISE EXCEPTION 'Skeleton returned a public checkout success';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE, message = MESSAGE_TEXT, detail = PG_EXCEPTION_DETAIL;
        IF actor = 1 THEN
          IF state <> '0A000' OR message <> 'Checkout is not available' OR detail <> 'CHECKOUT_NOT_READY' THEN
            RAISE EXCEPTION 'Owner did not receive the fixed closed gate';
          END IF;
        ELSIF state <> '42501' OR message <> 'Checkout access denied' THEN
          RAISE EXCEPTION 'Unauthorized actor reached or bypassed checkout gate';
        END IF;
        checks := checks + 1;
      END;
    END LOOP;
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  FOREACH payload IN ARRAY ARRAY['null'::jsonb, '[]'::jsonb] LOOP
    BEGIN
      PERFORM public.complete_checkout(b[2], gen_random_uuid(), NULL, NULL, 0, 'CASH', payload);
      RAISE EXCEPTION 'Foreign business accepted';
    EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1; END;
  END LOOP;
  BEGIN
    PERFORM public.complete_checkout(gen_random_uuid(), gen_random_uuid(), NULL, NULL, 0, 'CASH', '[]');
    RAISE EXCEPTION 'Unknown business accepted';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1; END;
  BEGIN
    PERFORM public.complete_checkout(NULL, gen_random_uuid(), NULL, NULL, 0, 'CASH', '[]');
    RAISE EXCEPTION 'Null business accepted';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.complete_checkout(b[1], gen_random_uuid(), NULL, NULL, 0, 'CASH', '[]');
    RAISE EXCEPTION 'Missing identity accepted';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1; END;
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.complete_checkout(b[1], gen_random_uuid(), NULL, NULL, 0, 'CASH', '[]');
    RAISE EXCEPTION 'Anon accepted';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1; END;
  RESET ROLE;
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), ''[]''::jsonb) FROM public.%I t', item.tablename) INTO rows;
    after_rows := after_rows || jsonb_build_object(item.tablename, rows);
  END LOOP;
  IF before_rows IS DISTINCT FROM after_rows THEN RAISE EXCEPTION 'Closed checkout gate modified business data'; END IF;
  RAISE NOTICE 'BF180 skeleton PASS: % assertion groups, no success and no writes across all19tables; final checkout NOT implemented', checks + 1;
END;
$$;
ROLLBACK;
