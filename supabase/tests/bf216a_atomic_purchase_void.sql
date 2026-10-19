BEGIN;
CREATE FUNCTION pg_temp.bf216a_error(statement text, expected text, expected_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE code text; detail text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE,detail=PG_EXCEPTION_DETAIL;
  END;
  IF code IS DISTINCT FROM expected OR (expected_detail IS NOT NULL AND detail IS DISTINCT FROM expected_detail) THEN
    RAISE EXCEPTION 'BF216A expected %/%, got %/% for %',expected,expected_detail,code,detail,statement;
  END IF;
END $$;
CREATE FUNCTION pg_temp.bf216a_buy(b uuid,c uuid,p uuid,q integer DEFAULT 1,cost text DEFAULT '10.00')
RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.complete_purchase(b,gen_random_uuid(),'Supplier',c,'CASH','2026-09-20T12:00Z','  historical  ',
   jsonb_build_array(jsonb_build_object('productId',p,'quantity',q,'unitCost',cost)));
$$;
CREATE FUNCTION pg_temp.bf216a_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('bf216a.fail',true)=TG_TABLE_NAME THEN RAISE EXCEPTION 'BF216A injected failure';END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bf216a_fault BEFORE INSERT ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION pg_temp.bf216a_fault();
CREATE TRIGGER bf216a_fault BEFORE UPDATE ON public.purchases FOR EACH ROW EXECUTE FUNCTION pg_temp.bf216a_fault();

DO $$
DECLARE
 b uuid:=gen_random_uuid();foreign_b uuid:=gen_random_uuid();c uuid:=gen_random_uuid();
 users uuid[]:=ARRAY(SELECT gen_random_uuid() FROM generate_series(1,5));
 p uuid[]:=ARRAY(SELECT gen_random_uuid() FROM generate_series(1,3));
 original jsonb;second jsonb;v jsonb;again jsonb;op uuid;pid uuid;aid uuid;
 f record;cols text[];r text;variant integer;stock_before bigint;history jsonb;checks integer:=0;
BEGIN
 SELECT array_agg(column_name::text ORDER BY ordinal_position) INTO cols FROM information_schema.columns
   WHERE table_schema='private' AND table_name='purchase_voids';
 IF cols IS DISTINCT FROM ARRAY['id','business_id','purchase_id','operation_id','reason','created_by','created_at'] THEN RAISE EXCEPTION 'BF216A audit columns';END IF;
 IF NOT (SELECT relrowsecurity AND NOT relforcerowsecurity FROM pg_class WHERE oid='private.purchase_voids'::regclass)
    OR EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='private' AND tablename='purchase_voids')
    OR (SELECT count(*) FROM pg_constraint WHERE conrelid='private.purchase_voids'::regclass AND contype='u')<>2
    OR (SELECT count(*) FROM pg_constraint WHERE conrelid='private.purchase_voids'::regclass AND contype='p')<>1
    OR (SELECT count(*) FROM pg_constraint WHERE conrelid='private.purchase_voids'::regclass AND contype='f' AND confdeltype='r')<>3 THEN
   RAISE EXCEPTION 'BF216A audit integrity';END IF;
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF has_table_privilege(r,'private.purchase_voids','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN RAISE EXCEPTION 'BF216A audit exposed';END IF;
 END LOOP;
 SELECT * INTO STRICT f FROM pg_proc WHERE oid='public.void_purchase(uuid,uuid,uuid,text)'::regprocedure;
 IF NOT f.prosecdef OR f.provolatile<>'v' OR f.pronargs<>4 OR f.pronargdefaults<>0 OR f.proretset
    OR f.prorettype<>'jsonb'::regtype OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
    OR f.proargnames IS DISTINCT FROM ARRAY['p_business_id','p_operation_id','p_purchase_id','p_reason']::text[]
    OR NOT has_function_privilege('authenticated',f.oid,'EXECUTE')
    OR EXISTS(SELECT 1 FROM aclexplode(f.proacl) a WHERE a.grantee NOT IN(f.proowner,'authenticated'::regrole)) THEN RAISE EXCEPTION 'BF216A RPC contract';END IF;
 checks:=checks+4;
 INSERT INTO auth.users(id) SELECT unnest(users);
 INSERT INTO public.businesses(id,name) VALUES(b,'BF216A'),(foreign_b,'Foreign');
 INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES
   (b,users[1],'OWNER',true),(b,users[2],'OWNER',true),(b,users[3],'BARBER',true),
   (b,users[4],'OWNER',false),(foreign_b,users[5],'OWNER',true);
 INSERT INTO public.expense_categories(id,business_id,name) VALUES(c,b,'Category');
 INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost)
   SELECT x,b,'Product',20,7 FROM unnest(p) x;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 original:=pg_temp.bf216a_buy(b,c,p[1]);pid:=(original->'purchase'->>'id')::uuid;
 -- Same UUID in completion/correction domains explicitly allowed.
 op:=(original->'purchase'->>'operation_id')::uuid;
 v:=public.void_purchase(b,op,pid,'  Original reason  ');
 IF (SELECT count(*) FROM jsonb_object_keys(v))<>5 OR v->'purchase'->>'status'<>'VOIDED'
   OR (SELECT count(*) FROM jsonb_object_keys(v->'purchase'))<>11
   OR (SELECT count(*) FROM jsonb_object_keys(v->'items'->0))<>8
   OR (SELECT count(*) FROM jsonb_object_keys(v->'expense'))<>14
   OR (SELECT count(*) FROM jsonb_object_keys(v->'correction'))<>7
   OR (SELECT count(*) FROM jsonb_object_keys(v->'stockMovements'->0))<>12
   OR v->'items' IS DISTINCT FROM original->'items' OR v->'expense' IS DISTINCT FROM original->'expense'
   OR ((v->'purchase')-'status'-'updated_at') IS DISTINCT FROM ((original->'purchase')-'status'-'updated_at')
   OR v->'correction'->>'reason'<>'  Original reason  ' THEN RAISE EXCEPTION 'BF216A exact output/history';END IF;
 IF (SELECT sum(quantity_delta) FROM public.stock_movements WHERE product_id=p[1])<>0
   OR (SELECT default_purchase_cost FROM public.products WHERE id=p[1])<>10 THEN RAISE EXCEPTION 'BF216A stock/cost';END IF;
 again:=public.void_purchase(b,op,pid,'  Original reason  ');
 IF again IS DISTINCT FROM v THEN RAISE EXCEPTION 'BF216A replay changed';END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[2],'role','authenticated')::text,true);
 IF public.void_purchase(b,op,pid,'  Original reason  ') IS DISTINCT FROM v THEN RAISE EXCEPTION 'BF216A second OWNER replay';END IF;
 checks:=checks+4;
 PERFORM pg_temp.bf216a_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,op,pid,'different'),'PT409','CONFLICT');
 PERFORM pg_temp.bf216a_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,gen_random_uuid(),pid,'  Original reason  '),'PT409','INVALID_STATUS');
 second:=pg_temp.bf216a_buy(b,c,p[2]);
 PERFORM pg_temp.bf216a_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,op,second->'purchase'->>'id','  Original reason  '),'PT409','CONFLICT');
 FOREACH r IN ARRAY ARRAY['','   '] LOOP
   PERFORM pg_temp.bf216a_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,gen_random_uuid(),pid,r),'22023','INVALID_INPUT');
 END LOOP;
 checks:=checks+5;
 FOR variant IN 3..5 LOOP
   PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[variant],'role','authenticated')::text,true);
   PERFORM pg_temp.bf216a_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,op,pid,'  Original reason  '),'42501','ACCESS_DENIED');
 END LOOP;
 PERFORM set_config('request.jwt.claims','{}',true);
 PERFORM pg_temp.bf216a_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,op,pid,'  Original reason  '),'42501','ACCESS_DENIED');
 PERFORM set_config('role','anon',true);
 PERFORM pg_temp.bf216a_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,op,pid,'  Original reason  '),'42501');
 PERFORM set_config('role','postgres',true);
 PERFORM pg_temp.bf216a_error(format('INSERT INTO private.purchase_voids SELECT * FROM private.purchase_voids WHERE purchase_id=%L',pid),'23505');
 PERFORM pg_temp.bf216a_error(format('INSERT INTO private.purchase_voids(business_id,purchase_id,operation_id,reason,created_by) VALUES(%L,%L,%L,%L,%L)',b,second->'purchase'->>'id',op,'unique operation',users[1]),'23505');
 PERFORM pg_temp.bf216a_error(format('INSERT INTO private.purchase_voids(business_id,purchase_id,operation_id,reason,created_by) VALUES(%L,%L,%L,%L,%L)',b,pid,gen_random_uuid(),'unique purchase',users[1]),'23505');
 PERFORM pg_temp.bf216a_error(format('UPDATE private.purchase_voids SET reason=%L WHERE purchase_id=%L','changed',pid),'55000');
 PERFORM pg_temp.bf216a_error(format('DELETE FROM private.purchase_voids WHERE purchase_id=%L',pid),'55000');
 checks:=checks+10;
 -- Corrupt privileged fixtures only inside rolled-back subtransactions.
 aid:=(v->'correction'->>'id')::uuid;
 -- Reference identities are scoped by domain: a later stock adjustment may
 -- legitimately reuse the audit UUID without becoming a void compensation.
 BEGIN
   PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
   PERFORM set_config('role','authenticated',true);
   PERFORM public.adjust_stock(b,aid,p[1],1,'ADJUSTMENT',NULL);
   IF public.void_purchase(b,op,pid,'  Original reason  ') IS DISTINCT FROM v THEN RAISE EXCEPTION 'BF216A cross-domain replay';END IF;
   RAISE SQLSTATE 'ZX001';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;END;
 checks:=checks+1;
 FOR variant IN 1..10 LOOP
   BEGIN
     ALTER TABLE public.stock_movements DISABLE TRIGGER stock_movements_append_only;
     ALTER TABLE private.purchase_voids DISABLE TRIGGER purchase_voids_append_only;
     IF variant=1 THEN DELETE FROM private.purchase_voids WHERE id=aid;
     ELSIF variant=2 THEN DELETE FROM public.stock_movements WHERE reference_id=aid;
     ELSIF variant=3 THEN UPDATE public.stock_movements SET quantity_delta=-2 WHERE reference_id=aid;
     ELSIF variant=4 THEN UPDATE public.stock_movements SET unit_cost=11 WHERE reference_id=aid;
     ELSIF variant=5 THEN UPDATE public.stock_movements SET reference_type='BROKEN' WHERE reference_id=aid;
     ELSIF variant=6 THEN UPDATE public.stock_movements SET created_by=users[2] WHERE reference_id=aid;
     ELSIF variant=7 THEN DELETE FROM public.expenses WHERE purchase_id=pid;
     ELSIF variant=8 THEN UPDATE public.expenses SET amount=11 WHERE purchase_id=pid;
     ELSIF variant=9 THEN UPDATE public.purchases SET status='COMPLETED' WHERE id=pid;
     ELSE INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,unit_cost,reference_type,reference_id,created_by)
       VALUES(b,p[1],'ADJUSTMENT',-1,10,'PURCHASE_VOID',aid,users[1]);END IF;
     ALTER TABLE public.stock_movements ENABLE TRIGGER stock_movements_append_only;
     ALTER TABLE private.purchase_voids ENABLE TRIGGER purchase_voids_append_only;
     PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
     PERFORM set_config('role','authenticated',true);
     PERFORM pg_temp.bf216a_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,op,pid,'  Original reason  '),'PT409','INCOMPLETE_HISTORY');
     RAISE SQLSTATE 'ZX001';
   EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;END;
 END LOOP;
 checks:=checks+10;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 PERFORM pg_temp.bf216a_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,gen_random_uuid(),gen_random_uuid(),'missing'),'42501','ACCESS_DENIED');
 PERFORM pg_temp.bf216a_error('SELECT * FROM private.purchase_voids','42501');
 checks:=checks+2;
 -- Later serialized cost is never restored, including when voiding latest B.
 original:=pg_temp.bf216a_buy(b,c,p[3],2,'10.00');second:=pg_temp.bf216a_buy(b,c,p[3],2,'12.00');
 PERFORM public.void_purchase(b,gen_random_uuid(),(original->'purchase'->>'id')::uuid,'A');
 IF (SELECT default_purchase_cost FROM public.products WHERE id=p[3])<>12 THEN RAISE EXCEPTION 'BF216A void A cost';END IF;
 PERFORM public.void_purchase(b,gen_random_uuid(),(second->'purchase'->>'id')::uuid,'B');
 IF (SELECT default_purchase_cost FROM public.products WHERE id=p[3])<>12 THEN RAISE EXCEPTION 'BF216A void B cost';END IF;
 checks:=checks+2;
 -- Duplicates/multiple products/zero cost, then archival and manual expense.
 original:=public.complete_purchase(b,gen_random_uuid(),'Multi',c,'CASH','2026-09-20T12:00Z',NULL,
   jsonb_build_array(jsonb_build_object('productId',p[1],'quantity',1,'unitCost','0.00'),
     jsonb_build_object('productId',p[1],'quantity',2,'unitCost','0.00'),
     jsonb_build_object('productId',p[2],'quantity',2,'unitCost','5.00')));
 PERFORM set_config('role','postgres',true);
 UPDATE public.products SET is_active=false WHERE id=ANY(p);
 UPDATE public.expense_categories SET is_active=false WHERE id=c;
 PERFORM set_config('role','authenticated',true);
 v:=public.void_purchase(b,gen_random_uuid(),(original->'purchase'->>'id')::uuid,'archived');
 IF jsonb_array_length(v->'stockMovements')<>3 OR v->'expense' IS DISTINCT FROM original->'expense' THEN RAISE EXCEPTION 'BF216A duplicates/archive';END IF;
 BEGIN
   PERFORM set_config('role','postgres',true);
   ALTER TABLE public.stock_movements DISABLE TRIGGER stock_movements_append_only;
   DELETE FROM public.stock_movements WHERE id=(v->'stockMovements'->0->>'id')::uuid;
   ALTER TABLE public.stock_movements ENABLE TRIGGER stock_movements_append_only;
   PERFORM set_config('role','authenticated',true);
   PERFORM pg_temp.bf216a_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,v->'correction'->>'operation_id',v->'purchase'->>'id','archived'),'PT409','INCOMPLETE_HISTORY');
   RAISE SQLSTATE 'ZX001';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;END;
 checks:=checks+1;
 -- Reference predicate only: there is no existing effective aggregation API.
 PERFORM set_config('role','postgres',true);
 INSERT INTO public.expenses(business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by)
   VALUES(b,c,'MANUAL','Manual',7,'CASH','2026-09-20',users[1]);
 IF (SELECT sum(e.amount) FROM public.expenses e WHERE e.business_id=b AND e.expense_date BETWEEN '2026-09-01' AND '2026-09-30'
     AND NOT (e.source_type='PURCHASE' AND EXISTS(SELECT 1 FROM public.purchases q WHERE q.id=e.purchase_id AND q.business_id=e.business_id AND q.status='VOIDED')))<>17
   OR (SELECT count(*) FROM public.expenses WHERE business_id=b AND expense_date BETWEEN '2026-10-01' AND '2026-10-31')<>0 THEN RAISE EXCEPTION 'BF216A effective original period/manual';END IF;
 UPDATE public.products SET is_active=true WHERE id=ANY(p);
 UPDATE public.expense_categories SET is_active=true WHERE id=c;
 checks:=checks+3;
 PERFORM set_config('role','authenticated',true);
 original:=pg_temp.bf216a_buy(b,c,p[1],2);pid:=(original->'purchase'->>'id')::uuid;
 PERFORM public.adjust_stock(b,gen_random_uuid(),p[1],-1,'LOSS',NULL);
 stock_before:=(SELECT sum(quantity_delta) FROM public.stock_movements WHERE product_id=p[1]);
 PERFORM pg_temp.bf216a_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,gen_random_uuid(),pid,'insufficient'),'PT409','INSUFFICIENT_STOCK');
 IF (SELECT status FROM public.purchases WHERE id=pid)<>'COMPLETED' OR (SELECT sum(quantity_delta) FROM public.stock_movements WHERE product_id=p[1])<>stock_before THEN RAISE EXCEPTION 'BF216A insufficient partial';END IF;
 checks:=checks+2;
 -- One insufficient product rejects every line in a multi-product void.
 original:=public.complete_purchase(b,gen_random_uuid(),'Two',c,'CASH','2026-09-20T12:00Z',NULL,
   jsonb_build_array(jsonb_build_object('productId',p[1],'quantity',2,'unitCost','10.00'),
     jsonb_build_object('productId',p[2],'quantity',2,'unitCost','10.00')));
 pid:=(original->'purchase'->>'id')::uuid;
 PERFORM public.adjust_stock(b,gen_random_uuid(),p[1],-2,'LOSS',NULL);
 PERFORM pg_temp.bf216a_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,gen_random_uuid(),pid,'multi insufficient'),'PT409','INSUFFICIENT_STOCK');
 IF (SELECT status FROM public.purchases WHERE id=pid)<>'COMPLETED' THEN RAISE EXCEPTION 'BF216A multi partial status';END IF;
 PERFORM set_config('role','postgres',true);
 IF EXISTS(SELECT 1 FROM private.purchase_voids WHERE purchase_id=pid) THEN RAISE EXCEPTION 'BF216A multi partial audit';END IF;
 PERFORM set_config('role','authenticated',true);
 checks:=checks+1;
 -- Inject after audit insertion and after compensation insertion: both roll back.
 original:=pg_temp.bf216a_buy(b,c,p[3]);pid:=(original->'purchase'->>'id')::uuid;
 FOREACH r IN ARRAY ARRAY['stock_movements','purchases'] LOOP
   stock_before:=(SELECT sum(quantity_delta) FROM public.stock_movements WHERE product_id=p[3]);
   PERFORM set_config('bf216a.fail',r,true);
   PERFORM pg_temp.bf216a_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,gen_random_uuid(),pid,'rollback'),'P0001');
   PERFORM set_config('bf216a.fail','',true);
   PERFORM set_config('role','postgres',true);
   IF EXISTS(SELECT 1 FROM private.purchase_voids WHERE purchase_id=pid) OR (SELECT status FROM public.purchases WHERE id=pid)<>'COMPLETED'
     OR (SELECT sum(quantity_delta) FROM public.stock_movements WHERE product_id=p[3])<>stock_before THEN RAISE EXCEPTION 'BF216A fault partial';END IF;
   PERFORM set_config('role','authenticated',true);
 END LOOP;
 checks:=checks+2;
 PERFORM set_config('role','postgres',true);
 INSERT INTO public.purchases(business_id,operation_id,supplier,status,total,created_by)
   VALUES(b,gen_random_uuid(),'Draft','DRAFT',0,users[1]) RETURNING id INTO pid;
 PERFORM set_config('role','authenticated',true);
 PERFORM pg_temp.bf216a_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,gen_random_uuid(),pid,'draft'),'PT409','INVALID_STATUS');
 checks:=checks+1;
 RAISE NOTICE 'BF216A PASS % grouped checks',checks;
END $$;
ROLLBACK;
