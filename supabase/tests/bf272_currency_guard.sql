\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = '';

DO $$
DECLARE
  fn record;
BEGIN
  SELECT * INTO STRICT fn FROM pg_proc WHERE oid = 'private.guard_business_currency_change()'::regprocedure;
  IF NOT fn.prosecdef OR fn.provolatile <> 'v' OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR fn.proowner <> 'postgres'::regrole THEN
    RAISE EXCEPTION 'Currency guard execution metadata differs';
  END IF;
  IF has_function_privilege('authenticated',fn.oid,'EXECUTE')
     OR has_function_privilege('anon',fn.oid,'EXECUTE')
     OR has_function_privilege('service_role',fn.oid,'EXECUTE') THEN
    RAISE EXCEPTION 'Currency guard is trigger-only';
  END IF;
  SELECT * INTO STRICT fn FROM pg_proc WHERE oid = 'private.lock_financial_business_currency()'::regprocedure;
  IF fn.prosecdef OR fn.provolatile <> 'v' OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR has_function_privilege('authenticated',fn.oid,'EXECUTE')
     OR has_function_privilege('anon',fn.oid,'EXECUTE')
     OR has_function_privilege('service_role',fn.oid,'EXECUTE') THEN
    RAISE EXCEPTION 'Coordination trigger must retain invoker permissions';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
      'businesses_guard_currency','sales_lock_business_currency','payments_lock_business_currency',
      'purchases_lock_business_currency','expenses_lock_business_currency')) <> 5
     OR (SELECT count(*) FROM pg_policies WHERE schemaname='public') <> 46
     OR (SELECT count(*) FROM pg_tables WHERE schemaname='public') <> 19
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relkind IN ('r','p') AND (NOT c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Trigger inventory or inherited RLS baseline differs';
  END IF;
END;
$$;

DO $$
DECLARE
  owner_id uuid := gen_random_uuid();
  barber_id uuid := gen_random_uuid();
  business_id uuid := gen_random_uuid();
  foreign_id uuid := gen_random_uuid();
  parent_sale uuid := gen_random_uuid();
  category_id uuid := gen_random_uuid();
  source text;
  state text;
  current_business uuid;
  before_history jsonb;
  after_history jsonb;
  changed integer;
BEGIN
  INSERT INTO auth.users(id) VALUES(owner_id),(barber_id);
  INSERT INTO public.businesses(id,name) VALUES(business_id,'BF272 role fixture'),(foreign_id,'BF272 foreign fixture');
  INSERT INTO public.business_members(business_id,user_id,role,is_active)
    VALUES(business_id,owner_id,'OWNER',true),(business_id,barber_id,'BARBER',true);

  PERFORM pg_catalog.set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  UPDATE public.businesses SET currency_code='USD' WHERE id=business_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'OWNER currency update without activity must succeed'; END IF;
  UPDATE public.businesses SET currency_code='EUR' WHERE id=foreign_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN RAISE EXCEPTION 'Cross-business currency write must be blocked'; END IF;
  RESET ROLE;

  PERFORM pg_catalog.set_config('request.jwt.claims',jsonb_build_object('sub',barber_id,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  UPDATE public.businesses SET currency_code='EUR',timezone='UTC' WHERE id=business_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN RAISE EXCEPTION 'BARBER settings write must be blocked'; END IF;
  RESET ROLE;

  -- Separate fixtures prove each table independently locks currency. The isolated
  -- payment deliberately uses an admin-created foreign sale FK: RLS hides that
  -- malformed payment from its OWNER, but the guard must still see its history.
  FOREACH source IN ARRAY ARRAY['sales','payments','purchases','expenses'] LOOP
    FOREACH state IN ARRAY ARRAY['DRAFT','COMPLETED','VOIDED'] LOOP
      current_business := gen_random_uuid();
      INSERT INTO public.businesses(id,name) VALUES(current_business,'BF272 history fixture');
      INSERT INTO public.business_members(business_id,user_id,role,is_active)
        VALUES(current_business,owner_id,'OWNER',true);
      IF source='sales' THEN
        INSERT INTO public.sales(business_id,operation_id,status,subtotal,total,created_by)
          VALUES(current_business,gen_random_uuid(),state,0,0,owner_id);
      ELSIF source='purchases' THEN
        INSERT INTO public.purchases(business_id,operation_id,supplier,status,total,created_by)
          VALUES(current_business,gen_random_uuid(),'Fixture',state,0,owner_id);
      ELSIF source='payments' THEN
        parent_sale := gen_random_uuid();
        INSERT INTO public.sales(id,business_id,operation_id,status,subtotal,total,created_by)
          VALUES(parent_sale,foreign_id,gen_random_uuid(),state,0,0,owner_id);
        INSERT INTO public.payments(business_id,sale_id,payment_method,amount,created_by)
          VALUES(current_business,parent_sale,'CASH',1,owner_id);
      ELSE
        category_id := gen_random_uuid();
        INSERT INTO public.expense_categories(id,business_id,name) VALUES(category_id,current_business,'Fixture');
        INSERT INTO public.expenses(business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by)
          VALUES(current_business,category_id,'MANUAL','Fixture',0,'CASH','2026-01-01',owner_id);
      END IF;

      SELECT jsonb_build_object(
        'sales',(SELECT jsonb_agg(to_jsonb(s)) FROM public.sales s WHERE s.business_id=current_business),
        'payments',(SELECT jsonb_agg(to_jsonb(p)) FROM public.payments p WHERE p.business_id=current_business),
        'purchases',(SELECT jsonb_agg(to_jsonb(p)) FROM public.purchases p WHERE p.business_id=current_business),
        'expenses',(SELECT jsonb_agg(to_jsonb(e)) FROM public.expenses e WHERE e.business_id=current_business)
      ) INTO before_history;

      PERFORM pg_catalog.set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
      SET LOCAL ROLE authenticated;
      BEGIN
        UPDATE public.businesses SET currency_code='USD' WHERE id=current_business;
        RAISE EXCEPTION 'History currency update unexpectedly succeeded';
      EXCEPTION WHEN SQLSTATE 'P0272' THEN NULL;
      END;
      UPDATE public.businesses SET currency_code='ARS',timezone='UTC',name='Updated fixture' WHERE id=current_business;
      GET DIAGNOSTICS changed = ROW_COUNT;
      IF changed <> 1 THEN RAISE EXCEPTION 'Same currency and timezone/name edit must remain allowed'; END IF;
      RESET ROLE;
      IF (SELECT currency_code FROM public.businesses WHERE id=current_business) <> 'ARS'
         OR (SELECT timezone FROM public.businesses WHERE id=current_business) <> 'UTC' THEN
        RAISE EXCEPTION 'Currency guard or timezone result differs';
      END IF;
      SELECT jsonb_build_object(
        'sales',(SELECT jsonb_agg(to_jsonb(s)) FROM public.sales s WHERE s.business_id=current_business),
        'payments',(SELECT jsonb_agg(to_jsonb(p)) FROM public.payments p WHERE p.business_id=current_business),
        'purchases',(SELECT jsonb_agg(to_jsonb(p)) FROM public.purchases p WHERE p.business_id=current_business),
        'expenses',(SELECT jsonb_agg(to_jsonb(e)) FROM public.expenses e WHERE e.business_id=current_business)
      ) INTO after_history;
      IF after_history IS DISTINCT FROM before_history THEN RAISE EXCEPTION 'Historical rows were rewritten'; END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'BF272 currency guard: four independent sources, all statuses, zero valid amounts, OWNER/BARBER/tenant and unchanged history passed';
END;
$$;
ROLLBACK;
