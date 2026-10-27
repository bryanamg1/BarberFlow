\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.bf241_assert(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'BF241: %',label; END IF;
END $$;
CREATE FUNCTION pg_temp.bf241_error(statement text, expected text, marker text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE code text; message text; detail text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE,message=MESSAGE_TEXT,detail=PG_EXCEPTION_DETAIL;
  END;
  IF code IS DISTINCT FROM expected OR (marker IS NOT NULL AND position(marker IN message||COALESCE(detail,''))=0)
    THEN RAISE EXCEPTION 'BF241 expected SQLSTATE % / marker %, got %',expected,marker,code; END IF;
END $$;
CREATE FUNCTION pg_temp.bf241_rows(b uuid,f timestamptz,t timestamptz) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  -- Preserve the function's emitted order; sorting by date here would hide an ordering regression.
  SELECT COALESCE(jsonb_agg(to_jsonb(r)-'native_order' ORDER BY r.native_order),'[]'::jsonb)
  FROM public.get_revenue_by_day(b,f,t) WITH ORDINALITY
    AS r(date,service_revenue,product_revenue,total_revenue,native_order);
$$;
CREATE FUNCTION pg_temp.bf241_sale(b uuid,u uuid,p uuid,s uuid,sold timestamptz,
  state text,prices numeric[],kinds text[],discount numeric DEFAULT 0)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid:=gen_random_uuid(); gross numeric; idx integer;
BEGIN
  SELECT sum(value) INTO gross FROM unnest(prices) AS v(value);
  INSERT INTO public.sales(id,business_id,operation_id,status,subtotal,discount,total,sold_at,created_by)
    VALUES(v_id,b,gen_random_uuid(),state,gross,discount,gross-discount,sold,u);
  FOR idx IN 1..cardinality(prices) LOOP
    INSERT INTO public.sale_items(id,sale_id,item_type,service_id,product_id,item_name_snapshot,
      unit_price_snapshot,quantity,line_total,unit_cost_snapshot)
    VALUES((left(v_id::text,24)||lpad(idx::text,12,'0'))::uuid,v_id,kinds[idx],
      CASE WHEN kinds[idx]='SERVICE' THEN s END,CASE WHEN kinds[idx]='PRODUCT' THEN p END,
      'Historical line '||idx,prices[idx],1,prices[idx],CASE WHEN kinds[idx]='PRODUCT' THEN 7.00 END);
  END LOOP;
  RETURN v_id;
END $$;

DO $$
DECLARE
  b uuid:=gen_random_uuid(); other_b uuid:=gen_random_uuid(); empty_b uuid:=gen_random_uuid(); dst_b uuid:=gen_random_uuid();
  users uuid[]:=ARRAY(SELECT gen_random_uuid() FROM generate_series(1,5));
  product_id uuid:=gen_random_uuid(); service_id uuid:=gen_random_uuid(); empty_service uuid:=gen_random_uuid();
  dst_product uuid:=gen_random_uuid(); dst_service uuid:=gen_random_uuid();
  fixture_sale uuid; bad_sale uuid; f record; result jsonb; baseline jsonb; summary jsonb; history jsonb;
  from_at timestamptz:='2026-09-05T03:00:00Z'; to_at timestamptz:='2026-09-09T03:00:00Z';
  original_timezone text:=current_setting('TimeZone'); prices numeric[]; kinds text[];
  idx integer; day_value date; groups integer:=0;
BEGIN
  SELECT * INTO STRICT f FROM pg_proc WHERE oid='public.get_revenue_by_day(uuid,timestamptz,timestamptz)'::regprocedure;
  PERFORM pg_temp.bf241_assert(NOT f.prosecdef AND f.provolatile='s' AND f.proretset AND f.prorettype='record'::regtype
    AND f.pronargs=3 AND f.pronargdefaults=0 AND f.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
    AND f.proargnames=ARRAY['p_business_id','p_from','p_to','date','service_revenue','product_revenue','total_revenue']::text[]
    AND f.proargmodes='{i,i,i,t,t,t,t}'::"char"[]
    AND f.proallargtypes=ARRAY['uuid'::regtype,'timestamptz'::regtype,'timestamptz'::regtype,'date'::regtype,'text'::regtype,'text'::regtype,'text'::regtype]::oid[]
    AND f.proconfig=ARRAY['search_path=""']::text[],'exact approved TABLE signature/types/modes/language/STABLE/INVOKER/search_path');
  PERFORM pg_temp.bf241_assert(has_function_privilege('authenticated',f.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',f.oid,'EXECUTE') AND NOT has_function_privilege('service_role',f.oid,'EXECUTE')
    AND NOT EXISTS(SELECT 1 FROM aclexplode(f.proacl) a WHERE a.grantee NOT IN(f.proowner,'authenticated'::regrole)), 'exact function ACL');
  PERFORM pg_temp.bf241_assert((SELECT count(*)=19 AND bool_and(c.relrowsecurity AND NOT c.relforcerowsecurity)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p'))
    AND (SELECT count(*)=41 FROM pg_policies WHERE schemaname='public'),'RLS/policies unchanged');
  groups:=groups+1;

  INSERT INTO auth.users(id) SELECT unnest(users);
  INSERT INTO public.businesses(id,name,timezone) VALUES(b,'BF241 own','America/Argentina/Buenos_Aires'),
    (other_b,'BF241 foreign','UTC'),(empty_b,'BF241 empty','UTC'),(dst_b,'BF241 DST','America/New_York');
  INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES
    (b,users[1],'OWNER',true),(b,users[2],'BARBER',true),(b,users[3],'OWNER',false),
    (other_b,users[4],'OWNER',true),(empty_b,users[1],'OWNER',true),(dst_b,users[1],'OWNER',true);
  INSERT INTO public.services(id,business_id,name,price,duration_minutes) VALUES
    (service_id,b,'Current service',999,30),(empty_service,empty_b,'Empty service',999,30),(dst_service,dst_b,'DST service',999,30);
  INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost) VALUES
    (product_id,b,'Current product',999,888),(dst_product,dst_b,'DST product',999,888);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf241_assert(pg_temp.bf241_rows(empty_b,NULL,NULL)='[]'::jsonb,'ALL_TIME without qualifying history returns empty set, no current day');
  result:=pg_temp.bf241_rows(empty_b,'2026-07-01T00:00Z','2026-07-04T00:00Z');
  PERFORM pg_temp.bf241_assert(result='[{"date":"2026-07-01","service_revenue":"0.00","product_revenue":"0.00","total_revenue":"0.00"},{"date":"2026-07-02","service_revenue":"0.00","product_revenue":"0.00","total_revenue":"0.00"},{"date":"2026-07-03","service_revenue":"0.00","product_revenue":"0.00","total_revenue":"0.00"}]'::jsonb,
    'bounded empty history still emits all days, zero money text, upper midnight exclusive');
  PERFORM pg_temp.bf241_assert((SELECT pg_typeof(r.date)='date'::regtype AND pg_typeof(r.service_revenue)='text'::regtype
    AND pg_typeof(r.product_revenue)='text'::regtype AND pg_typeof(r.total_revenue)='text'::regtype
    FROM public.get_revenue_by_day(empty_b,'2026-07-01','2026-07-02') r),'actual row types date/text/text/text');
  PERFORM pg_temp.bf241_assert((SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(result->0) AS k(key))
    =ARRAY['date','product_revenue','service_revenue','total_revenue']::text[],'exact four keys, no metadata');
  PERFORM pg_temp.bf241_error(format('SELECT * FROM public.get_revenue_by_day(%L,NULL,%L)',b,to_at),'22023','INVALID_INPUT');
  PERFORM pg_temp.bf241_error(format('SELECT * FROM public.get_revenue_by_day(%L,%L,NULL)',b,from_at),'22023','INVALID_INPUT');
  PERFORM pg_temp.bf241_error(format('SELECT * FROM public.get_revenue_by_day(%L,%L,%L)',b,from_at,from_at),'22023','INVALID_INPUT');
  PERFORM pg_temp.bf241_error(format('SELECT * FROM public.get_revenue_by_day(%L,%L,%L)',b,to_at,from_at),'22023','INVALID_INPUT');
  PERFORM pg_temp.bf241_error(format('SELECT * FROM public.get_revenue_by_day(%L,%L,%L)',b,'-infinity',to_at),'22023','INVALID_INPUT');
  PERFORM pg_temp.bf241_error(format('SELECT * FROM public.get_revenue_by_day(%L,%L,%L)',b,from_at,'infinity'),'22023','INVALID_INPUT');
  groups:=groups+1;

  PERFORM set_config('role','postgres',true);
  fixture_sale:=pg_temp.bf241_sale(b,users[1],product_id,service_id,from_at,'COMPLETED',ARRAY[10],ARRAY['SERVICE']);
  PERFORM pg_temp.bf241_sale(b,users[1],product_id,service_id,'2026-09-05T23:50Z','COMPLETED',ARRAY[10,20],ARRAY['SERVICE','PRODUCT'],3);
  PERFORM pg_temp.bf241_sale(b,users[1],product_id,service_id,'2026-09-06T02:59Z','COMPLETED',ARRAY[2],ARRAY['PRODUCT']);
  PERFORM pg_temp.bf241_sale(b,users[1],product_id,service_id,to_at-interval '1 microsecond','COMPLETED',ARRAY[5],ARRAY['PRODUCT']);
  PERFORM pg_temp.bf241_sale(b,users[1],product_id,service_id,to_at,'COMPLETED',ARRAY[100],ARRAY['PRODUCT']);
  PERFORM pg_temp.bf241_sale(b,users[1],product_id,service_id,from_at-interval '1 microsecond','COMPLETED',ARRAY[200],ARRAY['SERVICE']);
  PERFORM pg_temp.bf241_sale(b,users[1],product_id,service_id,'2020-01-01','DRAFT',ARRAY[300],ARRAY['SERVICE']);
  PERFORM pg_temp.bf241_sale(b,users[1],product_id,service_id,'2030-01-01','VOIDED',ARRAY[400],ARRAY['PRODUCT']);
  PERFORM pg_temp.bf241_sale(b,users[1],product_id,service_id,NULL,'VOIDED',ARRAY[500],ARRAY['PRODUCT']);
  INSERT INTO public.payments(business_id,sale_id,payment_method,amount,created_by)
    VALUES(b,fixture_sale,'CASH',4,users[1]),(b,fixture_sale,'CASH',6,users[1]);
  SELECT jsonb_agg(to_jsonb(item) ORDER BY item.id) INTO history
    FROM public.sale_items item JOIN public.sales s ON s.id=item.sale_id WHERE s.business_id=b;
  PERFORM set_config('role','authenticated',true);
  result:=pg_temp.bf241_rows(b,from_at,to_at);baseline:=result;
  PERFORM pg_temp.bf241_assert(result='[{"date":"2026-09-05","service_revenue":"19.00","product_revenue":"20.00","total_revenue":"39.00"},{"date":"2026-09-06","service_revenue":"0.00","product_revenue":"0.00","total_revenue":"0.00"},{"date":"2026-09-07","service_revenue":"0.00","product_revenue":"0.00","total_revenue":"0.00"},{"date":"2026-09-08","service_revenue":"0.00","product_revenue":"5.00","total_revenue":"5.00"}]'::jsonb,
    'mixed sales same civil day, historical discounts, local-not-UTC bucket, two gaps, lower/upper precision, ASC');
  PERFORM pg_temp.bf241_assert((SELECT bool_and((r.service_revenue::numeric+r.product_revenue::numeric)=r.total_revenue::numeric)
    FROM public.get_revenue_by_day(b,from_at,to_at) r),'each day service+product=total, no payment fanout');
  summary:=public.get_dashboard_summary(b,from_at,to_at);
  PERFORM pg_temp.bf241_assert((SELECT sum(r.total_revenue::numeric)=(summary->>'total_revenue')::numeric
    AND sum(r.service_revenue::numeric)=(summary->>'service_revenue')::numeric
    AND sum(r.product_revenue::numeric)=(summary->>'product_revenue')::numeric
    FROM public.get_revenue_by_day(b,from_at,to_at) r),'BF240/BF241 identical revenue attribution for same range');
  PERFORM pg_temp.bf241_assert(jsonb_array_length(pg_temp.bf241_rows(b,'2026-09-05T04:00Z','2026-09-05T06:00Z'))=1,
    'positive intraday interval includes its one civil day');
  result:=pg_temp.bf241_rows(b,from_at,'2026-09-06T15:00Z');
  PERFORM pg_temp.bf241_assert(jsonb_array_length(result)=2 AND result->1->>'date'='2026-09-06','intraday upper includes intersected final civil day');
  PERFORM pg_temp.bf241_assert(pg_temp.bf241_rows(b,from_at,from_at+interval '1 microsecond')->0->>'total_revenue'='10.00','microsecond upper bound and lower inclusion');
  PERFORM set_config('TimeZone','Asia/Tokyo',true);
  PERFORM pg_temp.bf241_assert(pg_temp.bf241_rows(b,from_at,to_at)=baseline,'session timezone cannot change spine/buckets');
  PERFORM set_config('TimeZone',original_timezone,true);
  UPDATE public.services SET name='Renamed',price=0,is_active=false WHERE id=service_id;
  UPDATE public.products SET name='Renamed',sale_price=0,default_purchase_cost=123,is_active=false WHERE id=product_id;
  PERFORM pg_temp.bf241_assert(pg_temp.bf241_rows(b,from_at,to_at)=baseline,'current name/price/cost/archive cannot change historical attribution');
  PERFORM pg_temp.bf241_assert((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.id)=history
    FROM public.sale_items item JOIN public.sales s ON s.id=item.sale_id WHERE s.business_id=b),'analytics never persists allocations or rewrites snapshots');
  groups:=groups+1;

  PERFORM set_config('role','postgres',true);
  PERFORM pg_temp.bf241_sale(empty_b,users[1],NULL,empty_service,'2026-01-02T12:00Z','COMPLETED',ARRAY[0],ARRAY['SERVICE']);
  PERFORM pg_temp.bf241_sale(empty_b,users[1],NULL,empty_service,'2026-01-05T12:00Z','COMPLETED',ARRAY[2],ARRAY['SERVICE']);
  PERFORM pg_temp.bf241_sale(empty_b,users[1],NULL,empty_service,'2020-01-01','DRAFT',ARRAY[9],ARRAY['SERVICE']);
  PERFORM pg_temp.bf241_sale(empty_b,users[1],NULL,empty_service,'2030-01-01','VOIDED',ARRAY[9],ARRAY['SERVICE']);
  PERFORM set_config('role','authenticated',true);
  result:=pg_temp.bf241_rows(empty_b,NULL,NULL);
  PERFORM pg_temp.bf241_assert(jsonb_array_length(result)=4 AND result->0->>'date'='2026-01-02'
    AND result->3->>'date'='2026-01-05' AND result->0->>'total_revenue'='0.00' AND result->3->>'total_revenue'='2.00'
    AND result->1->>'total_revenue'='0.00' AND result->2->>'total_revenue'='0.00','ALL_TIME qualifying first/last inclusive, zero-total sale qualifies, internal gaps, DRAFT/VOIDED ignored');
  groups:=groups+1;

  PERFORM set_config('role','postgres',true);
  PERFORM pg_temp.bf241_sale(b,users[1],product_id,service_id,'2026-05-01T12:00Z','COMPLETED',
    ARRAY[0.01,0.01,0.01,0.01],ARRAY['SERVICE','PRODUCT','SERVICE','PRODUCT'],0.02);
  PERFORM pg_temp.bf241_sale(b,users[1],product_id,service_id,'2026-05-02T12:00Z','COMPLETED',
    ARRAY[0.01,0.02,0.03],ARRAY['SERVICE','PRODUCT','SERVICE'],0.03);
  PERFORM pg_temp.bf241_sale(b,users[1],product_id,service_id,'2026-05-03T12:00Z','COMPLETED',
    ARRAY[0,0.01,0,0.02,0],ARRAY['SERVICE','PRODUCT','SERVICE','SERVICE','PRODUCT'],0.02);
  SELECT array_agg(0.01::numeric ORDER BY n),array_agg(CASE WHEN n%2=1 THEN 'SERVICE' ELSE 'PRODUCT' END ORDER BY n)
    INTO prices,kinds FROM generate_series(1,20) AS v(n);
  PERFORM pg_temp.bf241_sale(b,users[1],product_id,service_id,'2026-05-04T12:00Z','COMPLETED',prices,kinds,0.10);
  PERFORM pg_temp.bf241_sale(b,users[1],product_id,service_id,'2026-05-05T12:00Z','COMPLETED',ARRAY[0,0],ARRAY['SERVICE','PRODUCT']);
  PERFORM pg_temp.bf241_sale(b,users[1],product_id,service_id,'2026-05-06T12:00Z','COMPLETED',ARRAY[10],ARRAY['PRODUCT'],10);
  PERFORM pg_temp.bf241_sale(b,users[1],product_id,service_id,'2026-05-07T12:00Z','COMPLETED',ARRAY[9999999999.99],ARRAY['SERVICE']);
  PERFORM pg_temp.bf241_sale(b,users[1],product_id,service_id,'2026-05-07T13:00Z','COMPLETED',ARRAY[9999999999.99],ARRAY['PRODUCT']);
  PERFORM pg_temp.bf241_sale(b,users[1],product_id,service_id,'2026-05-08T12:00Z','COMPLETED',ARRAY[0.29,0.10],ARRAY['SERVICE','PRODUCT']);
  PERFORM set_config('role','authenticated',true);
  result:=pg_temp.bf241_rows(b,'2026-05-01T03:00Z','2026-05-09T03:00Z');
  PERFORM pg_temp.bf241_assert(result->0->>'service_revenue'='0.00' AND result->0->>'product_revenue'='0.02','D05 four cents no negative final residual');
  PERFORM pg_temp.bf241_assert(result->1->>'service_revenue'='0.02' AND result->1->>'product_revenue'='0.01','weighted first/middle/last cumulative rounding');
  PERFORM pg_temp.bf241_assert(result->2->>'service_revenue'='0.01' AND result->2->>'product_revenue'='0.00','zero gross first/middle/last no discount');
  PERFORM pg_temp.bf241_assert(result->3->>'service_revenue'='0.00' AND result->3->>'product_revenue'='0.10','many one-cent lines exact allocation');
  PERFORM pg_temp.bf241_assert(result->4->>'total_revenue'='0.00' AND result->5->>'total_revenue'='0.00','zero subtotal and full discount');
  PERFORM pg_temp.bf241_assert(result->6->>'total_revenue'='19999999999.98' AND result->7->>'total_revenue'='0.39','unbounded NUMERIC sum and decimal precision');
  FOR day_value IN SELECT generate_series('2026-05-01'::timestamp,'2026-05-08'::timestamp,interval '1 day')::date LOOP
    summary:=public.get_dashboard_summary(b,day_value::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires',(day_value+1)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires');
    PERFORM pg_temp.bf241_assert((SELECT r.total_revenue=summary->>'total_revenue' AND r.service_revenue=summary->>'service_revenue'
      AND r.product_revenue=summary->>'product_revenue' FROM public.get_revenue_by_day(b,
      day_value::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires',(day_value+1)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires') r),
      'BF240 reconciliation for every D05/numeric edge day');
  END LOOP;
  groups:=groups+1;

  PERFORM set_config('role','postgres',true);
  PERFORM pg_temp.bf241_sale(dst_b,users[1],dst_product,dst_service,'2026-11-01T05:30Z','COMPLETED',ARRAY[1],ARRAY['SERVICE']);
  PERFORM pg_temp.bf241_sale(dst_b,users[1],dst_product,dst_service,'2026-11-01T06:30Z','COMPLETED',ARRAY[2],ARRAY['PRODUCT']);
  PERFORM pg_temp.bf241_sale(dst_b,users[1],dst_product,dst_service,'2026-03-08T06:30Z','COMPLETED',ARRAY[4],ARRAY['SERVICE']);
  PERFORM pg_temp.bf241_sale(dst_b,users[1],dst_product,dst_service,'2026-03-08T07:30Z','COMPLETED',ARRAY[5],ARRAY['PRODUCT']);
  PERFORM pg_temp.bf241_sale(dst_b,users[1],dst_product,dst_service,'2026-03-09T04:00Z','COMPLETED',ARRAY[100],ARRAY['PRODUCT']);
  PERFORM set_config('role','authenticated',true);
  result:=pg_temp.bf241_rows(dst_b,'2026-10-31T04:00Z','2026-11-03T05:00Z');
  PERFORM pg_temp.bf241_assert(jsonb_array_length(result)=3 AND result->0->>'date'='2026-10-31' AND result->2->>'date'='2026-11-02'
    AND result->1->>'date'='2026-11-01' AND result->1->>'total_revenue'='3.00','25-hour DST repeated hours share one civil date, adjacent gaps exactly once');
  result:=pg_temp.bf241_rows(dst_b,'2026-03-08T05:00Z','2026-03-09T04:00Z');
  PERFORM pg_temp.bf241_assert(jsonb_array_length(result)=1 AND result->0->>'date'='2026-03-08'
    AND result->0->>'service_revenue'='4.00' AND result->0->>'product_revenue'='5.00','23-hour DST day, nonexistent civil hour never fabricated, upper midnight excluded');
  baseline:=pg_temp.bf241_rows(dst_b,'2026-03-07T05:00Z','2026-03-10T04:00Z');
  PERFORM pg_temp.bf241_assert(jsonb_array_length(baseline)=3 AND baseline->0->>'total_revenue'='0.00'
    AND baseline->2->>'total_revenue'='100.00','civil spine across spring DST does not skip/repeat dates');
  PERFORM set_config('TimeZone','Pacific/Auckland',true);
  PERFORM pg_temp.bf241_assert(pg_temp.bf241_rows(dst_b,'2026-03-07T05:00Z','2026-03-10T04:00Z')=baseline,'DST output independent of session timezone');
  PERFORM set_config('TimeZone',original_timezone,true);
  groups:=groups+1;

  PERFORM set_config('role','postgres',true);
  INSERT INTO public.sales(business_id,operation_id,status,subtotal,total,created_by)
    VALUES(other_b,gen_random_uuid(),'COMPLETED',0,0,users[4]);
  bad_sale:=pg_temp.bf241_sale(b,users[1],product_id,service_id,NULL,'COMPLETED',ARRAY[1],ARRAY['SERVICE']);
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf241_error(format('SELECT * FROM public.get_revenue_by_day(%L,NULL,NULL)',b),'PT409','INVALID_HISTORY');
  PERFORM pg_temp.bf241_error(format('SELECT * FROM public.get_revenue_by_day(%L,%L,%L)',b,'2050-01-01','2051-01-01'),'PT409','INVALID_HISTORY');
  PERFORM set_config('role','postgres',true);UPDATE public.sales SET status='DRAFT' WHERE id=bad_sale;
  bad_sale:=pg_temp.bf241_sale(b,users[1],product_id,service_id,'2026-04-10T12:00Z','COMPLETED',ARRAY[1],ARRAY['SERVICE']);
  UPDATE public.sales SET subtotal=2,total=2 WHERE id=bad_sale;
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf241_error(format('SELECT count(*) FROM public.get_revenue_by_day(%L,%L,%L)',b,'2026-04-01','2026-04-15'),'PT409','INVALID_HISTORY');
  PERFORM set_config('role','postgres',true);UPDATE public.sales SET status='DRAFT' WHERE id=bad_sale;
  INSERT INTO public.sales(business_id,operation_id,status,subtotal,total,sold_at,created_by)
    VALUES(b,gen_random_uuid(),'COMPLETED',0,0,'2026-04-05',users[1]);
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf241_error(format('SELECT * FROM public.get_revenue_by_day(%L,%L,%L)',b,'2026-04-01','2026-04-15'),'PT409','INVALID_HISTORY');
  PERFORM pg_temp.bf241_assert(pg_temp.bf241_rows(b,from_at,to_at)->0->>'total_revenue'='39.00','unrelated invalid tenant/history outside range cannot change authorized ranged result');
  groups:=groups+1;

  FOREACH idx IN ARRAY ARRAY[2,3,4,5] LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[idx],'role','authenticated')::text,true);
    PERFORM pg_temp.bf241_error(format('SELECT * FROM public.get_revenue_by_day(%L,NULL,NULL)',b),'42501','ACCESS_DENIED');
    PERFORM pg_temp.bf241_error(format('SELECT * FROM public.get_revenue_by_day(%L,NULL,%L)',b,to_at),'42501','ACCESS_DENIED');
  END LOOP;
  PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
  PERFORM pg_temp.bf241_error(format('SELECT * FROM public.get_revenue_by_day(%L,NULL,NULL)',b),'42501','ACCESS_DENIED');
  PERFORM set_config('role','anon',true);
  PERFORM pg_temp.bf241_error(format('SELECT * FROM public.get_revenue_by_day(%L,NULL,NULL)',b),'42501');
  PERFORM set_config('role','postgres',true);
  UPDATE public.business_members SET is_active=false WHERE business_id=b AND user_id=users[1];
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf241_error(format('SELECT * FROM public.get_revenue_by_day(%L,NULL,NULL)',b),'42501','ACCESS_DENIED');
  PERFORM pg_temp.bf241_error('SELECT * FROM public.get_revenue_by_day(NULL,NULL,NULL)','42501','ACCESS_DENIED');
  PERFORM pg_temp.bf241_error(format('SELECT * FROM public.get_revenue_by_day(%L,NULL,NULL)',gen_random_uuid()),'42501','ACCESS_DENIED');
  PERFORM set_config('role','postgres',true);
  groups:=groups+1;
  RAISE NOTICE 'BF241 PASS: % groups; exact approved TABLE, OWNER/RLS/tenants, D05/D06/D22, civil zero-fill/ALL_TIME/DST, BF240 reconciliation',groups;
END $$;
ROLLBACK;
