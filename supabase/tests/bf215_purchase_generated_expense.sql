\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.bf215_prepare(b uuid,op uuid,c uuid,m text,at_time timestamptz,n text,p uuid,cost text DEFAULT '0.29',qty integer DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE result jsonb; BEGIN
  result:=private.persist_purchase(b,op,'Original supplier',c,m,at_time,n,
    jsonb_build_array(jsonb_build_object('productId',p,'quantity',qty,'unitCost',cost)));
  PERFORM private.persist_purchase_stock(b,op,true);
  RETURN result;
END $$;
CREATE FUNCTION pg_temp.bf215_error(b uuid,op uuid,initial boolean,state text DEFAULT '22023',detail text DEFAULT 'INVALID_INPUT')
RETURNS void LANGUAGE plpgsql AS $$ DECLARE actual_state text;actual_detail text; BEGIN
  BEGIN PERFORM private.persist_purchase_expense(b,op,initial);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state=RETURNED_SQLSTATE,actual_detail=PG_EXCEPTION_DETAIL;
    IF actual_state=state AND actual_detail IS NOT DISTINCT FROM detail THEN RETURN;END IF;
    RAISE EXCEPTION 'BF215 wrong signal %/% expected %/%',actual_state,actual_detail,state,detail;
  END;
  RAISE EXCEPTION 'BF215 expected rejection';
END $$;
CREATE FUNCTION pg_temp.bf215_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF current_setting('bf215.no_write',true)='on' THEN RAISE EXCEPTION 'BF215 replay attempted write';END IF;
  IF TG_OP='INSERT' AND NEW.notes='__BF215_FAIL__' THEN
    IF NOT EXISTS(SELECT 1 FROM public.stock_movements WHERE reference_type='PURCHASE' AND reference_id=NEW.purchase_id)
       OR NOT EXISTS(SELECT 1 FROM public.purchase_items i JOIN public.products p ON p.id=i.product_id
          WHERE i.purchase_id=NEW.purchase_id AND p.default_purchase_cost=i.unit_cost_snapshot) THEN
      RAISE EXCEPTION 'BF215 fault did not exercise prior stock/cost';END IF;
    RAISE EXCEPTION USING ERRCODE='P0215',MESSAGE='Synthetic expense failure';
  END IF;
  IF TG_OP='INSERT' AND NEW.notes='__BF215_COLLIDE__' AND pg_trigger_depth()=1 THEN
    INSERT INTO public.expenses(business_id,category_id,source_type,purchase_id,description,amount,payment_method,
      expense_date,notes,created_by) VALUES(NEW.business_id,NEW.category_id,'PURCHASE',NEW.purchase_id,
      'Collision fixture',NEW.amount,NEW.payment_method,NEW.expense_date,'Collision fixture',NEW.created_by);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bf215_fault BEFORE INSERT OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION pg_temp.bf215_fault();

DO $$
DECLARE
  biz uuid[]:=ARRAY[gen_random_uuid(),gen_random_uuid()];
  users uuid[]:=ARRAY(SELECT gen_random_uuid() FROM generate_series(1,6));
  categories uuid[]:=ARRAY(SELECT gen_random_uuid() FROM generate_series(1,3));
  product_id uuid:=gen_random_uuid();
  op uuid:=gen_random_uuid();
  next_op uuid;
  parent_id uuid;
  first_parent uuid;
  header jsonb;
  original public.expenses%ROWTYPE;
  result public.expenses%ROWTYPE;
  before_row jsonb;
  before_product jsonb;
  original_items jsonb;
  before_ledger jsonb;
  note text;
  method text;
  actor uuid;
  role_name text;
  f record;
  test_case record;
  variant integer;
  checks integer:=0;
  constraint_name text;
BEGIN
  SELECT * INTO STRICT f FROM pg_proc WHERE oid='private.persist_purchase_expense(uuid,uuid,boolean)'::regprocedure;
  IF f.prosecdef OR f.provolatile<>'v' OR f.proretset OR f.pronargs<>3 OR f.pronargdefaults<>0
     OR f.prorettype<>'public.expenses'::regtype OR f.proowner<>'postgres'::regrole
     OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR f.proargnames IS DISTINCT FROM ARRAY['p_business_id','p_operation_id','p_apply_initial_effects']::text[]
     OR EXISTS(SELECT 1 FROM aclexplode(f.proacl) a WHERE a.grantee<>f.proowner OR a.is_grantable) THEN
    RAISE EXCEPTION 'BF215 unsafe signature/security';END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(role_name,f.oid,'EXECUTE') THEN RAISE EXCEPTION 'BF215 exposed';END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='complete_purchase') THEN RAISE EXCEPTION 'BF215 activated partial purchase';END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='purchases'
    AND column_name IN ('expense_category_id','payment_method') AND (is_nullable<>'YES' OR column_default IS NOT NULL))
    OR (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='purchases')<>13 THEN
    RAISE EXCEPTION 'BF215 snapshot metadata/defaults invalid';END IF;
  checks:=checks+5;
  INSERT INTO auth.users(id) SELECT unnest(users);
  INSERT INTO public.businesses(id,name,timezone) VALUES(biz[1],'BF215 A','America/Argentina/Buenos_Aires'),(biz[2],'BF215 B','UTC');
  INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES
    (biz[1],users[1],'OWNER',true),(biz[1],users[2],'BARBER',true),(biz[1],users[3],'OWNER',false),
    (biz[2],users[4],'OWNER',true),(biz[1],users[6],'OWNER',true);
  INSERT INTO public.expense_categories(id,business_id,name) VALUES
    (categories[1],biz[1],'Original'),(categories[2],biz[1],'Other'),(categories[3],biz[2],'Foreign');
  INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost)
    VALUES(product_id,biz[1],'Original product',20,7);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  header:=pg_temp.bf215_prepare(biz[1],op,categories[1],'BANK_TRANSFER','2026-01-01T01:30Z','  Original notes  ',product_id);
  first_parent:=(header->'purchase'->>'id')::uuid;
  IF (SELECT count(*) FROM jsonb_object_keys(header->'purchase'))<>11
     OR (SELECT count(*) FROM jsonb_object_keys(header->'items'->0))<>8
     OR header->'purchase' ?| ARRAY['expense_category_id','payment_method']
     OR NOT EXISTS(SELECT 1 FROM public.purchases WHERE id=first_parent AND expense_category_id=categories[1] AND payment_method='BANK_TRANSFER') THEN
    RAISE EXCEPTION 'BF215 snapshot persistence changed public BF213 projection';END IF;
  PERFORM pg_temp.bf215_error(biz[1],op,false); -- no expense is NOT first application
  original:=private.persist_purchase_expense(biz[1],op,true);
  IF original.id IS NULL OR original.business_id<>biz[1] OR original.purchase_id<>first_parent
    OR original.category_id<>categories[1] OR original.amount<>0.87 OR original.payment_method<>'BANK_TRANSFER'
    OR original.source_type<>'PURCHASE' OR original.description<>'Compra de productos'
    OR original.notes IS DISTINCT FROM '  Original notes  ' OR original.receipt_path IS NOT NULL
    OR original.expense_date<>DATE '2025-12-31' OR original.created_by<>users[1]
    OR original.created_at<>now() OR original.updated_at<>now()
    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(to_jsonb(original)) k)<>
       ARRAY['amount','business_id','category_id','created_at','created_by','description','expense_date','id','notes','payment_method','purchase_id','receipt_path','source_type','updated_at'] THEN
    RAISE EXCEPTION 'BF215 exact expense source/projection/amount/date/notes/audit failed';END IF;
  PERFORM pg_temp.bf215_error(biz[1],op,true); -- no pseudo-replay on existing row
  checks:=checks+5;

  -- Replay ignores a new category/method payload at BF213; never writes snapshots.
  SELECT to_jsonb(p) INTO before_row FROM public.purchases p WHERE id=first_parent;
  IF private.persist_purchase(biz[1],op,NULL,categories[2],'DIGITAL_WALLET',NULL,'New notes',NULL) IS DISTINCT FROM header
    OR before_row IS DISTINCT FROM (SELECT to_jsonb(p) FROM public.purchases p WHERE id=first_parent) THEN
    RAISE EXCEPTION 'BF213 replay rewrote snapshots';END IF;
  UPDATE public.products SET name='Changed',default_purchase_cost=80,is_active=false WHERE id=product_id;
  UPDATE public.expense_categories SET is_active=false WHERE id=categories[1];
  UPDATE public.businesses SET timezone='Pacific/Kiritimati' WHERE id=biz[1];
  SELECT jsonb_agg(to_jsonb(i) ORDER BY id) INTO original_items FROM public.purchase_items i WHERE purchase_id=first_parent;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY id) INTO before_ledger FROM public.stock_movements m;
  SELECT to_jsonb(p) INTO before_product FROM public.products p WHERE id=product_id;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[6],'role','authenticated')::text,true);
  PERFORM set_config('bf215.no_write','on',true);
  result:=private.persist_purchase_expense(biz[1],op,false);
  IF result IS DISTINCT FROM original OR result.expense_date<>DATE '2025-12-31'
    OR before_ledger IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.stock_movements m)
    OR before_product IS DISTINCT FROM (SELECT to_jsonb(p) FROM public.products p WHERE id=product_id)
    OR original_items IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.purchase_items i WHERE purchase_id=first_parent) THEN
    RAISE EXCEPTION 'BF215 replay recomputed date/current cost/history';END IF;
  UPDATE public.purchases SET status='VOIDED' WHERE id=first_parent;
  result:=private.persist_purchase_expense(biz[1],op,false);
  IF result IS DISTINCT FROM original THEN RAISE EXCEPTION 'BF215 VOIDED replay changed expense';END IF;
  PERFORM pg_temp.bf215_error(biz[1],op,true,'PT409','INVALID_STATUS');
  PERFORM set_config('bf215.no_write','off',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  UPDATE public.expense_categories SET is_active=true WHERE id=categories[1];
  UPDATE public.products SET is_active=true WHERE id=product_id;
  checks:=checks+4;

  FOREACH method IN ARRAY ARRAY['CASH','BANK_TRANSFER','DEBIT_CARD','CREDIT_CARD','DIGITAL_WALLET'] LOOP
    FOREACH note IN ARRAY ARRAY[NULL::text,'','  Texto original  '] LOOP
      next_op:=gen_random_uuid();
      PERFORM pg_temp.bf215_prepare(biz[1],next_op,categories[1],method,'2026-01-01Z',note,product_id,'0.00',1);
      result:=private.persist_purchase_expense(biz[1],next_op,true);
      IF result.amount<>0 OR result.notes IS DISTINCT FROM note OR result.payment_method<>method THEN
        RAISE EXCEPTION 'BF215 zero/notes/HD006 invalid';END IF;
      checks:=checks+1;
    END LOOP;
  END LOOP;
  next_op:=gen_random_uuid();
  PERFORM pg_temp.bf215_prepare(biz[1],next_op,categories[1],'CASH','2026-01-01Z',NULL,product_id,'9999999999.99',1);
  result:=private.persist_purchase_expense(biz[1],next_op,true);
  IF result.amount<>9999999999.99 THEN RAISE EXCEPTION 'BF215 NUMERIC maximum lost precision';END IF;
  checks:=checks+1;

  FOR test_case IN SELECT * FROM (VALUES
    ('UTC','2026-01-01T01:00Z','2026-01-01'),
    ('Pacific/Kiritimati','2026-01-01T10:30Z','2026-01-02'),
    ('America/Adak','2026-01-02T00:30+14:00','2026-01-01'),
    ('America/New_York','2026-03-08T06:30Z','2026-03-08'),
    ('America/New_York','2026-03-08T07:30Z','2026-03-08'),
    ('America/New_York','2026-11-01T05:30Z','2026-11-01'),
    ('America/New_York','2026-11-01T06:30Z','2026-11-01'),
    ('UTC','0001-01-01T00:30Z','0001-01-01'),('UTC','9999-12-31T23:30Z','9999-12-31')
  ) AS cases(zone,instant,expected_date) LOOP
    UPDATE public.businesses SET timezone=test_case.zone WHERE id=biz[1];
    next_op:=gen_random_uuid();
    PERFORM pg_temp.bf215_prepare(biz[1],next_op,categories[1],'CASH',test_case.instant::timestamptz,NULL,product_id);
    result:=private.persist_purchase_expense(biz[1],next_op,true);
    IF result.expense_date<>test_case.expected_date::date THEN RAISE EXCEPTION 'BF215 wrong business civil date %',test_case.zone;END IF;
    checks:=checks+1;
  END LOOP;
  FOR test_case IN SELECT * FROM (VALUES
    ('Pacific/Honolulu','0001-01-01T00:30Z'),('Pacific/Kiritimati','9999-12-31T23:30Z'),('Not/A_Zone','2026-01-01Z')
  ) AS cases(zone,instant) LOOP
    UPDATE public.businesses SET timezone=test_case.zone WHERE id=biz[1];
    next_op:=gen_random_uuid();
    PERFORM pg_temp.bf215_prepare(biz[1],next_op,categories[1],'CASH',test_case.instant::timestamptz,NULL,product_id);
    PERFORM pg_temp.bf215_error(biz[1],next_op,true);
    checks:=checks+1;
  END LOOP;
  -- Historical replay must not even need today's timezone to be usable.
  result:=private.persist_purchase_expense(biz[1],op,false);
  IF result IS DISTINCT FROM original THEN RAISE EXCEPTION 'BF215 replay depends on current timezone';END IF;
  UPDATE public.businesses SET timezone='UTC' WHERE id=biz[1];
  checks:=checks+1;

  FOR variant IN 1..3 LOOP
    next_op:=gen_random_uuid();
    header:=pg_temp.bf215_prepare(biz[1],next_op,categories[1],'CASH','2026-01-01Z',NULL,product_id);
    parent_id:=(header->'purchase'->>'id')::uuid;
    IF variant=3 THEN PERFORM private.persist_purchase_expense(biz[1],next_op,true);END IF;
    UPDATE public.purchases SET expense_category_id=CASE WHEN variant IN (1,3) THEN NULL ELSE expense_category_id END,
      payment_method=CASE WHEN variant IN (2,3) THEN NULL ELSE payment_method END WHERE id=parent_id;
    SELECT to_jsonb(p) INTO before_row FROM public.purchases p WHERE id=parent_id;
    PERFORM private.persist_purchase(biz[1],next_op,'New supplier',categories[2],'DIGITAL_WALLET','2030-01-01Z','New',NULL);
    PERFORM pg_temp.bf215_error(biz[1],next_op,false);
    PERFORM pg_temp.bf215_error(biz[1],next_op,true);
    IF before_row IS DISTINCT FROM (SELECT to_jsonb(p) FROM public.purchases p WHERE id=parent_id) THEN
      RAISE EXCEPTION 'BF215 historical NULL context backfilled';END IF;
    checks:=checks+3;
  END LOOP;

  -- Each corruption has an expense row, so it cannot pass just on row presence.
  FOR variant IN 1..9 LOOP
    next_op:=gen_random_uuid();
    header:=pg_temp.bf215_prepare(biz[1],next_op,categories[1],'CASH','2026-01-01Z',NULL,product_id);
    parent_id:=(header->'purchase'->>'id')::uuid;
    PERFORM private.persist_purchase_expense(biz[1],next_op,true);
    UPDATE public.expenses SET
      amount=CASE WHEN variant=1 THEN amount+1 ELSE amount END,
      category_id=CASE WHEN variant=2 THEN categories[2] ELSE category_id END,
      payment_method=CASE WHEN variant=3 THEN 'DIGITAL_WALLET' ELSE payment_method END,
      business_id=CASE WHEN variant=4 THEN biz[2] ELSE business_id END,
      created_by=CASE WHEN variant=5 THEN users[6] ELSE created_by END,
      description=CASE WHEN variant=6 THEN 'Altered' ELSE description END,
      notes=CASE WHEN variant=7 THEN 'Altered' ELSE notes END,
      receipt_path=CASE WHEN variant=8 THEN 'Unexpected receipt' ELSE receipt_path END,
      expense_date=CASE WHEN variant=9 THEN 'infinity'::date ELSE expense_date END
    WHERE purchase_id=parent_id;
    SELECT to_jsonb(e) INTO before_row FROM public.expenses e WHERE purchase_id=parent_id;
    PERFORM pg_temp.bf215_error(biz[1],next_op,false);
    IF before_row IS DISTINCT FROM (SELECT to_jsonb(e) FROM public.expenses e WHERE purchase_id=parent_id) THEN
      RAISE EXCEPTION 'BF215 repaired inconsistent expense';END IF;
    checks:=checks+1;
  END LOOP;

  next_op:=gen_random_uuid();
  header:=pg_temp.bf215_prepare(biz[1],next_op,categories[1],'CASH','2026-01-01Z',NULL,product_id);
  parent_id:=(header->'purchase'->>'id')::uuid;
  UPDATE public.purchases SET status='VOIDED' WHERE id=parent_id;
  PERFORM pg_temp.bf215_error(biz[1],next_op,false);
  PERFORM pg_temp.bf215_error(biz[1],next_op,true,'PT409','INVALID_STATUS');
  UPDATE public.purchases SET status='DRAFT' WHERE id=parent_id;
  PERFORM pg_temp.bf215_error(biz[1],next_op,false,'PT409','INVALID_STATUS');
  checks:=checks+3;

  -- Valid context but BF214 missing: no expense can bypass the stock stage.
  next_op:=gen_random_uuid();
  PERFORM private.persist_purchase(biz[1],next_op,'S',categories[1],'CASH','2026-01-01Z',NULL,
    jsonb_build_array(jsonb_build_object('productId',product_id,'quantity',1,'unitCost','1.00')));
  PERFORM pg_temp.bf215_error(biz[1],next_op,true);
  checks:=checks+1;

  -- FK existence does not authorize a foreign category; active catalog and
  -- NEW creator checks remain explicit even for another authorized OWNER.
  next_op:=gen_random_uuid();
  header:=pg_temp.bf215_prepare(biz[1],next_op,categories[1],'CASH','2026-01-01Z',NULL,product_id);
  parent_id:=(header->'purchase'->>'id')::uuid;
  UPDATE public.purchases SET expense_category_id=categories[3] WHERE id=parent_id;
  PERFORM pg_temp.bf215_error(biz[1],next_op,true);
  UPDATE public.purchases SET expense_category_id=categories[1] WHERE id=parent_id;
  UPDATE public.expense_categories SET is_active=false WHERE id=categories[1];
  PERFORM pg_temp.bf215_error(biz[1],next_op,true);
  UPDATE public.expense_categories SET is_active=true WHERE id=categories[1];
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[6],'role','authenticated')::text,true);
  PERFORM pg_temp.bf215_error(biz[1],next_op,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  result:=private.persist_purchase_expense(biz[1],next_op,true);
  IF result.created_by<>users[1] THEN RAISE EXCEPTION 'BF215 NEW creator was substituted';END IF;
  checks:=checks+4;

  FOREACH note IN ARRAY ARRAY['__BF215_FAIL__','__BF215_COLLIDE__'] LOOP
    next_op:=gen_random_uuid();
    SELECT to_jsonb(p) INTO before_product FROM public.products p WHERE id=product_id;
    SELECT jsonb_agg(to_jsonb(m) ORDER BY id) INTO before_ledger FROM public.stock_movements m;
    BEGIN
      PERFORM pg_temp.bf215_prepare(biz[1],next_op,categories[1],'CASH','2026-01-01Z',note,product_id,'17.00');
      PERFORM private.persist_purchase_expense(biz[1],next_op,true);
      RAISE EXCEPTION 'BF215 fault unexpectedly succeeded';
    EXCEPTION WHEN SQLSTATE 'P0215' THEN
      IF note<>'__BF215_FAIL__' THEN RAISE;END IF;
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
      IF note<>'__BF215_COLLIDE__' OR constraint_name<>'expenses_purchase_id_key' THEN RAISE;END IF;
    END;
    IF EXISTS(SELECT 1 FROM public.purchases WHERE business_id=biz[1] AND operation_id=next_op)
      OR before_product IS DISTINCT FROM (SELECT to_jsonb(p) FROM public.products p WHERE id=product_id)
      OR before_ledger IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.stock_movements m) THEN
      RAISE EXCEPTION 'BF215 failure/unique conflict left partial effects';END IF;
    checks:=checks+1;
  END LOOP;

  FOREACH actor IN ARRAY ARRAY[users[2],users[3],users[4],users[5],NULL::uuid] LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    PERFORM pg_temp.bf215_error(biz[1],op,false,'42501','ACCESS_DENIED');
    PERFORM pg_temp.bf215_error(biz[1],gen_random_uuid(),true,'42501','ACCESS_DENIED');
    checks:=checks+2;
  END LOOP;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  PERFORM pg_temp.bf215_error(biz[2],op,false,'42501','ACCESS_DENIED');
  PERFORM pg_temp.bf215_error(biz[1],NULL,false);
  PERFORM pg_temp.bf215_error(biz[1],op,NULL);
  PERFORM pg_temp.bf215_error(biz[1],gen_random_uuid(),false);
  checks:=checks+4;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    EXECUTE format('SET LOCAL ROLE %I',role_name);
    BEGIN PERFORM private.persist_purchase_expense(biz[1],op,false);RAISE EXCEPTION 'BF215 forged private flag';
    EXCEPTION WHEN insufficient_privilege THEN NULL;END;
    RESET ROLE;
    checks:=checks+1;
  END LOOP;
  RAISE NOTICE 'BF215 % verification groups PASS',checks;
END $$;
ROLLBACK;
