\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.bf240_assert(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'BF240: %', label; END IF;
END $$;
CREATE FUNCTION pg_temp.bf240_error(statement text, expected text, marker text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE code text; message text; detail text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE, message=MESSAGE_TEXT, detail=PG_EXCEPTION_DETAIL;
  END;
  IF code IS DISTINCT FROM expected OR (marker IS NOT NULL AND position(marker IN message||COALESCE(detail,''))=0)
    THEN RAISE EXCEPTION 'BF240 expected SQLSTATE % / marker %, got %', expected, marker, code; END IF;
END $$;
-- Privileged historical fixtures exercise the reader, not substitute checkout writers.
CREATE FUNCTION pg_temp.bf240_sale(b uuid, u uuid, p uuid, s uuid, sold timestamptz,
  state text, prices numeric[], kinds text[], cost numeric, discount numeric DEFAULT 0)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE sale_id uuid:=gen_random_uuid(); gross numeric; i integer;
BEGIN
  SELECT sum(x) INTO gross FROM unnest(prices) AS v(x);
  INSERT INTO public.sales(id,business_id,operation_id,status,subtotal,discount,total,sold_at,created_by)
    VALUES(sale_id,b,gen_random_uuid(),state,gross,discount,gross-discount,sold,u);
  FOR i IN 1..cardinality(prices) LOOP
    INSERT INTO public.sale_items(id,sale_id,item_type,service_id,product_id,item_name_snapshot,
      unit_price_snapshot,quantity,line_total,unit_cost_snapshot)
    VALUES((left(sale_id::text,24)||lpad(i::text,12,'0'))::uuid,sale_id,kinds[i],
      CASE WHEN kinds[i]='SERVICE' THEN s END, CASE WHEN kinds[i]='PRODUCT' THEN p END,
      'Historical line '||i,prices[i],1,prices[i],CASE WHEN kinds[i]='PRODUCT' THEN cost END);
  END LOOP;
  RETURN sale_id;
END $$;

DO $$
DECLARE
  b uuid:=gen_random_uuid(); foreign_b uuid:=gen_random_uuid(); empty_b uuid:=gen_random_uuid(); dst_b uuid:=gen_random_uuid();
  users uuid[]:=ARRAY(SELECT gen_random_uuid() FROM generate_series(1,5));
  member_id uuid:=gen_random_uuid(); client_id uuid:=gen_random_uuid();
  product_id uuid:=gen_random_uuid(); service_id uuid:=gen_random_uuid(); category_id uuid:=gen_random_uuid();
  dst_category uuid:=gen_random_uuid(); empty_category uuid:=gen_random_uuid();
  dst_service uuid:=gen_random_uuid(); dst_client uuid:=gen_random_uuid(); dst_member uuid:=gen_random_uuid();
  sale_id uuid; qty_sale uuid; bad_sale uuid; purchase_id uuid; expense_id uuid;
  from_at timestamptz:='2026-09-01T03:00:00Z'; to_at timestamptz:='2026-10-01T03:00:00Z';
  original_timezone text:=current_setting('TimeZone');
  result jsonb; baseline jsonb; history jsonb; original_expense jsonb; purchase jsonb; f record;
  keys text[]:=ARRAY['active_clients','appointments','average_ticket','cancellations','expenses','merchandise_purchases',
    'no_shows','product_revenue','products_sold','profit','service_revenue','total_revenue'];
  i integer; state text; prices numeric[]; kinds text[]; groups integer:=0;
BEGIN
  SELECT * INTO STRICT f FROM pg_proc WHERE oid='public.get_dashboard_summary(uuid,timestamptz,timestamptz)'::regprocedure;
  PERFORM pg_temp.bf240_assert(NOT f.prosecdef AND f.provolatile='s' AND NOT f.proretset
    AND f.prorettype='jsonb'::regtype AND f.pronargs=3 AND f.pronargdefaults=0
    AND f.proargnames=ARRAY['p_business_id','p_from','p_to']::text[]
    AND f.proconfig=ARRAY['search_path=""']::text[], 'exact signature / STABLE / INVOKER / empty search_path');
  PERFORM pg_temp.bf240_assert(has_function_privilege('authenticated',f.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',f.oid,'EXECUTE')
    AND NOT has_function_privilege('service_role',f.oid,'EXECUTE')
    AND NOT EXISTS(SELECT 1 FROM aclexplode(f.proacl) a WHERE a.grantee NOT IN(f.proowner,'authenticated'::regrole)), 'exact function ACL');
  PERFORM pg_temp.bf240_assert((SELECT count(*)=19 AND bool_and(c.relrowsecurity AND NOT c.relforcerowsecurity)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p'))
    AND (SELECT count(*)=41 FROM pg_policies WHERE schemaname='public'), 'RLS and policies unchanged');
  groups:=groups+1;

  INSERT INTO auth.users(id) SELECT unnest(users);
  INSERT INTO public.businesses(id,name,timezone) VALUES(b,'BF240 own','America/Argentina/Buenos_Aires'),
    (foreign_b,'BF240 foreign','UTC'),(empty_b,'BF240 empty','UTC'),(dst_b,'BF240 DST','America/New_York');
  INSERT INTO public.business_members(id,business_id,user_id,role,is_active) VALUES(member_id,b,users[1],'OWNER',true);
  INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES
    (b,users[2],'BARBER',true),(b,users[3],'OWNER',false),(foreign_b,users[4],'OWNER',true),
    (empty_b,users[1],'OWNER',true),(dst_b,users[1],'OWNER',true);
  INSERT INTO public.clients(id,business_id,first_name,created_at) VALUES(client_id,b,'Current active','2027-01-01T00:00Z');
  INSERT INTO public.clients(business_id,first_name,is_active) VALUES(b,'Archived',false),(foreign_b,'Foreign active',true);
  INSERT INTO public.services(id,business_id,name,price,duration_minutes) VALUES(service_id,b,'Current service',100,30);
  INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost) VALUES(product_id,b,'Current product',200,99);
  INSERT INTO public.expense_categories(id,business_id,name) VALUES(category_id,b,'Goods'),
    (dst_category,dst_b,'DST'),(empty_category,empty_b,'Empty');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
  result:=public.get_dashboard_summary(empty_b,NULL,NULL);
  PERFORM pg_temp.bf240_assert(result='{"total_revenue":"0.00","service_revenue":"0.00","product_revenue":"0.00", "expenses":"0.00","merchandise_purchases":"0.00","profit":"0.00","appointments":"0","active_clients":"0","average_ticket":null,"products_sold":"0","cancellations":"0","no_shows":"0"}'::jsonb,
    'authorized empty exact12 fields / zero sums/counts / NULL average');
  PERFORM pg_temp.bf240_assert((SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(result) AS k(key))=keys,
    'exact public return keys, no COGS/count/business/range metadata');
  PERFORM pg_temp.bf240_error(format('SELECT public.get_dashboard_summary(%L,NULL,%L)',b,to_at),'22023','INVALID_INPUT');
  PERFORM pg_temp.bf240_error(format('SELECT public.get_dashboard_summary(%L,%L,NULL)',b,from_at),'22023','INVALID_INPUT');
  PERFORM pg_temp.bf240_error(format('SELECT public.get_dashboard_summary(%L,%L,%L)',b,from_at,from_at),'22023','INVALID_INPUT');
  PERFORM pg_temp.bf240_error(format('SELECT public.get_dashboard_summary(%L,%L,%L)',b,to_at,from_at),'22023','INVALID_INPUT');
  PERFORM pg_temp.bf240_error(format('SELECT public.get_dashboard_summary(%L,%L,%L)',b,'-infinity',to_at),'22023','INVALID_INPUT');
  PERFORM pg_temp.bf240_error(format('SELECT public.get_dashboard_summary(%L,%L,%L)',b,from_at,'infinity'),'22023','INVALID_INPUT');
  groups:=groups+1;

  PERFORM set_config('role','postgres',true);
  -- Mixed sale: service10, product20 + product20; discount5 =>9+18+18.
  sale_id:=pg_temp.bf240_sale(b,users[1],product_id,service_id,'2026-09-20T12:00Z','COMPLETED',
    ARRAY[10,20,20],ARRAY['SERVICE','PRODUCT','PRODUCT'],3,5);
  PERFORM pg_temp.bf240_sale(b,users[1],product_id,service_id,'2026-09-30T12:00Z','COMPLETED',ARRAY[5],ARRAY['SERVICE'],0);
  PERFORM pg_temp.bf240_sale(b,users[1],product_id,service_id,to_at,'COMPLETED',ARRAY[100],ARRAY['PRODUCT'],3);
  PERFORM pg_temp.bf240_sale(b,users[1],product_id,service_id,from_at-interval '1 microsecond','COMPLETED',ARRAY[90],ARRAY['PRODUCT'],3);
  PERFORM pg_temp.bf240_sale(b,users[1],product_id,service_id,'2026-09-10T12:00Z','DRAFT',ARRAY[300],ARRAY['PRODUCT'],3);
  PERFORM pg_temp.bf240_sale(b,users[1],product_id,service_id,NULL,'VOIDED',ARRAY[400],ARRAY['PRODUCT'],3);
  -- Payments must not multiply revenue; the reader never joins them.
  INSERT INTO public.payments(business_id,sale_id,payment_method,amount,created_by)
    VALUES(b,sale_id,'CASH',20,users[1]),(b,sale_id,'CASH',25,users[1]);
  i:=0;
  FOREACH state IN ARRAY ARRAY['PENDING','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW'] LOOP
    INSERT INTO public.appointments(business_id,client_id,barber_member_id,start_at,end_at,status,created_by)
      VALUES(b,client_id,member_id,from_at+i*interval '1 hour',from_at+(i+1)*interval '1 hour',state,users[1]);
    i:=i+1;
  END LOOP;
  INSERT INTO public.appointments(business_id,client_id,barber_member_id,start_at,end_at,status,created_by) VALUES
    (b,client_id,member_id,to_at,to_at+interval '1 hour','CANCELLED',users[1]),
    (b,client_id,member_id,from_at-interval '1 hour',from_at+interval '1 hour','NO_SHOW',users[1]);
  PERFORM set_config('role','authenticated',true);
  INSERT INTO public.expenses(business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by)
    VALUES(b,category_id,'MANUAL','Manual',7.50,'CASH','2026-09-01',users[1]),
      (b,category_id,'MANUAL','Zero',0,'CASH','2026-09-01',users[1]),
      (b,category_id,'MANUAL','Exclusive end',30,'CASH','2026-10-01',users[1]);
  purchase:=public.complete_purchase(b,gen_random_uuid(),'Supplier',category_id,'CASH','2026-09-20T12:00Z',NULL,
    jsonb_build_array(jsonb_build_object('productId',product_id,'quantity',5,'unitCost','20.00')));
  purchase_id:=(purchase->'purchase'->>'id')::uuid;expense_id:=(purchase->'expense'->>'id')::uuid;
  SELECT to_jsonb(e) INTO original_expense FROM public.expenses e WHERE e.id=expense_id;
  SELECT jsonb_agg(to_jsonb(item) ORDER BY item.id) INTO history FROM public.sale_items item JOIN public.sales s ON s.id=item.sale_id WHERE s.business_id=b;
  result:=public.get_dashboard_summary(b,from_at,to_at);baseline:=result;
  PERFORM pg_temp.bf240_assert(result='{"total_revenue":"50.00","service_revenue":"14.00","product_revenue":"36.00","expenses":"7.50","merchandise_purchases":"100.00","profit":"36.50","appointments":"6","active_clients":"1","average_ticket":"25.00","products_sold":"2","cancellations":"1","no_shows":"1"}'::jsonb,
    'mixed net revenue / historical COGS6 / manual expense / purchase separate / all operational metrics');
  PERFORM pg_temp.bf240_assert((result->>'service_revenue')::numeric+(result->>'product_revenue')::numeric=(result->>'total_revenue')::numeric,
    'service+product=total, discount exact, no payment fanout');
  PERFORM pg_temp.bf240_assert(public.get_dashboard_summary(b,'2026-09-20T12:00Z','2026-09-20T12:00:00.000001Z')->>'total_revenue'='45.00',
    'lower bound inclusive / submicrosecond precision / no inferred whole-day sale filter');
  PERFORM set_config('TimeZone','Asia/Tokyo',true);
  PERFORM pg_temp.bf240_assert(public.get_dashboard_summary(b,from_at,to_at)=baseline,'session timezone does not affect business civil expense boundary');
  -- JSON timestamp serialization follows the session timezone. Restore it before
  -- comparing complete historical rows, while retaining the independent metric assertion above.
  PERFORM set_config('TimeZone',original_timezone,true);
  PERFORM pg_temp.bf240_assert(public.get_dashboard_summary(b,NULL,NULL)->>'total_revenue'='240.00','ALL_TIME includes before/end sales, excludes DRAFT/VOIDED');
  groups:=groups+1;

  -- Current catalog name/price/reference cost never changes historical attribution/COGS.
  UPDATE public.products SET name='Renamed',sale_price=999,default_purchase_cost=777,is_active=false WHERE id=product_id;
  UPDATE public.services SET name='Renamed',price=888,is_active=false WHERE id=service_id;
  PERFORM pg_temp.bf240_assert(public.get_dashboard_summary(b,from_at,to_at)=baseline,'catalog edit/archive cannot reprice or reclassify historical lines');
  PERFORM public.void_purchase(b,gen_random_uuid(),purchase_id,'Correct purchase');
  result:=public.get_dashboard_summary(b,from_at,to_at);
  PERFORM pg_temp.bf240_assert(result->>'merchandise_purchases'='0.00' AND result->>'expenses'='7.50'
    AND result->>'profit'='36.50','real purchase void only removes effective merchandise metric, never double-subtract');
  PERFORM pg_temp.bf240_assert((SELECT to_jsonb(e)=original_expense FROM public.expenses e WHERE e.id=expense_id)
    AND (SELECT jsonb_agg(to_jsonb(item) ORDER BY item.id)=history FROM public.sale_items item JOIN public.sales s ON s.id=item.sale_id WHERE s.business_id=b),
    'read and purchase correction preserve original expense and sale snapshots');
  groups:=groups+1;

  PERFORM set_config('role','postgres',true);
  PERFORM pg_temp.bf240_sale(b,users[1],product_id,service_id,'2026-06-01T12:00Z','COMPLETED',
    ARRAY[0.01,0.01,0.01,0.01],ARRAY['SERVICE','PRODUCT','SERVICE','PRODUCT'],0,0.02);
  PERFORM set_config('role','authenticated',true);
  result:=public.get_dashboard_summary(b,'2026-06-01T03:00Z','2026-06-02T03:00Z');
  PERFORM pg_temp.bf240_assert(result->>'service_revenue'='0.00' AND result->>'product_revenue'='0.02'
    AND result->>'total_revenue'='0.02' AND result->>'profit'='0.02','D05 four one-cent lines: allocations1/0/1/0, never negative last residual');
  PERFORM set_config('role','postgres',true);
  PERFORM pg_temp.bf240_sale(b,users[1],product_id,service_id,'2026-06-02T12:00Z','COMPLETED',
    ARRAY[0.01,0.02,0.03],ARRAY['SERVICE','PRODUCT','SERVICE'],0,0.03);
  PERFORM set_config('role','authenticated',true);
  result:=public.get_dashboard_summary(b,'2026-06-02T03:00Z','2026-06-03T03:00Z');
  PERFORM pg_temp.bf240_assert(result->>'service_revenue'='0.02' AND result->>'product_revenue'='0.01'
    AND result->>'total_revenue'='0.03','first/middle/last weighted cumulative rounding');
  PERFORM set_config('role','postgres',true);
  PERFORM pg_temp.bf240_sale(b,users[1],product_id,service_id,'2026-06-03T12:00Z','COMPLETED',
    ARRAY[0,0.01,0,0.02,0],ARRAY['SERVICE','PRODUCT','SERVICE','SERVICE','PRODUCT'],0,0.02);
  PERFORM set_config('role','authenticated',true);
  result:=public.get_dashboard_summary(b,'2026-06-03T03:00Z','2026-06-04T03:00Z');
  PERFORM pg_temp.bf240_assert(result->>'service_revenue'='0.01' AND result->>'product_revenue'='0.00'
    AND result->>'products_sold'='2','zero-gross first/middle/last gets zero discount; free product quantities still count');
  PERFORM set_config('role','postgres',true);
  SELECT array_agg(0.01::numeric ORDER BY n),array_agg(CASE WHEN n%2=1 THEN 'SERVICE' ELSE 'PRODUCT' END ORDER BY n)
    INTO prices,kinds FROM generate_series(1,20) AS v(n);
  PERFORM pg_temp.bf240_sale(b,users[1],product_id,service_id,'2026-06-04T12:00Z','COMPLETED',prices,kinds,0,0.10);
  PERFORM set_config('role','authenticated',true);
  result:=public.get_dashboard_summary(b,'2026-06-04T03:00Z','2026-06-05T03:00Z');
  PERFORM pg_temp.bf240_assert(result->>'service_revenue'='0.00' AND result->>'product_revenue'='0.10','many one-cent lines exact cents');
  groups:=groups+1;

  PERFORM set_config('role','postgres',true);
  PERFORM pg_temp.bf240_sale(b,users[1],product_id,service_id,'2026-06-05T12:00Z','COMPLETED',ARRAY[0,0],ARRAY['SERVICE','PRODUCT'],0);
  PERFORM pg_temp.bf240_sale(b,users[1],product_id,service_id,'2026-06-06T12:00Z','COMPLETED',ARRAY[10],ARRAY['PRODUCT'],3,10);
  PERFORM set_config('role','authenticated',true);
  result:=public.get_dashboard_summary(b,'2026-06-05T03:00Z','2026-06-06T03:00Z');
  PERFORM pg_temp.bf240_assert(result->>'total_revenue'='0.00' AND result->>'average_ticket'='0.00','zero subtotal sale safe division and present zero average');
  result:=public.get_dashboard_summary(b,'2026-06-06T03:00Z','2026-06-07T03:00Z');
  PERFORM pg_temp.bf240_assert(result->>'total_revenue'='0.00' AND result->>'profit'='-3.00','full discount exact and negative profit from historical product cost');
  INSERT INTO public.expenses(business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by)
    VALUES(empty_b,empty_category,'MANUAL','No sales',4.20,'CASH','2026-09-01',users[1]);
  result:=public.get_dashboard_summary(empty_b,NULL,NULL);
  PERFORM pg_temp.bf240_assert(result->>'profit'='-4.20' AND result->'average_ticket'='null'::jsonb,'manual-only negative profit and NULL average');
  PERFORM set_config('role','postgres',true);
  PERFORM pg_temp.bf240_sale(b,users[1],product_id,service_id,'2026-06-07T12:00Z','COMPLETED',ARRAY[9999999999.99],ARRAY['SERVICE'],0);
  PERFORM pg_temp.bf240_sale(b,users[1],product_id,service_id,'2026-06-07T13:00Z','COMPLETED',ARRAY[9999999999.99],ARRAY['SERVICE'],0);
  PERFORM pg_temp.bf240_sale(b,users[1],product_id,service_id,'2026-06-08T12:00Z','COMPLETED',ARRAY[0.01],ARRAY['SERVICE'],0);
  PERFORM pg_temp.bf240_sale(b,users[1],product_id,service_id,'2026-06-08T13:00Z','COMPLETED',ARRAY[0.02],ARRAY['SERVICE'],0);
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf240_assert(public.get_dashboard_summary(b,'2026-06-07T03:00Z','2026-06-08T03:00Z')->>'total_revenue'='19999999999.98','sum not limited to numeric12,2 and no float');
  PERFORM pg_temp.bf240_assert(public.get_dashboard_summary(b,'2026-06-08T03:00Z','2026-06-09T03:00Z')->>'average_ticket'='0.02','NUMERIC average half-cent round2');
  PERFORM set_config('role','postgres',true);
  qty_sale:=pg_temp.bf240_sale(b,users[1],product_id,service_id,'2026-06-09T12:00Z','COMPLETED',ARRAY[2],ARRAY['PRODUCT'],0.50);
  UPDATE public.sale_items AS item SET quantity=6,line_total=12 WHERE item.sale_id=qty_sale;
  UPDATE public.sales SET subtotal=12,total=12 WHERE id=qty_sale;
  PERFORM set_config('role','authenticated',true);
  result:=public.get_dashboard_summary(b,'2026-06-09T03:00Z','2026-06-10T03:00Z');
  PERFORM pg_temp.bf240_assert(result->>'products_sold'='6' AND result->>'profit'='9.00','product units SUM quantity, COGS snapshot multiplied by quantity');
  groups:=groups+1;

  INSERT INTO public.expenses(business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by)
    VALUES(dst_b,dst_category,'MANUAL','Fall DST',1.23,'CASH','2026-11-01',users[1]),
      (dst_b,dst_category,'MANUAL','Next day',100,'CASH','2026-11-02',users[1]),
      (dst_b,dst_category,'MANUAL','Spring DST',2.34,'CASH','2026-03-08',users[1]);
  PERFORM pg_temp.bf240_assert(public.get_dashboard_summary(dst_b,'2026-11-01T04:00Z','2026-11-02T05:00Z')->>'expenses'='1.23','25-hour DST civil expense boundary');
  PERFORM pg_temp.bf240_assert(public.get_dashboard_summary(dst_b,'2026-03-08T05:00Z','2026-03-09T04:00Z')->>'expenses'='2.34','23-hour DST civil expense boundary');
  PERFORM set_config('role','postgres',true);
  INSERT INTO public.clients(id,business_id,first_name) VALUES(dst_client,dst_b,'DST client');
  INSERT INTO public.business_members(id,business_id,user_id,role) VALUES(dst_member,dst_b,users[2],'BARBER');
  INSERT INTO public.services(id,business_id,name,price,duration_minutes) VALUES(dst_service,dst_b,'DST service',1,30);
  PERFORM pg_temp.bf240_sale(dst_b,users[1],product_id,dst_service,'2026-11-01T05:30Z','COMPLETED',ARRAY[1],ARRAY['SERVICE'],0);
  PERFORM pg_temp.bf240_sale(dst_b,users[1],product_id,dst_service,'2026-11-01T06:30Z','COMPLETED',ARRAY[1],ARRAY['SERVICE'],0);
  PERFORM pg_temp.bf240_sale(dst_b,users[1],product_id,dst_service,'2026-11-02T05:00Z','COMPLETED',ARRAY[100],ARRAY['SERVICE'],0);
  INSERT INTO public.appointments(business_id,client_id,barber_member_id,start_at,end_at,status,created_by) VALUES
    (dst_b,dst_client,dst_member,'2026-11-01T05:30Z','2026-11-01T06:00Z','CANCELLED',users[1]),
    (dst_b,dst_client,dst_member,'2026-11-01T06:30Z','2026-11-01T07:00Z','NO_SHOW',users[1]),
    (dst_b,dst_client,dst_member,'2026-11-02T05:00Z','2026-11-02T06:00Z','PENDING',users[1]);
  PERFORM set_config('role','authenticated',true);
  result:=public.get_dashboard_summary(dst_b,'2026-11-01T04:00Z','2026-11-02T05:00Z');
  PERFORM pg_temp.bf240_assert(result->>'total_revenue'='2.00' AND result->>'appointments'='2'
    AND result->>'cancellations'='1' AND result->>'no_shows'='1','both repeated civil hours counted as distinct instants; DST upper bound excluded');
  groups:=groups+1;

  -- An undated COMPLETED record in a different tenant never poisons this tenant.
  PERFORM set_config('role','postgres',true);
  INSERT INTO public.sales(id,business_id,operation_id,status,subtotal,total,created_by)
    VALUES(gen_random_uuid(),foreign_b,gen_random_uuid(),'COMPLETED',0,0,users[4]);
  bad_sale:=pg_temp.bf240_sale(b,users[1],product_id,service_id,NULL,'COMPLETED',ARRAY[1],ARRAY['SERVICE'],0);
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf240_error(format('SELECT public.get_dashboard_summary(%L,NULL,NULL)',b),'PT409','INVALID_HISTORY');
  PERFORM pg_temp.bf240_error(format('SELECT public.get_dashboard_summary(%L,%L,%L)',b,'2050-01-01','2051-01-01'),'PT409','INVALID_HISTORY');
  PERFORM set_config('role','postgres',true);UPDATE public.sales SET status='DRAFT' WHERE id=bad_sale;
  bad_sale:=pg_temp.bf240_sale(b,users[1],product_id,service_id,'2026-05-01T12:00Z','COMPLETED',ARRAY[1],ARRAY['SERVICE'],0);
  UPDATE public.sales SET subtotal=2,total=2 WHERE id=bad_sale;
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf240_error(format('SELECT public.get_dashboard_summary(%L,%L,%L)',b,'2026-05-01','2026-05-02'),'PT409','INVALID_HISTORY');
  PERFORM set_config('role','postgres',true);UPDATE public.sales SET status='DRAFT' WHERE id=bad_sale;
  INSERT INTO public.sales(id,business_id,operation_id,status,subtotal,total,sold_at,created_by)
    VALUES(gen_random_uuid(),empty_b,gen_random_uuid(),'COMPLETED',0,0,'2026-05-01',users[1]);
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf240_error(format('SELECT public.get_dashboard_summary(%L,NULL,NULL)',empty_b),'PT409','INVALID_HISTORY');
  PERFORM pg_temp.bf240_assert(public.get_dashboard_summary(b,from_at,to_at)->>'total_revenue'='50.00','foreign invalid history and out-of-range DRAFT do not leak/affect valid own range');
  groups:=groups+1;

  -- The role guard precedes history/range inspection, including malformed bounds.
  FOREACH i IN ARRAY ARRAY[2,3,4,5] LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[i],'role','authenticated')::text,true);
    PERFORM pg_temp.bf240_error(format('SELECT public.get_dashboard_summary(%L,NULL,NULL)',b),'42501','ACCESS_DENIED');
    PERFORM pg_temp.bf240_error(format('SELECT public.get_dashboard_summary(%L,NULL,%L)',b,to_at),'42501','ACCESS_DENIED');
  END LOOP;
  PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
  PERFORM pg_temp.bf240_error(format('SELECT public.get_dashboard_summary(%L,NULL,NULL)',b),'42501','ACCESS_DENIED');
  PERFORM set_config('role','anon',true);
  PERFORM pg_temp.bf240_error(format('SELECT public.get_dashboard_summary(%L,NULL,NULL)',b),'42501');
  PERFORM set_config('role','postgres',true);
  UPDATE public.business_members SET is_active=false WHERE id=member_id;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf240_error(format('SELECT public.get_dashboard_summary(%L,NULL,NULL)',b),'42501','ACCESS_DENIED');
  PERFORM pg_temp.bf240_error('SELECT public.get_dashboard_summary(NULL,NULL,NULL)','42501','ACCESS_DENIED');
  PERFORM pg_temp.bf240_error(format('SELECT public.get_dashboard_summary(%L,NULL,NULL)',gen_random_uuid()),'42501','ACCESS_DENIED');
  PERFORM set_config('role','postgres',true);
  groups:=groups+1;
  RAISE NOTICE 'BF240 PASS: % groups; exact12 fields, OWNER/tenants/RLS, D04/D05/D22, snapshot COGS, real purchase void, civil timezone/DST',groups;
END $$;
ROLLBACK;
