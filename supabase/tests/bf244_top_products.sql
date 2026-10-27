\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.bf244_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'BF244: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.bf244_error(statement text,expected text,marker text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE code text; message text; detail text;
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE,message=MESSAGE_TEXT,detail=PG_EXCEPTION_DETAIL;
  END;
  IF code IS DISTINCT FROM expected OR (marker IS NOT NULL AND position(marker IN message||COALESCE(detail,''))=0)
    THEN RAISE EXCEPTION 'BF244 expected % / %, got %',expected,marker,code; END IF;
END $$;
CREATE FUNCTION pg_temp.bf244_rows(b uuid,f timestamptz,t timestamptz,n integer DEFAULT 10) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(r)-'ordinal' ORDER BY r.ordinal),'[]'::jsonb)
  FROM public.get_top_products(b,f,t,n) WITH ORDINALITY AS r(product_id,name,quantity,net_revenue,cogs,gross_profit,ordinal);
$$;
CREATE FUNCTION pg_temp.bf244_sale(b uuid,u uuid,sold timestamptz,state text,discount numeric,items jsonb)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE sale uuid:=gen_random_uuid(); i jsonb; q integer; price numeric; gross numeric;
BEGIN
  SELECT sum((x->>'price')::numeric*COALESCE((x->>'quantity')::integer,1)) INTO gross FROM jsonb_array_elements(items) AS v(x);
  INSERT INTO public.sales(id,business_id,operation_id,status,subtotal,discount,total,sold_at,created_by)
    VALUES(sale,b,gen_random_uuid(),state,gross,discount,gross-discount,sold,u);
  FOR i IN SELECT * FROM jsonb_array_elements(items) LOOP
    q:=COALESCE((i->>'quantity')::integer,1);price:=(i->>'price')::numeric;
    INSERT INTO public.sale_items(id,sale_id,item_type,service_id,product_id,item_name_snapshot,unit_price_snapshot,quantity,line_total,unit_cost_snapshot)
    VALUES(COALESCE((i->>'id')::uuid,gen_random_uuid()),sale,i->>'kind',
      CASE WHEN i->>'kind'='SERVICE' THEN (i->>'entity')::uuid END,
      CASE WHEN i->>'kind'='PRODUCT' THEN (i->>'entity')::uuid END,i->>'name',price,q,price*q,
      CASE WHEN i->>'kind'='PRODUCT' THEN COALESCE((i->>'cost')::numeric,0) END);
  END LOOP;
  RETURN sale;
END $$;

DO $$
DECLARE
  b uuid:=gen_random_uuid(); foreign_b uuid:=gen_random_uuid(); empty_b uuid:=gen_random_uuid(); limit_b uuid:=gen_random_uuid();
  users uuid[]:=ARRAY(SELECT gen_random_uuid() FROM generate_series(1,5));
  product_ids uuid[]:=ARRAY['00000000-0000-4000-8000-000000024401','00000000-0000-4000-8000-000000024402','00000000-0000-4000-8000-000000024403','00000000-0000-4000-8000-000000024404']::uuid[];
  p uuid:=gen_random_uuid(); sale uuid; bad_sale uuid; limit_id uuid; f record; result jsonb; baseline jsonb; history jsonb;
  from_at timestamptz:='2026-09-05T03:00Z';to_at timestamptz:='2026-09-07T03:00Z';
  i integer; n integer; items jsonb; summary jsonb; groups integer:=0; original_timezone text:=current_setting('TimeZone');
