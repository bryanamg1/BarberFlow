\set ON_ERROR_STOP on
-- Integration-only fixtures/faults/helpers: none survive this transaction.
BEGIN;
CREATE FUNCTION pg_temp.bf303_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'BF303 %',label; END IF;
END $$;
CREATE FUNCTION pg_temp.bf303_error(statement text,expected text,detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$ DECLARE s text;d text; BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS s=RETURNED_SQLSTATE,d=PG_EXCEPTION_DETAIL; END;
 PERFORM pg_temp.bf303_assert(s=expected AND (detail IS NULL OR d=detail),format('expected %s/%s, got %s/%s',expected,detail,s,d));
END $$;
CREATE FUNCTION pg_temp.bf303_unchanged(statement text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE n bigint; BEGIN
 BEGIN EXECUTE statement; GET DIAGNOSTICS n=ROW_COUNT;
 EXCEPTION WHEN insufficient_privilege THEN n:=0; END;
 PERFORM pg_temp.bf303_assert(n=0,'direct historical mutation affected a row');
END $$;
CREATE FUNCTION pg_temp.bf303_state(b uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
 'purchase',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.purchases t WHERE business_id=b),
 'items',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.purchase_items t JOIN public.purchases p ON p.id=t.purchase_id WHERE p.business_id=b),
 'stock',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stock_movements t WHERE business_id=b),
 'expense',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.expenses t WHERE business_id=b),
 'audit',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM private.purchase_voids t WHERE business_id=b),
 'products',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.products t WHERE business_id=b));
