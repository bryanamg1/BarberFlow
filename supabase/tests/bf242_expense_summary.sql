\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.bf242_assert(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'BF242: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.bf242_error(statement text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE code text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE; END;
 IF code IS DISTINCT FROM expected THEN RAISE EXCEPTION 'BF242 expected %, got %',expected,code; END IF;
END $$;

DO $$
DECLARE
 b uuid:=gen_random_uuid(); other_b uuid:=gen_random_uuid(); dst_b uuid:=gen_random_uuid();
 u uuid[]:=ARRAY(SELECT gen_random_uuid() FROM generate_series(1,5));
 c uuid:=gen_random_uuid(); archived uuid:=gen_random_uuid(); foreign_c uuid:=gen_random_uuid(); dst_c uuid:=gen_random_uuid();
 p uuid:=gen_random_uuid(); purchase_id uuid; expense_id uuid; inconsistent_parent uuid:=gen_random_uuid();
 f record; result jsonb; original jsonb; snapshot jsonb; first_summary jsonb; method text; actor uuid;
 from_at timestamptz:='2026-09-01T03:00:00Z'; to_at timestamptz:='2026-10-01T03:00:00Z';
 groups integer:=0;
BEGIN
 SELECT * INTO STRICT f FROM pg_proc WHERE oid='public.get_expense_summary(uuid,timestamptz,timestamptz)'::regprocedure;
 PERFORM pg_temp.bf242_assert(NOT f.prosecdef AND f.provolatile='s' AND NOT f.proretset
   AND f.prorettype='jsonb'::regtype AND f.pronargs=3 AND f.pronargdefaults=0
   AND f.proargnames=ARRAY['p_business_id','p_from','p_to']::text[]
   AND f.proconfig=ARRAY['search_path=""']::text[],'exact signature/invoker/stable/search_path');
 PERFORM pg_temp.bf242_assert(has_function_privilege('authenticated',f.oid,'EXECUTE')
   AND NOT has_function_privilege('anon',f.oid,'EXECUTE')
   AND NOT has_function_privilege('service_role',f.oid,'EXECUTE')
   AND NOT EXISTS(SELECT 1 FROM aclexplode(f.proacl) a WHERE a.grantee NOT IN(f.proowner,'authenticated'::regrole)), 'exact ACL');
 PERFORM pg_temp.bf242_assert((SELECT count(*)=19 AND bool_and(c.relrowsecurity AND NOT c.relforcerowsecurity)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p'))
   AND (SELECT count(*)=41 FROM pg_policies WHERE schemaname='public'),'RLS/policies unchanged');
 groups:=groups+1;
 INSERT INTO auth.users(id) SELECT unnest(u);
 INSERT INTO public.businesses(id,name,timezone) VALUES
   (b,'BF242 own','America/Argentina/Buenos_Aires'),(other_b,'BF242 foreign','UTC'),(dst_b,'BF242 DST','America/New_York');
 INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES
   (b,u[1],'OWNER',true),(b,u[2],'BARBER',true),(b,u[3],'OWNER',false),
   (other_b,u[4],'OWNER',true),(dst_b,u[1],'OWNER',true);
 INSERT INTO public.expense_categories(id,business_id,name,is_active) VALUES
   (c,b,'Current',true),(archived,b,'Archived',false),(foreign_c,other_b,'Foreign',true),(dst_c,dst_b,'DST',true);
 INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost) VALUES(p,b,'Original',25,7);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[1],'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 result:=public.get_expense_summary(b,from_at,to_at);
 PERFORM pg_temp.bf242_assert(result='{"manual_total":"0.00","purchase_total":"0.00","total":"0.00","by_category":[]}'::jsonb,'authorized empty exact zero/shape');
 groups:=groups+1;
 INSERT INTO public.expenses(business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by)
   VALUES(b,c,'MANUAL','First',0.01,'CASH','2026-09-01',u[1]);
 PERFORM pg_temp.bf242_assert(public.get_expense_summary(b,from_at,to_at)->>'total'='0.01','one manual/start boundary');
 INSERT INTO public.expenses(business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by) VALUES
   (b,c,'MANUAL','Second',10.10,'BANK_TRANSFER','2026-09-30',u[1]),
   (b,archived,'MANUAL','Archived',999.99,'DEBIT_CARD','2026-09-30',u[1]),
   (b,c,'MANUAL','End excluded',50,'CREDIT_CARD','2026-10-01',u[1]),
   (b,c,'MANUAL','Before excluded',70,'DIGITAL_WALLET','2026-08-31',u[1]);
 result:=public.get_expense_summary(b,from_at,to_at);
 PERFORM pg_temp.bf242_assert(result->>'manual_total'='1010.10' AND result->>'purchase_total'='0.00'
   AND result->>'total'='1010.10' AND jsonb_array_length(result->'by_category')=2,'multiple manual exact cents/archived category');
 PERFORM pg_temp.bf242_assert(result->'by_category' @> jsonb_build_array(
   jsonb_build_object('category_id',c,'amount','10.11'),jsonb_build_object('category_id',archived,'amount','999.99')),'category exact totals');
 PERFORM pg_temp.bf242_assert((result->'by_category'->0->>'category_id')::uuid=LEAST(c,archived),'deterministic category UUID order');
 groups:=groups+1;
 -- Real approved producer and real correction, never a substitute update to status.
 original:=public.complete_purchase(b,gen_random_uuid(),'Supplier',c,'CASH','2026-09-20T12:00:00Z',NULL,
   jsonb_build_array(jsonb_build_object('productId',p,'quantity',5,'unitCost','20.00')));
 purchase_id:=(original->'purchase'->>'id')::uuid;expense_id:=(original->'expense'->>'id')::uuid;
 snapshot:=(SELECT to_jsonb(e) FROM public.expenses e WHERE e.id=expense_id);
 result:=public.get_expense_summary(b,from_at,to_at);
 PERFORM pg_temp.bf242_assert(result->>'total'='1110.10' AND result->>'manual_total'='1010.10'
   AND result->>'purchase_total'='100.00','mixed one generated expense, not purchase+expense double count');
 PERFORM pg_temp.bf242_assert(public.get_expense_summary(b,'2026-09-20T03:00Z','2026-09-21T03:00Z')->>'total'='100.00','purchase-only day');
 first_summary:=result;
 PERFORM public.void_purchase(b,gen_random_uuid(),purchase_id,'Later correction');
 result:=public.get_expense_summary(b,from_at,to_at);
 PERFORM pg_temp.bf242_assert(result->>'total'='1010.10' AND result->>'purchase_total'='0.00'
   AND result->>'manual_total'=first_summary->>'manual_total','retroactive effective original-period exclusion/MANUAL unchanged');
 PERFORM pg_temp.bf242_assert(public.get_expense_summary(b,'2026-09-20T03:00Z','2026-09-21T03:00Z')->>'total'='0.00','purchase 100 -> void -> 0');
 PERFORM pg_temp.bf242_assert((SELECT to_jsonb(e)=snapshot FROM public.expenses e WHERE e.id=expense_id)
   AND (SELECT status='VOIDED' FROM public.purchases WHERE id=purchase_id),'historical expense untouched');
 PERFORM pg_temp.bf242_assert(public.get_expense_summary(b,'2026-10-01T03:00Z','2026-11-01T03:00Z')->>'total'='50.00'
   AND (SELECT count(*)=0 FROM public.expenses WHERE business_id=b AND amount<0),'October no void-date counter-entry/refund');
 groups:=groups+1;
 PERFORM pg_temp.bf242_assert(public.get_expense_summary(b,'2026-09-30T03:00Z','2026-10-01T03:00Z')->>'total'='1010.09','same-day range excludes next civil day');
 PERFORM pg_temp.bf242_assert(public.get_expense_summary(b,from_at,from_at)->>'total'='0.00','equal/empty range');
 PERFORM pg_temp.bf242_assert(public.get_expense_summary(b,'2026-09-01T10:00Z','2026-09-01T20:00Z')->>'total'='0.00','endpoints derive same local civil date -> empty');
 PERFORM set_config('TimeZone','Asia/Tokyo',true);
 PERFORM pg_temp.bf242_assert(public.get_expense_summary(b,from_at,to_at)=result,'session timezone does not alter civil dates');
 PERFORM pg_temp.bf242_assert(public.get_expense_summary(b,NULL,NULL)->>'total'='1130.10','ALL_TIME retains MANUAL outside bounds, no void expense');
 groups:=groups+1;
 PERFORM pg_temp.bf242_error(format('SELECT public.get_expense_summary(%L,%L,%L)',b,to_at,from_at),'22023');
 PERFORM pg_temp.bf242_error(format('SELECT public.get_expense_summary(%L,NULL,%L)',b,to_at),'22023');
 PERFORM pg_temp.bf242_error(format('SELECT public.get_expense_summary(%L,%L,NULL)',b,from_at),'22023');
 PERFORM pg_temp.bf242_error(format('SELECT public.get_expense_summary(%L,%L,%L)',b,'infinity','infinity'),'22023');
 PERFORM pg_temp.bf242_error(format('SELECT public.get_expense_summary(%L,%L,%L)',b,'2026-02-30','2026-03-01'),'22008');
 groups:=groups+1;
 -- DST uses civil endpoints across a 25-hour business day, no +24h approximation.
 FOREACH method IN ARRAY ARRAY['CASH','BANK_TRANSFER','DEBIT_CARD','CREDIT_CARD','DIGITAL_WALLET'] LOOP
   INSERT INTO public.expenses(business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by)
     VALUES(dst_b,dst_c,'MANUAL','DST',0.01,method,'2026-11-01',u[1]);
 END LOOP;
 INSERT INTO public.expenses(business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by) VALUES
   (dst_b,dst_c,'MANUAL','Next day',10,'CASH','2026-11-02',u[1]),
   (dst_b,dst_c,'MANUAL','Zero',0,'CASH','2026-11-01',u[1]);
 PERFORM pg_temp.bf242_assert(public.get_expense_summary(dst_b,'2026-11-01T04:00Z','2026-11-02T05:00Z')->>'total'='0.05','DST/all five methods/zero');
 groups:=groups+1;
 -- Sum exceeds numeric(12,2) row maximum, without truncation or JS number conversion.
 INSERT INTO public.expenses(business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by)
   SELECT b,c,'MANUAL','Maximum',9999999999.99,'CASH','2026-12-01',u[1] FROM generate_series(1,2);
 result:=public.get_expense_summary(b,'2026-12-01T03:00Z','2026-12-02T03:00Z');
 PERFORM pg_temp.bf242_assert(result->>'total'='19999999999.98' AND jsonb_typeof(result->'total')='string'
   AND result->'by_category'->0->>'amount'='19999999999.98','unbounded NUMERIC sum/decimal JSON strings');
 groups:=groups+1;
 -- Privileged inconsistent references must not turn into tenant-leaking aggregates.
 PERFORM set_config('role','postgres',true);
 INSERT INTO public.expenses(business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by)
   VALUES(other_b,foreign_c,'MANUAL','Foreign',888,'CASH','2026-09-20',u[4]),
     (b,foreign_c,'MANUAL','Invalid category tenant',999,'CASH','2026-09-20',u[1]);
 INSERT INTO public.purchases(id,business_id,operation_id,supplier,total,created_by)
   VALUES(inconsistent_parent,b,gen_random_uuid(),'Unrelated historical parent',0,u[1]);
 INSERT INTO public.expenses(business_id,category_id,source_type,purchase_id,description,amount,payment_method,expense_date,created_by)
   VALUES(other_b,foreign_c,'PURCHASE',inconsistent_parent,'Invalid purchase tenant',999,'CASH','2026-09-20',u[4]);
 PERFORM set_config('role','authenticated',true);
 PERFORM pg_temp.bf242_assert(public.get_expense_summary(b,from_at,to_at)->>'total'='1010.10','foreign/inconsistent category omitted');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[4],'role','authenticated')::text,true);
 PERFORM pg_temp.bf242_assert(public.get_expense_summary(other_b,from_at,to_at)->>'total'='888.00','foreign parent inconsistent excluded');
 PERFORM pg_temp.bf242_error(format('SELECT public.get_expense_summary(%L,NULL,NULL)',b),'42501');
 -- Even a dual OWNER must not let an inconsistent cross-business FK affect totals.
 PERFORM set_config('role','postgres',true);
 INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES(other_b,u[1],'OWNER',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[1],'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 PERFORM pg_temp.bf242_assert(public.get_expense_summary(other_b,from_at,to_at)->>'total'='888.00','dual OWNER still consistent business joins');
 groups:=groups+1;
 FOREACH actor IN ARRAY u[2:5] LOOP
   PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
   PERFORM pg_temp.bf242_error(format('SELECT public.get_expense_summary(%L,NULL,NULL)',b),'42501');
 END LOOP;
 PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
 PERFORM pg_temp.bf242_error(format('SELECT public.get_expense_summary(%L,NULL,NULL)',b),'42501');
 PERFORM set_config('role','anon',true);
 PERFORM pg_temp.bf242_error(format('SELECT public.get_expense_summary(%L,NULL,NULL)',b),'42501');
 PERFORM set_config('role','postgres',true);
 UPDATE public.business_members SET is_active=false WHERE business_id=b AND user_id=u[1];
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[1],'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 PERFORM pg_temp.bf242_error(format('SELECT public.get_expense_summary(%L,NULL,NULL)',b),'42501');
 PERFORM pg_temp.bf242_error('SELECT public.get_expense_summary(NULL,NULL,NULL)','42501');
 PERFORM set_config('role','postgres',true);
 groups:=groups+1;
 RAISE NOTICE 'BF242 PASS: % groups; exact money, civil ranges/DST, real void original-period exclusion, historical preservation, RLS/ACL/tenants',groups;
END $$;
ROLLBACK;