BEGIN
  SELECT * INTO STRICT f FROM pg_proc WHERE oid='public.get_top_products(uuid,timestamptz,timestamptz,integer)'::regprocedure;
  PERFORM pg_temp.bf244_assert(NOT f.prosecdef AND f.provolatile='s' AND f.proretset AND f.prorettype='record'::regtype
    AND f.pronargs=4 AND f.pronargdefaults=1 AND pg_get_expr(f.proargdefaults,0)='10'
    AND f.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND f.proconfig=ARRAY['search_path=""']::text[]
    AND f.proargmodes='{i,i,i,i,t,t,t,t,t,t}'::"char"[]
    AND f.proargnames=ARRAY['p_business_id','p_from','p_to','p_limit','product_id','name','quantity','net_revenue','cogs','gross_profit']::text[]
    AND f.proallargtypes=ARRAY['uuid'::regtype,'timestamptz'::regtype,'timestamptz'::regtype,'integer'::regtype,'uuid'::regtype,'text'::regtype,'bigint'::regtype,'text'::regtype,'text'::regtype,'text'::regtype]::oid[],
    'exact signature/default/TABLE columns/types/modes/plpgsql/STABLE/INVOKER/search_path');
  PERFORM pg_temp.bf244_assert(has_function_privilege('authenticated',f.oid,'EXECUTE') AND NOT has_function_privilege('anon',f.oid,'EXECUTE')
    AND NOT has_function_privilege('service_role',f.oid,'EXECUTE')
    AND NOT EXISTS(SELECT 1 FROM aclexplode(f.proacl) a WHERE a.grantee NOT IN(f.proowner,'authenticated'::regrole))
    AND (SELECT count(*)=1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_top_products'),'exact ACL and no overload');
  groups:=groups+1;

  INSERT INTO auth.users(id) SELECT unnest(users);
  INSERT INTO public.businesses(id,name,timezone) VALUES(b,'BF244 own','America/Argentina/Buenos_Aires'),(foreign_b,'BF244 foreign','UTC'),(empty_b,'BF244 empty','UTC'),(limit_b,'BF244 limit','UTC');
  INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES(b,users[1],'OWNER',true),(b,users[2],'BARBER',true),(b,users[3],'OWNER',false),
    (foreign_b,users[4],'OWNER',true),(empty_b,users[1],'OWNER',true),(limit_b,users[1],'OWNER',true);
  FOR i IN 1..4 LOOP INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost) VALUES(product_ids[i],b,'Current catalog',99,88); END LOOP;
  INSERT INTO public.services(id,business_id,name,price,duration_minutes) VALUES(p,b,'Other type',99,30);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf244_assert(pg_temp.bf244_rows(empty_b,NULL,NULL)='[]'::jsonb
    AND pg_temp.bf244_rows(empty_b,from_at,to_at)='[]'::jsonb,'empty ALL_TIME/bounded are zero rows, no zero fill');
  FOREACH n IN ARRAY ARRAY[0,-1,101] LOOP
    PERFORM pg_temp.bf244_error(format('SELECT * FROM public.get_top_products(%L,NULL,NULL,%s)',b,n),'22023','INVALID_INPUT');
  END LOOP;
  PERFORM pg_temp.bf244_error(format('SELECT * FROM public.get_top_products(%L,NULL,NULL,NULL)',b),'22023','INVALID_INPUT');
  PERFORM pg_temp.bf244_error(format('SELECT * FROM public.get_top_products(%L,NULL,%L)',b,to_at),'22023','INVALID_INPUT');
  PERFORM pg_temp.bf244_error(format('SELECT * FROM public.get_top_products(%L,%L,NULL)',b,from_at),'22023','INVALID_INPUT');
  PERFORM pg_temp.bf244_error(format('SELECT * FROM public.get_top_products(%L,%L,%L)',b,from_at,from_at),'22023','INVALID_INPUT');
  PERFORM pg_temp.bf244_error(format('SELECT * FROM public.get_top_products(%L,%L,%L)',b,to_at,from_at),'22023','INVALID_INPUT');
  PERFORM pg_temp.bf244_error(format('SELECT * FROM public.get_top_products(%L,%L,%L)',b,'-infinity',to_at),'22023','INVALID_INPUT');
  PERFORM pg_temp.bf244_error(format('SELECT * FROM public.get_top_products(%L,%L,%L)',b,from_at,'infinity'),'22023','INVALID_INPUT');
  groups:=groups+1;

  PERFORM set_config('role','postgres',true);
  sale:=pg_temp.bf244_sale(b,users[1],from_at,'COMPLETED',2,jsonb_build_array(
    jsonb_build_object('id','00000000-0000-4000-8000-000000244101','kind','PRODUCT','entity',product_ids[1],'name','Old name','price',4,'cost',2),
    jsonb_build_object('id','00000000-0000-4000-8000-000000244102','kind','SERVICE','entity',p,'name','Service snapshot','price',10),
    jsonb_build_object('id','00000000-0000-4000-8000-000000244103','kind','PRODUCT','entity',product_ids[1],'name','Tie winner','price',6,'cost',3)));
  INSERT INTO public.payments(business_id,sale_id,payment_method,amount,created_by) VALUES(b,sale,'CASH',8,users[1]),(b,sale,'CASH',10,users[1]);
  PERFORM pg_temp.bf244_sale(b,users[1],'2026-09-06T03:00Z','COMPLETED',0,jsonb_build_array(jsonb_build_object('kind','PRODUCT','entity',product_ids[2],'name','Ten','price',10,'cost',20)));
  PERFORM pg_temp.bf244_sale(b,users[1],'2026-09-05T12:00Z','COMPLETED',0,jsonb_build_array(jsonb_build_object('kind','PRODUCT','entity',product_ids[3],'name','Alphabetically first','price',9)));
  PERFORM pg_temp.bf244_sale(b,users[1],to_at-interval '1 microsecond','COMPLETED',0,jsonb_build_array(jsonb_build_object('kind','PRODUCT','entity',product_ids[1],'name','  Latest snapshot  ','price',0,'quantity',3,'cost',4)));
  PERFORM pg_temp.bf244_sale(b,users[1],from_at,'COMPLETED',0,jsonb_build_array(jsonb_build_object('kind','PRODUCT','entity',product_ids[4],'name','Zero','price',0)));
  PERFORM pg_temp.bf244_sale(b,users[1],from_at-interval '1 microsecond','COMPLETED',0,jsonb_build_array(jsonb_build_object('kind','PRODUCT','entity',product_ids[1],'name','Before','price',1000)));
  PERFORM pg_temp.bf244_sale(b,users[1],to_at,'COMPLETED',0,jsonb_build_array(jsonb_build_object('kind','PRODUCT','entity',product_ids[1],'name','After','price',500)));
  FOREACH n IN ARRAY ARRAY[1,2] LOOP
    PERFORM pg_temp.bf244_sale(b,users[1],'2027-01-01',CASE WHEN n=1 THEN 'DRAFT' ELSE 'VOIDED' END,0,
      jsonb_build_array(jsonb_build_object('kind','PRODUCT','entity',product_ids[1],'name','Wrong nonqualified','price',999)));
  END LOOP;
  SELECT jsonb_agg(to_jsonb(item) ORDER BY item.id) INTO history FROM public.sale_items item JOIN public.sales s ON s.id=item.sale_id WHERE s.business_id=b;
  PERFORM set_config('role','authenticated',true);
  result:=pg_temp.bf244_rows(b,from_at,to_at,100);baseline:=result;
  PERFORM pg_temp.bf244_assert(result=jsonb_build_array(
    jsonb_build_object('product_id',product_ids[2],'name','Ten','quantity',1,'net_revenue','10.00','cogs','20.00','gross_profit','-10.00'),
    jsonb_build_object('product_id',product_ids[1],'name','  Latest snapshot  ','quantity',5,'net_revenue','9.00','cogs','17.00','gross_profit','-8.00'),
    jsonb_build_object('product_id',product_ids[3],'name','Alphabetically first','quantity',1,'net_revenue','9.00','cogs','0.00','gross_profit','9.00'),
    jsonb_build_object('product_id',product_ids[4],'name','Zero','quantity',1,'net_revenue','0.00','cogs','0.00','gross_profit','0.00')),
    'mixed D05, numeric 10>9, UUID ASC tie not name, duplicate product aggregation, zero revenue, precision bounds, latest name preserved');
  PERFORM pg_temp.bf244_assert(pg_temp.bf244_rows(b,from_at,from_at+interval '1 microsecond')->0->>'name'='Tie winner','latest name same sold_at breaks by line id DESC');
  PERFORM pg_temp.bf244_assert(jsonb_array_length(pg_temp.bf244_rows(b,from_at,to_at,1))=1 AND pg_temp.bf244_rows(b,from_at,to_at,1)->0->>'product_id'=product_ids[2]::text,'limit1 applied after aggregate/ranking');
  PERFORM pg_temp.bf244_assert(pg_temp.bf244_rows(b,NULL,NULL)->0->>'name'='After','ALL_TIME name from latest COMPLETED, not later DRAFT/VOIDED');
  PERFORM pg_temp.bf244_assert((SELECT pg_typeof(r.product_id)='uuid'::regtype AND pg_typeof(r.name)='text'::regtype AND pg_typeof(r.quantity)='bigint'::regtype AND pg_typeof(r.net_revenue)='text'::regtype AND pg_typeof(r.cogs)='text'::regtype AND pg_typeof(r.gross_profit)='text'::regtype FROM public.get_top_products(b,from_at,to_at,1) r),'actual output SQL types');
  PERFORM pg_temp.bf244_assert((SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(result->0) AS k(key))=ARRAY['cogs','gross_profit','name','net_revenue','product_id','quantity']::text[],'only six columns');
  summary:=public.get_dashboard_summary(b,from_at,to_at);
  PERFORM pg_temp.bf244_assert((SELECT sum(r.cogs::numeric)=(summary->>'total_revenue')::numeric-(summary->>'profit')::numeric
    AND sum(r.gross_profit::numeric)=(summary->>'profit')::numeric-(summary->>'service_revenue')::numeric
    FROM public.get_top_products(b,from_at,to_at,100) r),'historical COGS/profit reconcile to BF240 in fixture with no expenses');
  PERFORM pg_temp.bf244_assert((SELECT sum(r.net_revenue::numeric)=(summary->>'product_revenue')::numeric FROM public.get_top_products(b,from_at,to_at,100) r)
    AND (SELECT sum(r.net_revenue::numeric)=(SELECT sum(d.product_revenue::numeric) FROM public.get_revenue_by_day(b,from_at,to_at) d) FROM public.get_top_products(b,from_at,to_at,100) r),'240/241 reconciliation with covering limit');
  PERFORM set_config('TimeZone','Asia/Tokyo',true);
  PERFORM pg_temp.bf244_assert(pg_temp.bf244_rows(b,from_at,to_at,100)=baseline,'explicit instant range independent of session timezone');
  PERFORM set_config('TimeZone',original_timezone,true);
  UPDATE public.products SET name='Renamed',sale_price=0,default_purchase_cost=999,is_active=false WHERE id=ANY(product_ids);
  PERFORM pg_temp.bf244_assert(pg_temp.bf244_rows(b,from_at,to_at,100)=baseline,'catalog rename/price/current cost/archive cannot change history');
  PERFORM pg_temp.bf244_assert((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.id)=history FROM public.sale_items item JOIN public.sales s ON s.id=item.sale_id WHERE s.business_id=b),'history not rewritten');
  groups:=groups+1;

  PERFORM set_config('role','postgres',true);
  FOR i IN 1..12 LOOP
    limit_id:=('00000000-0000-4000-8000-'||lpad((244200+i)::text,12,'0'))::uuid;
    INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost) VALUES(limit_id,limit_b,'Limit catalog',0,0);
    items:=jsonb_build_array(jsonb_build_object('kind','PRODUCT','entity',limit_id,'name','Limit snapshot','price',i));
    IF i=1 THEN items:=items||jsonb_build_array(jsonb_build_object('kind','PRODUCT','entity',limit_id,'name','Limit snapshot','price',20)); END IF;
    PERFORM pg_temp.bf244_sale(limit_b,users[1],from_at,'COMPLETED',0,items);
  END LOOP;
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf244_assert((SELECT count(*)=10 FROM public.get_top_products(limit_b,NULL,NULL))
    AND jsonb_array_length(pg_temp.bf244_rows(limit_b,NULL,NULL,100))=12,'default10 executes,100 valid, no fabricated rows');
  PERFORM pg_temp.bf244_assert(pg_temp.bf244_rows(limit_b,NULL,NULL,1)->0->>'net_revenue'='21.00','limit after duplicate identity aggregate, not largest individual line');
  groups:=groups+1;

  PERFORM set_config('role','postgres',true);
  -- Fixed line ids make the approved cumulative cent residual observable.
  items:='[]'::jsonb;
  FOR i IN 1..4 LOOP items:=items||jsonb_build_array(jsonb_build_object('id',('00000000-0000-4000-8000-'||lpad((244300+i)::text,12,'0'))::uuid,
    'kind',CASE WHEN i%2=1 THEN 'PRODUCT' ELSE 'SERVICE' END,'entity',CASE WHEN i%2=1 THEN product_ids[1] ELSE p END,'name','Cent','price',0.01)); END LOOP;
  PERFORM pg_temp.bf244_sale(b,users[1],'2026-05-01T12:00Z','COMPLETED',0.02,items);
  PERFORM pg_temp.bf244_sale(b,users[1],'2026-05-02T12:00Z','COMPLETED',0,jsonb_build_array(
    jsonb_build_object('kind','PRODUCT','entity',product_ids[1],'name','Big quantity','price',0,'quantity',2147483647,'cost',0.01),
    jsonb_build_object('kind','PRODUCT','entity',product_ids[1],'name','Big quantity','price',0,'quantity',2147483647,'cost',0.01)));
  FOR i IN 1..2 LOOP PERFORM pg_temp.bf244_sale(b,users[1],'2026-05-03T12:00Z','COMPLETED',0,
    jsonb_build_array(jsonb_build_object('kind','PRODUCT','entity',product_ids[2],'name','Big money','price',9999999999.99,'cost',9999999999.99))); END LOOP;
  PERFORM pg_temp.bf244_sale(b,users[1],'2026-05-04T12:00Z','COMPLETED',0,jsonb_build_array(
    jsonb_build_object('kind','PRODUCT','entity',product_ids[3],'name','Decimals','price',0.29),jsonb_build_object('kind','PRODUCT','entity',product_ids[3],'name','Decimals','price',0.10)));
  PERFORM pg_temp.bf244_sale(b,users[1],'2026-05-05T12:00Z','COMPLETED',1,jsonb_build_array(jsonb_build_object('kind','PRODUCT','entity',product_ids[4],'name','Full discount','price',1)));
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf244_assert(pg_temp.bf244_rows(b,'2026-05-01','2026-05-02')->0->>'net_revenue'='0.00','D05 four cents mixed-type residual, no negative attribution');
  PERFORM pg_temp.bf244_assert(pg_temp.bf244_rows(b,'2026-05-02','2026-05-03')->0->>'quantity'='4294967294','SUM integer quantity returns real bigint, zero subtotal safe');
  PERFORM pg_temp.bf244_assert(pg_temp.bf244_rows(b,'2026-05-02','2026-05-03')->0->>'cogs'='42949672.94'
    AND pg_temp.bf244_rows(b,'2026-05-02','2026-05-03')->0->>'gross_profit'='-42949672.94','historical cost multiplied by quantity; negative profit and exact cents');
  PERFORM pg_temp.bf244_assert(pg_temp.bf244_rows(b,'2026-05-03','2026-05-04')->0->>'net_revenue'='19999999999.98','unbounded exact numeric aggregate');
  PERFORM pg_temp.bf244_assert(pg_temp.bf244_rows(b,'2026-05-03','2026-05-04')->0->>'cogs'='19999999999.98'
    AND pg_temp.bf244_rows(b,'2026-05-03','2026-05-04')->0->>'gross_profit'='0.00','large historical COGS exact, zero profit');
  PERFORM pg_temp.bf244_assert(pg_temp.bf244_rows(b,'2026-05-04','2026-05-05')->0->>'net_revenue'='0.39'
    AND pg_temp.bf244_rows(b,'2026-05-05','2026-05-06')->0->>'net_revenue'='0.00','decimal precision/full discount');
  summary:=public.get_dashboard_summary(b,'2026-05-01','2026-05-06');
  result:=pg_temp.bf244_rows(b,'2026-05-01','2026-05-06',100);
  PERFORM pg_temp.bf244_assert(result->0->>'product_id'=product_ids[2]::text AND result->1->>'product_id'=product_ids[3]::text,
    'ranking is net revenue, not much larger quantity/COGS or greater gross profit');
  PERFORM pg_temp.bf244_assert((SELECT sum(r.net_revenue::numeric)=(summary->>'product_revenue')::numeric FROM public.get_top_products(b,'2026-05-01','2026-05-06',100) r),'D05/large/zero aggregates reconcile to BF240');
  groups:=groups+1;

  PERFORM set_config('role','postgres',true);
  -- Database invariants already prevent constructing missing IDs/names. Do not weaken them for a test.
  PERFORM pg_temp.bf244_error(format('SELECT pg_temp.bf244_sale(%L,%L,%L,%L,0,%L::jsonb)',b,users[1],from_at,'COMPLETED',
    jsonb_build_array(jsonb_build_object('kind','PRODUCT','entity',NULL,'name','Missing id','price',1))),'23514');
  PERFORM pg_temp.bf244_error(format('SELECT pg_temp.bf244_sale(%L,%L,%L,%L,0,%L::jsonb)',b,users[1],from_at,'COMPLETED',
    jsonb_build_array(jsonb_build_object('kind','PRODUCT','entity',product_ids[1],'name',NULL,'price',1))),'23502');
  PERFORM pg_temp.bf244_error(format('SELECT pg_temp.bf244_sale(%L,%L,%L,%L,0,%L::jsonb)',b,users[1],from_at,'COMPLETED',
    jsonb_build_array(jsonb_build_object('kind','PRODUCT','entity',product_ids[1],'name','   ','price',1))),'23514');
  PERFORM pg_temp.bf244_error(format('UPDATE public.sale_items SET unit_cost_snapshot=NULL WHERE product_id=%L',product_ids[1]),'23514');
  PERFORM pg_temp.bf244_error(format('UPDATE public.sale_items SET unit_cost_snapshot=-1 WHERE product_id=%L',product_ids[1]),'23514');
  PERFORM pg_temp.bf244_error(format('UPDATE public.sale_items SET unit_cost_snapshot=%L::numeric WHERE product_id=%L','NaN',product_ids[1]),'23514');
  -- Invalid selected history must fail even if ranking would have no PRODUCT rows.
  bad_sale:=pg_temp.bf244_sale(b,users[1],'2026-04-01','COMPLETED',0,jsonb_build_array(jsonb_build_object('kind','SERVICE','entity',p,'name','Other type','price',1)));
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf244_assert(pg_temp.bf244_rows(b,'2026-04-01','2026-04-02')='[]'::jsonb,'valid other-type-only sale yields zero rows');
  PERFORM set_config('role','postgres',true);UPDATE public.sales SET subtotal=2,total=2 WHERE id=bad_sale;
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf244_error(format('SELECT * FROM public.get_top_products(%L,%L,%L,1)',b,'2026-04-01','2026-04-02'),'PT409','INVALID_HISTORY');
  PERFORM set_config('role','postgres',true);UPDATE public.sales SET status='DRAFT' WHERE id=bad_sale;
  INSERT INTO public.sales(business_id,operation_id,status,subtotal,total,sold_at,created_by) VALUES(b,gen_random_uuid(),'COMPLETED',0,0,'2026-04-03',users[1]);
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf244_error(format('SELECT * FROM public.get_top_products(%L,%L,%L)',b,'2026-04-03','2026-04-04'),'PT409','INVALID_HISTORY');
  PERFORM set_config('role','postgres',true);
  bad_sale:=pg_temp.bf244_sale(b,users[1],from_at,'COMPLETED',0,jsonb_build_array(jsonb_build_object('kind','PRODUCT','entity',product_ids[4],'name','Invalid limited-away','price',0)));
  UPDATE public.sales SET subtotal=1,total=1 WHERE id=bad_sale;
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf244_error(format('SELECT * FROM public.get_top_products(%L,%L,%L,1)',b,from_at,to_at),'PT409','INVALID_HISTORY');
  PERFORM set_config('role','postgres',true);UPDATE public.sales SET status='DRAFT' WHERE id=bad_sale;
  INSERT INTO public.sales(business_id,operation_id,status,subtotal,total,created_by) VALUES(foreign_b,gen_random_uuid(),'COMPLETED',0,0,users[4]);
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf244_assert(pg_temp.bf244_rows(b,from_at,to_at,100)=baseline,'foreign invalid history and own outside-range invalid rows do not leak into result');
  PERFORM set_config('role','postgres',true);
  INSERT INTO public.sales(business_id,operation_id,status,subtotal,total,created_by) VALUES(b,gen_random_uuid(),'COMPLETED',0,0,users[1]);
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf244_error(format('SELECT * FROM public.get_top_products(%L,NULL,NULL)',b),'PT409','INVALID_HISTORY');
  PERFORM pg_temp.bf244_error(format('SELECT * FROM public.get_top_products(%L,%L,%L)',b,'2050-01-01','2051-01-01'),'PT409','INVALID_HISTORY');
  groups:=groups+1;

  FOREACH i IN ARRAY ARRAY[2,3,4,5] LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[i],'role','authenticated')::text,true);
    PERFORM pg_temp.bf244_error(format('SELECT * FROM public.get_top_products(%L,NULL,NULL)',b),'42501','ACCESS_DENIED');
    PERFORM pg_temp.bf244_error(format('SELECT * FROM public.get_top_products(%L,NULL,%L,NULL)',b,to_at),'42501','ACCESS_DENIED');
  END LOOP;
  PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
  PERFORM pg_temp.bf244_error(format('SELECT * FROM public.get_top_products(%L,NULL,NULL)',b),'42501','ACCESS_DENIED');
  PERFORM set_config('role','anon',true);
  PERFORM pg_temp.bf244_error(format('SELECT * FROM public.get_top_products(%L,NULL,NULL)',b),'42501');
  PERFORM set_config('role','postgres',true);UPDATE public.business_members SET is_active=false WHERE business_id=b AND user_id=users[1];
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf244_error(format('SELECT * FROM public.get_top_products(%L,NULL,NULL)',b),'42501','ACCESS_DENIED');
  PERFORM pg_temp.bf244_error('SELECT * FROM public.get_top_products(NULL,NULL,NULL)','42501','ACCESS_DENIED');
  PERFORM pg_temp.bf244_error(format('SELECT * FROM public.get_top_products(%L,NULL,NULL)',gen_random_uuid()),'42501','ACCESS_DENIED');
  PERFORM set_config('role','postgres',true);groups:=groups+1;
  RAISE NOTICE 'BF244 PASS: % groups; TABLE/default/ACL, auth/tenant, D05/D22, numeric ranking/UUID ties, latest snapshot, aggregate quantity/limit, 240/241 reconciliation',groups;
END $$;
ROLLBACK;