$$;
CREATE FUNCTION pg_temp.bf303_line(p uuid,q integer,c text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('productId',p,'quantity',q,'unitCost',c);
$$;
CREATE FUNCTION pg_temp.bf303_buy(b uuid,op uuid,c uuid,items jsonb,method text DEFAULT 'BANK_TRANSFER')
RETURNS jsonb LANGUAGE sql AS $$ SELECT public.complete_purchase(b,op,'  BF303 supplier  ',c,method,
 '2026-01-01T01:30Z',E'  notes\n\t',items); $$;
CREATE FUNCTION pg_temp.bf303_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_setting('bf303.fail',true)=TG_TABLE_NAME THEN
   IF TG_TABLE_NAME='expenses' THEN
     PERFORM pg_temp.bf303_assert(EXISTS(SELECT 1 FROM public.stock_movements WHERE reference_type='PURCHASE' AND reference_id=NEW.purchase_id),
       'late expense fault must follow actual stock effects');
   END IF;
   RAISE EXCEPTION USING ERRCODE='P0303',MESSAGE='BF303 controlled stage fault';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER bf303_fault BEFORE INSERT ON public.purchases FOR EACH ROW EXECUTE FUNCTION pg_temp.bf303_fault();
CREATE TRIGGER bf303_fault BEFORE INSERT ON public.purchase_items FOR EACH ROW EXECUTE FUNCTION pg_temp.bf303_fault();
CREATE TRIGGER bf303_fault BEFORE INSERT ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION pg_temp.bf303_fault();
CREATE TRIGGER bf303_fault BEFORE INSERT ON public.expenses FOR EACH ROW EXECUTE FUNCTION pg_temp.bf303_fault();
DO $$ DECLARE
 b uuid:=gen_random_uuid();fb uuid:=gen_random_uuid();c uuid:=gen_random_uuid();fc uuid:=gen_random_uuid();
 u uuid[]:=ARRAY(SELECT gen_random_uuid() FROM generate_series(1,5));
 p uuid[]:=ARRAY(SELECT gen_random_uuid() FROM generate_series(1,9));
 op uuid;original_op uuid;pid uuid;aid uuid;vop uuid;before_rows jsonb;original jsonb;multi jsonb;result jsonb;v jsonb;detail jsonb;
 a jsonb;z jsonb;foreign_purchase jsonb;foreign_history jsonb;lines jsonb;method text;stage text;cols text[];variant integer;n integer;groups integer:=0;
BEGIN
 INSERT INTO auth.users(id) SELECT unnest(u);
 INSERT INTO public.businesses(id,name,timezone) VALUES(b,'BF303 A','America/Argentina/Buenos_Aires'),(fb,'BF303 B','UTC');
 INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES
  (b,u[1],'OWNER',true),(b,u[2],'BARBER',true),(b,u[3],'OWNER',false),(fb,u[4],'OWNER',true);
 INSERT INTO public.expense_categories(id,business_id,name) VALUES(c,b,'BF303 historical category'),(fc,fb,'Foreign category');
 INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost)
  SELECT x,CASE WHEN x=p[9] THEN fb ELSE b END,'BF303 original',20,7 FROM unnest(p) x;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[1],'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 original_op:=gen_random_uuid();
 original:=pg_temp.bf303_buy(b,original_op,c,jsonb_build_array(pg_temp.bf303_line(p[1],3,'0.29')));
 pid:=(original->'purchase'->>'id')::uuid;
 SELECT array_agg(k ORDER BY k) INTO cols FROM jsonb_object_keys(original) k;
 PERFORM pg_temp.bf303_assert(cols=ARRAY['expense','items','purchase'],'completion exact envelope');
 SELECT array_agg(k ORDER BY k) INTO cols FROM jsonb_object_keys(original->'purchase') k;
 PERFORM pg_temp.bf303_assert(cols=ARRAY['business_id','created_at','created_by','id','notes','operation_id','purchased_at','status','supplier','total','updated_at'],'exact11 public purchase keys');
 SELECT array_agg(k ORDER BY k) INTO cols FROM jsonb_object_keys(original->'items'->0) k;
 PERFORM pg_temp.bf303_assert(cols=ARRAY['created_at','id','line_total','product_id','product_name_snapshot','purchase_id','quantity','unit_cost_snapshot'],'exact8 item keys');
 SELECT array_agg(k ORDER BY k) INTO cols FROM jsonb_object_keys(original->'expense') k;
 PERFORM pg_temp.bf303_assert(cols=ARRAY['amount','business_id','category_id','created_at','created_by','description','expense_date','id','notes','payment_method','purchase_id','receipt_path','source_type','updated_at'],'exact14 expense keys');
 PERFORM pg_temp.bf303_assert(original->'purchase'->>'status'='COMPLETED' AND original->'purchase'->>'supplier'='  BF303 supplier  '
  AND original->'purchase'->>'business_id'=b::text AND original->'purchase'->>'created_by'=u[1]::text
  AND original->'purchase'->>'operation_id'=original_op::text AND (original->'purchase'->>'total')::numeric=0.87
  AND original->'items'->0->>'product_name_snapshot'='BF303 original' AND (original->'items'->0->>'line_total')::numeric=0.87,
  'single product header/snapshot/exact numeric total');
 PERFORM pg_temp.bf303_assert(original->'expense'->>'purchase_id'=pid::text AND original->'expense'->>'source_type'='PURCHASE'
  AND original->'expense'->>'category_id'=c::text AND original->'expense'->>'created_by'=u[1]::text
  AND original->'expense'->>'payment_method'='BANK_TRANSFER' AND original->'expense'->>'description'='Compra de productos'
  AND original->'expense'->>'notes'=E'  notes\n\t' AND original->'expense'->>'receipt_path' IS NULL
  AND original->'expense'->>'expense_date'='2025-12-31' AND (original->'expense'->>'amount')::numeric=0.87,'generated expense/context/civil date exact');
 PERFORM pg_temp.bf303_assert((SELECT count(*) FROM public.expenses WHERE purchase_id=pid)=1
  AND (SELECT count(*) FROM public.stock_movements WHERE reference_type='PURCHASE' AND reference_id=pid AND quantity_delta=3 AND unit_cost=0.29)=1
  AND (SELECT current_stock FROM public.get_product_stock(b,ARRAY[p[1]]))='3'
  AND (SELECT default_purchase_cost FROM public.products WHERE id=p[1])=0.29,'one atomic effect set');
 detail:=public.get_purchase_detail(b,pid);
 PERFORM pg_temp.bf303_assert(detail->'purchase'->>'status'='COMPLETED'
   AND jsonb_array_length(detail->'items')=1 AND (detail->'expense'->>'amount')::numeric=0.87
   AND detail->'voidInfo'->>'status'='not_applicable','completed detail reflects persisted pipeline');
 groups:=groups+1;

 multi:=pg_temp.bf303_buy(b,gen_random_uuid(),c,jsonb_build_array(
  pg_temp.bf303_line(p[2],2,'10.00'),pg_temp.bf303_line(p[2],3,'10.00'),pg_temp.bf303_line(p[3],1,'12.00')));
 PERFORM pg_temp.bf303_assert(jsonb_array_length(multi->'items')=3 AND (multi->'purchase'->>'total')::numeric=62
  AND (multi->'expense'->>'amount')::numeric=62
  AND (SELECT count(*) FROM public.stock_movements WHERE reference_type='PURCHASE' AND reference_id=(multi->'purchase'->>'id')::uuid)=3
  AND (SELECT current_stock FROM public.get_product_stock(b,ARRAY[p[2]]))='5','multiple products/duplicate lines/total');
 PERFORM pg_temp.bf303_assert((SELECT array_agg(quantity_delta ORDER BY quantity_delta) FROM public.stock_movements
  WHERE reference_type='PURCHASE' AND reference_id=(multi->'purchase'->>'id')::uuid AND product_id=p[2])=ARRAY[2,3],'duplicate multiset retained');
 groups:=groups+1;

 SET LOCAL ROLE postgres; before_rows:=pg_temp.bf303_state(b); SET LOCAL ROLE authenticated;
 PERFORM pg_temp.bf303_assert(pg_temp.bf303_buy(b,original_op,c,jsonb_build_array(pg_temp.bf303_line(p[1],3,'0.29')))=original,'exact replay');
 result:=public.complete_purchase(b,original_op,'different',fc,'CASH','2000-01-01Z','different',
  jsonb_build_array(pg_temp.bf303_line(p[9],99,'99.00')));
 PERFORM pg_temp.bf303_assert(result=original,'changed replay payload cannot alter history');
 SET LOCAL ROLE postgres;
 PERFORM pg_temp.bf303_assert(pg_temp.bf303_state(b)=before_rows,'replay zero writes including current cost/audit');
 UPDATE public.products SET name='renamed',default_purchase_cost=42,is_active=false WHERE id=p[1];
 UPDATE public.expense_categories SET name='renamed category',is_active=false WHERE id=c;
 UPDATE public.businesses SET timezone='Pacific/Auckland' WHERE id=b;
 before_rows:=pg_temp.bf303_state(b); SET LOCAL ROLE authenticated;
 PERFORM pg_temp.bf303_assert(pg_temp.bf303_buy(b,original_op,c,'[]')=original,'archived catalog/timezone replay preserves snapshots/date');
 SET LOCAL ROLE postgres;
 PERFORM pg_temp.bf303_assert(pg_temp.bf303_state(b)=before_rows,'catalog replay zero writes');
 UPDATE public.products SET is_active=true WHERE id=p[1]; UPDATE public.expense_categories SET is_active=true WHERE id=c;
 UPDATE public.businesses SET timezone='America/Argentina/Buenos_Aires' WHERE id=b;
 SET LOCAL ROLE authenticated; groups:=groups+1;

 FOREACH method IN ARRAY ARRAY['CASH','BANK_TRANSFER','DEBIT_CARD','CREDIT_CARD','DIGITAL_WALLET'] LOOP
  result:=pg_temp.bf303_buy(b,gen_random_uuid(),c,jsonb_build_array(pg_temp.bf303_line(p[4],1,'0.00')),method);
  PERFORM pg_temp.bf303_assert((result->'expense'->>'amount')::numeric=0 AND result->'expense'->>'payment_method'=method,'HD006 zero-cost expense');
 END LOOP;
 SET LOCAL ROLE postgres; before_rows:=pg_temp.bf303_state(b); SET LOCAL ROLE authenticated;
 FOREACH method IN ARRAY ARRAY['TRANSFER','DEBIT','CREDIT','OTHER'] LOOP
  PERFORM pg_temp.bf303_error(format('SELECT pg_temp.bf303_buy(%L,%L,%L,%L::jsonb,%L)',b,gen_random_uuid(),c,
    jsonb_build_array(pg_temp.bf303_line(p[4],1,'1.00')),method),'22023','INVALID_INPUT');
 END LOOP;
 PERFORM pg_temp.bf303_error(format('SELECT pg_temp.bf303_buy(%L,%L,%L,%L::jsonb)',b,gen_random_uuid(),c,
   jsonb_build_array(pg_temp.bf303_line(p[4],2,'10.00'),pg_temp.bf303_line(p[4],3,'11.00'))),'22023','INVALID_INPUT');
 SET LOCAL ROLE postgres; PERFORM pg_temp.bf303_assert(pg_temp.bf303_state(b)=before_rows,'invalid methods/costs zero artifacts');
 SET LOCAL ROLE authenticated;
 result:=pg_temp.bf303_buy(b,gen_random_uuid(),c,jsonb_build_array(pg_temp.bf303_line(p[4],1,'9999999999.99')));
 PERFORM pg_temp.bf303_assert((result->'purchase'->>'total')::numeric=9999999999.99 AND result->'expense'->'amount'=result->'purchase'->'total','existing numeric12,2 maximum');
 PERFORM pg_temp.bf303_error(format('SELECT pg_temp.bf303_buy(%L,%L,%L,%L::jsonb)',b,gen_random_uuid(),c,
   jsonb_build_array(pg_temp.bf303_line(p[4],2,'9999999999.99'))),'22023','INVALID_INPUT');
 groups:=groups+1;

 -- Cost precedence is application order. Void/replay cannot restore past cost.
 a:=public.complete_purchase(b,gen_random_uuid(),'A',c,'CASH','2026-09-20Z',NULL,jsonb_build_array(pg_temp.bf303_line(p[5],2,'10.00')));
 z:=public.complete_purchase(b,gen_random_uuid(),'B',c,'CASH','2026-01-01Z',NULL,jsonb_build_array(pg_temp.bf303_line(p[5],3,'12.00')));
 PERFORM pg_temp.bf303_buy(b,(a->'purchase'->>'operation_id')::uuid,c,'[]');
 PERFORM pg_temp.bf303_assert((SELECT default_purchase_cost FROM public.products WHERE id=p[5])=12,'backdating and replay do not reverse applied cost');
 vop:=gen_random_uuid(); v:=public.void_purchase(b,vop,(z->'purchase'->>'id')::uuid,'  historical reason  ');
 detail:=public.get_purchase_detail(b,(z->'purchase'->>'id')::uuid);
 PERFORM pg_temp.bf303_assert(detail->'purchase'->>'status'='VOIDED' AND detail->'voidInfo'->>'status'='available'
  AND detail->'voidInfo'->>'reason'='  historical reason  ' AND (detail->'voidInfo'->'stockCompensation'->0->>'quantity_delta')::integer=-3
  AND detail::text NOT LIKE '%operation_id%' AND detail::text NOT LIKE '%reference_id%' AND detail::text NOT LIKE '%created_by%','minimized detail coherent after void');
 PERFORM pg_temp.bf303_assert(v->'expense'=z->'expense' AND v->'items'=z->'items' AND (SELECT default_purchase_cost FROM public.products WHERE id=p[5])=12,'void preserves original expense/items/reference cost');
 result:=pg_temp.bf303_buy(b,(z->'purchase'->>'operation_id')::uuid,c,'[]');
 PERFORM pg_temp.bf303_assert(result->'purchase'->>'status'='VOIDED' AND result->'items'=z->'items' AND result->'expense'=z->'expense','completion replay returns persisted VOIDED history');
 PERFORM pg_temp.bf303_assert(public.void_purchase(b,vop,(z->'purchase'->>'id')::uuid,'  historical reason  ')=v,'exact void replay');
 PERFORM pg_temp.bf303_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,gen_random_uuid(),z->'purchase'->>'id','new correction'),'PT409','INVALID_STATUS');
 PERFORM public.void_purchase(b,gen_random_uuid(),(a->'purchase'->>'id')::uuid,'void A');
 PERFORM pg_temp.bf303_assert((SELECT default_purchase_cost FROM public.products WHERE id=p[5])=12
  AND (SELECT current_stock FROM public.get_product_stock(b,ARRAY[p[5]]))='0','void A preserves latest cost');
 a:=pg_temp.bf303_buy(b,gen_random_uuid(),c,jsonb_build_array(pg_temp.bf303_line(p[6],1,'10.00')));
 PERFORM public.void_purchase(b,gen_random_uuid(),(a->'purchase'->>'id')::uuid,'sole');
 PERFORM pg_temp.bf303_assert((SELECT default_purchase_cost FROM public.products WHERE id=p[6])=10,'sole purchase void keeps cost');
 groups:=groups+1;

 a:=pg_temp.bf303_buy(b,gen_random_uuid(),c,jsonb_build_array(pg_temp.bf303_line(p[7],5,'10.00')));
 PERFORM public.adjust_stock(b,gen_random_uuid(),p[7],-4,'LOSS',NULL);
 SET LOCAL ROLE postgres; before_rows:=pg_temp.bf303_state(b); SET LOCAL ROLE authenticated;
 PERFORM pg_temp.bf303_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,gen_random_uuid(),a->'purchase'->>'id','insufficient'),'PT409','INSUFFICIENT_STOCK');
 SET LOCAL ROLE postgres; PERFORM pg_temp.bf303_assert(pg_temp.bf303_state(b)=before_rows,'insufficient void whole pipeline unchanged');
 SET LOCAL ROLE authenticated; groups:=groups+1;

 -- Every fault is caught in a subtransaction; compare ALL persisted artifacts,
 -- not merely a status code or absence of one header.
 FOREACH stage IN ARRAY ARRAY['purchases','purchase_items','stock_movements','expenses'] LOOP
  SET LOCAL ROLE postgres; before_rows:=pg_temp.bf303_state(b); SET LOCAL ROLE authenticated;
  op:=gen_random_uuid(); PERFORM set_config('bf303.fail',stage,true);
  PERFORM pg_temp.bf303_error(format('SELECT pg_temp.bf303_buy(%L,%L,%L,%L::jsonb)',b,op,c,
   jsonb_build_array(pg_temp.bf303_line(p[8],2,'19.00'))),'P0303');
  PERFORM set_config('bf303.fail','',true);
  SET LOCAL ROLE postgres; PERFORM pg_temp.bf303_assert(pg_temp.bf303_state(b)=before_rows,'fault rollback: '||stage);
  SET LOCAL ROLE authenticated;
  result:=pg_temp.bf303_buy(b,op,c,jsonb_build_array(pg_temp.bf303_line(p[8],2,'19.00')));
  PERFORM pg_temp.bf303_assert(result->'expense'->>'id' IS NOT NULL,'failed operation key reusable after rollback');
  groups:=groups+1;
 END LOOP;

 -- Historical corruption exists only inside rolled-back privileged fixtures.
 -- Never disable append-only triggers to build a scenario.
 SET LOCAL ROLE postgres;
 FOR variant IN 1..10 LOOP
  BEGIN
   op:=gen_random_uuid(); lines:=jsonb_build_array(pg_temp.bf303_line(p[8],1,'1.00'),pg_temp.bf303_line(p[8],1,'1.00'));
   IF variant IN (1,8) THEN
    INSERT INTO public.purchases(business_id,operation_id,supplier,status,total,created_by,expense_category_id,payment_method)
     VALUES(b,op,'partial',CASE WHEN variant=8 THEN 'DRAFT' ELSE 'COMPLETED' END,0,u[1],c,'CASH') RETURNING id INTO aid;
   ELSE
    result:=private.persist_purchase(b,op,'partial',c,'CASH','2026-01-01Z',NULL,lines); aid:=(result->'purchase'->>'id')::uuid;
    IF variant=3 THEN PERFORM private.persist_purchase_stock(b,op,true); END IF;
    IF variant IN (4,5,6) THEN
     INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,unit_cost,reference_type,reference_id,created_by)
      VALUES(b,p[8],CASE WHEN variant=6 THEN 'ADJUSTMENT' ELSE 'PURCHASE' END,CASE WHEN variant=5 THEN 3 ELSE 1 END,
       1,'PURCHASE',aid,u[1]);
    END IF;
    IF variant=7 THEN
     UPDATE public.purchase_items SET unit_cost_snapshot=2,line_total=2 WHERE id=(SELECT min(id::text)::uuid FROM public.purchase_items WHERE purchase_id=aid);
     UPDATE public.purchases SET total=3 WHERE id=aid;
    END IF;
    IF variant=9 THEN
     PERFORM private.persist_purchase_stock(b,op,true); PERFORM private.persist_purchase_expense(b,op,true);
     UPDATE public.expenses SET amount=0 WHERE purchase_id=aid;
    END IF;
    IF variant=10 THEN
     INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,unit_cost,reference_type,reference_id,created_by)
      VALUES(b,p[8],'PURCHASE',2,1,'PURCHASE',gen_random_uuid(),u[1]);
    END IF;
   END IF;
   before_rows:=pg_temp.bf303_state(b); SET LOCAL ROLE authenticated;
   PERFORM pg_temp.bf303_error(format('SELECT pg_temp.bf303_buy(%L,%L,%L,%L::jsonb)',b,op,c,lines),
    CASE WHEN variant=8 THEN 'PT409' ELSE '22023' END,CASE WHEN variant=8 THEN 'INVALID_STATUS' ELSE 'INVALID_INPUT' END);
   SET LOCAL ROLE postgres; PERFORM pg_temp.bf303_assert(pg_temp.bf303_state(b)=before_rows,'incomplete history not repaired: '||variant);
   RAISE EXCEPTION USING ERRCODE='P0399',MESSAGE='rollback corrupt fixture';
  EXCEPTION WHEN SQLSTATE 'P0399' THEN NULL; END;
 END LOOP;
 groups:=groups+1;

 -- Current authorization protects NEW and replay, not just UI affordances.
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[4],'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 foreign_purchase:=pg_temp.bf303_buy(fb,gen_random_uuid(),fc,jsonb_build_array(pg_temp.bf303_line(p[9],1,'1.00')));
 SET LOCAL ROLE postgres; foreign_history:=pg_temp.bf303_state(fb);
 before_rows:=pg_temp.bf303_state(b);
 FOR n IN 2..5 LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[n],'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bf303_error(format('SELECT pg_temp.bf303_buy(%L,%L,%L,%L::jsonb)',b,original_op,c,'[]'),'42501','ACCESS_DENIED');
  PERFORM pg_temp.bf303_error(format('SELECT pg_temp.bf303_buy(%L,%L,%L,%L::jsonb)',b,gen_random_uuid(),c,'[]'),'42501','ACCESS_DENIED');
  PERFORM pg_temp.bf303_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,gen_random_uuid(),pid,'denied'),'42501','ACCESS_DENIED');
  SET LOCAL ROLE postgres;
 END LOOP;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[1],'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 PERFORM pg_temp.bf303_error(format('SELECT pg_temp.bf303_buy(%L,%L,%L,%L::jsonb)',b,gen_random_uuid(),fc,
  jsonb_build_array(pg_temp.bf303_line(p[2],1,'1.00'))),'22023','INVALID_INPUT');
 PERFORM pg_temp.bf303_error(format('SELECT pg_temp.bf303_buy(%L,%L,%L,%L::jsonb)',b,gen_random_uuid(),c,
  jsonb_build_array(pg_temp.bf303_line(p[9],1,'1.00'))),'22023','INVALID_INPUT');
 PERFORM pg_temp.bf303_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',fb,gen_random_uuid(),pid,'foreign business'),'42501','ACCESS_DENIED');
 PERFORM pg_temp.bf303_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,gen_random_uuid(),foreign_purchase->'purchase'->>'id','foreign purchase'),'42501','ACCESS_DENIED');
 PERFORM pg_temp.bf303_error(format('SELECT pg_temp.bf303_buy(%L,%L,%L,%L::jsonb)',fb,gen_random_uuid(),fc,
   jsonb_build_array(pg_temp.bf303_line(p[9],1,'1.00'))),'42501','ACCESS_DENIED');
 PERFORM pg_temp.bf303_assert(public.get_purchase_detail(b,(foreign_purchase->'purchase'->>'id')::uuid) IS NULL,'foreign purchase detail hidden');
 SET LOCAL ROLE anon;
 PERFORM pg_temp.bf303_error(format('SELECT pg_temp.bf303_buy(%L,%L,%L,%L::jsonb)',b,original_op,c,'[]'),'42501');
 SET LOCAL ROLE postgres; PERFORM pg_temp.bf303_assert(pg_temp.bf303_state(b)=before_rows,'denied requests leave artifacts untouched');
 PERFORM pg_temp.bf303_assert(pg_temp.bf303_state(fb)=foreign_history,'foreign history unchanged');
 SET LOCAL ROLE authenticated;
 -- Exercise actual rows as current OWNER; generated Expense has SELECT but no
 -- UPDATE policy, so either denied privilege or zero affected rows is correct.
 FOREACH stage IN ARRAY ARRAY['purchases','purchase_items','stock_movements'] LOOP
  PERFORM pg_temp.bf303_error(format('INSERT INTO public.%I DEFAULT VALUES',stage),'42501');
  PERFORM pg_temp.bf303_error(format('UPDATE public.%I SET id=id',stage),'42501');
  PERFORM pg_temp.bf303_error(format('DELETE FROM public.%I',stage),'42501');
 END LOOP;
 PERFORM pg_temp.bf303_unchanged(format('UPDATE public.expenses SET amount=0 WHERE purchase_id=%L',pid));
 PERFORM pg_temp.bf303_unchanged(format('DELETE FROM public.expenses WHERE purchase_id=%L',pid));
 PERFORM pg_temp.bf303_error(format('INSERT INTO public.expenses(business_id,category_id,source_type,purchase_id,description,amount,payment_method,expense_date,created_by) VALUES(%L,%L,%L,%L,%L,1,%L,current_date,%L)',b,c,'PURCHASE',pid,'denied','CASH',u[1]),'42501');
 PERFORM pg_temp.bf303_error('UPDATE private.purchase_voids SET reason=reason','42501');
 PERFORM pg_temp.bf303_error('DELETE FROM private.purchase_voids','42501');
 SET LOCAL ROLE postgres;
 PERFORM pg_temp.bf303_assert(pg_temp.bf303_state(b)=before_rows,'direct client writes cannot mutate history');
 PERFORM pg_temp.bf303_error('UPDATE private.purchase_voids SET reason=reason','55000');
 PERFORM pg_temp.bf303_error('DELETE FROM private.purchase_voids','55000');
 PERFORM pg_temp.bf303_error(format('UPDATE public.stock_movements SET notes=%L WHERE reference_id=%L','changed',pid),'55000');
 groups:=groups+1;
 PERFORM pg_temp.bf303_assert(groups=12,'group discovery');
 RAISE NOTICE 'BF303 purchase regression PASS %/12 integrated groups (including10 incomplete-history variants)',groups;
END $$;
ROLLBACK;
