\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  b uuid[]:=ARRAY[gen_random_uuid(),gen_random_uuid()];
  u uuid[]:=ARRAY(SELECT gen_random_uuid() FROM generate_series(1,6));
  service uuid:=gen_random_uuid();
  client uuid:=gen_random_uuid();
  member uuid:=gen_random_uuid();
  appointment uuid:=gen_random_uuid();
  op uuid;
  paid_op uuid;
  next_op uuid;
  original jsonb;
  replay jsonb;
  before_history jsonb;
  before_payments jsonb;
  sale public.sales%ROWTYPE;
  payment public.payments%ROWTYPE;
  f record;
  method text;
  role_name text;
  detail text;
  actor uuid;
  amount_value numeric;
  i integer;
  checks integer:=0;
BEGIN
  SELECT * INTO STRICT f FROM pg_proc WHERE oid='private.persist_checkout_payment(uuid,uuid,text)'::regprocedure;
  IF f.prosecdef OR f.provolatile<>'v' OR NOT f.proretset OR f.pronargs<>3 OR f.pronargdefaults<>0
     OR f.prorettype<>'public.payments'::regtype OR f.proowner<>'postgres'::regrole
     OR f.proargnames IS DISTINCT FROM ARRAY['p_business_id','p_operation_id','p_payment_method']::text[]
     OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR EXISTS(SELECT 1 FROM aclexplode(f.proacl) a WHERE a.grantee<>f.proowner OR a.is_grantable) THEN
    RAISE EXCEPTION 'BF184 unsafe private helper contract';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(role_name,f.oid,'EXECUTE') THEN RAISE EXCEPTION 'BF184 exposed to %',role_name; END IF;
  END LOOP;
  IF NOT (SELECT convalidated FROM pg_constraint WHERE conrelid='public.payments'::regclass AND conname='payments_payment_method_check')
     OR EXISTS(SELECT 1 FROM pg_proc WHERE proname='complete_checkout')
     OR (SELECT count(*) FROM pg_policies WHERE schemaname='public')<>41 THEN
    RAISE EXCEPTION 'BF184 unvalidated CHECK or public surface changed';
  END IF;
  checks:=checks+5;
  INSERT INTO auth.users(id) SELECT unnest(u);
  INSERT INTO public.businesses(id,name) VALUES(b[1],'BF184 A'),(b[2],'BF184 B');
  INSERT INTO public.business_members(id,business_id,user_id,role) VALUES(member,b[1],u[1],'OWNER');
  INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES
    (b[1],u[2],'BARBER',true),(b[1],u[3],'OWNER',false),(b[2],u[4],'OWNER',true),(b[1],u[6],'OWNER',true);
  INSERT INTO public.services(id,business_id,name,price,duration_minutes) VALUES(service,b[1],'Original service',0.29,30);
  INSERT INTO public.clients(id,business_id,first_name) VALUES(client,b[1],'BF184');
  INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,created_by)
    VALUES(appointment,b[1],client,member,'2026-01-01T10:00Z','2026-01-01T10:30Z',u[1]);
  INSERT INTO public.appointment_services(appointment_id,service_name_snapshot,unit_price_snapshot,duration_minutes_snapshot,line_total)
    VALUES(appointment,'Historical',9,30,9);
  SELECT jsonb_build_object('a',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.appointments t),
    's',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.appointment_services t)) INTO before_history;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[1],'role','authenticated')::text,true);
  FOREACH method IN ARRAY ARRAY['CASH','BANK_TRANSFER','DEBIT_CARD','CREDIT_CARD','DIGITAL_WALLET'] LOOP
    op:=gen_random_uuid();
    sale:=private.persist_checkout_sale(b[1],op,CASE WHEN method='CASH' THEN appointment ELSE NULL END,NULL,0.29,0,0.29);
    PERFORM private.persist_checkout_items(b[1],op,jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service,'quantity',1)));
    SELECT * INTO STRICT payment FROM private.persist_checkout_payment(b[1],op,method);
    IF payment.id IS NULL OR payment.sale_id<>sale.id OR payment.business_id<>b[1] OR payment.payment_method<>method
       OR payment.amount<>0.29 OR payment.created_by<>u[1] OR payment.notes IS NOT NULL
       OR payment.paid_at<>transaction_timestamp() OR payment.created_at<>transaction_timestamp()
       OR (SELECT count(*) FROM jsonb_object_keys(to_jsonb(payment)))<>9
       OR (SELECT count(*) FROM public.payments WHERE sale_id=sale.id)<>1 THEN
      RAISE EXCEPTION 'BF184 method/amount/server audit/exact projection mismatch';
    END IF;
    IF method='CASH' THEN paid_op:=op; original:=to_jsonb(payment); END IF;
    checks:=checks+1;
  END LOOP;
  UPDATE public.services SET name='Changed catalog',price=88,is_active=false WHERE id=service;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[6],'role','authenticated')::text,true);
  SELECT to_jsonb(t) INTO replay FROM private.persist_checkout_payment(b[1],paid_op,NULL) t;
  IF replay IS DISTINCT FROM original THEN RAISE EXCEPTION 'BF184 replay changed payment or required new payload/catalog'; END IF;
  UPDATE public.sales SET status='VOIDED' WHERE operation_id=paid_op;
  SELECT to_jsonb(t) INTO replay FROM private.persist_checkout_payment(b[1],paid_op,'INVALID') t;
  IF replay IS DISTINCT FROM original OR (SELECT status FROM public.sales WHERE operation_id=paid_op)<>'VOIDED' THEN
    RAISE EXCEPTION 'BF184 VOIDED replay changed payment/history';
  END IF;
  checks:=checks+2;
  FOREACH actor IN ARRAY ARRAY[u[2],u[3],u[4],u[5],NULL::uuid] LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    BEGIN PERFORM private.persist_checkout_payment(b[1],paid_op,'CASH'); RAISE EXCEPTION 'BF184 denied identity replay';
    EXCEPTION WHEN SQLSTATE '42501' THEN GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
      IF detail<>'CHECKOUT_ACCESS_DENIED' THEN RAISE EXCEPTION 'BF184 unsafe access error'; END IF; END;
    checks:=checks+1;
  END LOOP;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[1],'role','authenticated')::text,true);
  UPDATE public.services SET name='Original service',price=0.29,is_active=true WHERE id=service;
  op:=gen_random_uuid();sale:=private.persist_checkout_sale(b[1],op,NULL,NULL,0.29,0,0.29);
  PERFORM private.persist_checkout_items(b[1],op,jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service,'quantity',1)));
  FOREACH method IN ARRAY ARRAY['TRANSFER','DEBIT','CREDIT','OTHER','CARD','MERCADOPAGO','cash','',NULL::text] LOOP
    BEGIN PERFORM private.persist_checkout_payment(b[1],op,method); RAISE EXCEPTION 'BF184 invalid method accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
      IF detail<>'INVALID_CHECKOUT' THEN RAISE EXCEPTION 'BF184 unsafe input error'; END IF; END;
    IF EXISTS(SELECT 1 FROM public.payments WHERE sale_id=sale.id) THEN RAISE EXCEPTION 'BF184 invalid method persisted'; END IF;
    -- The table CHECK itself also rejects all non-NULL aliases, independent of helper validation.
    IF method IS NOT NULL THEN
      BEGIN INSERT INTO public.payments(business_id,sale_id,payment_method,amount,created_by) VALUES(b[1],sale.id,method,0.29,u[1]);
        RAISE EXCEPTION 'BF184 legacy CHECK still accepts alias';
      EXCEPTION WHEN check_violation THEN NULL; END;
    END IF;
    checks:=checks+1;
  END LOOP;
  -- No caller amount argument: payment amount is derived from exact persisted total.
  -- Inconsistent pre-existing payment history is rejected, never topped up/repaired.
  FOR i IN 1..4 LOOP
    next_op:=gen_random_uuid();sale:=private.persist_checkout_sale(b[1],next_op,NULL,NULL,0.29,0,0.29);
    PERFORM private.persist_checkout_items(b[1],next_op,jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service,'quantity',1)));
    amount_value:=CASE i WHEN 1 THEN 0.28 WHEN 2 THEN 0.30 WHEN 3 THEN 0.14 ELSE 0.29 END;
    INSERT INTO public.payments(business_id,sale_id,payment_method,amount,created_by)
      VALUES(b[CASE WHEN i=4 THEN 2 ELSE 1 END],sale.id,'CASH',amount_value,u[1]);
    IF i=3 THEN INSERT INTO public.payments(business_id,sale_id,payment_method,amount,created_by) VALUES(b[1],sale.id,'BANK_TRANSFER',0.15,u[1]); END IF;
    SELECT jsonb_agg(to_jsonb(t) ORDER BY id) INTO before_payments FROM public.payments t WHERE sale_id=sale.id;
    BEGIN PERFORM private.persist_checkout_payment(b[1],next_op,'CASH'); RAISE EXCEPTION 'BF184 accepted under/over/split/foreign payment';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
    IF before_payments IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.payments t WHERE sale_id=sale.id) THEN
      RAISE EXCEPTION 'BF184 rewrote inconsistent historical payments'; END IF;
    checks:=checks+1;
  END LOOP;
  -- Zero price and full discount both return an empty SET, never an amount-zero row.
  FOR i IN 1..2 LOOP
    next_op:=gen_random_uuid();amount_value:=CASE WHEN i=1 THEN 0 ELSE 0.29 END;
    sale:=private.persist_checkout_sale(b[1],next_op,NULL,NULL,amount_value,amount_value,0);
    PERFORM private.persist_checkout_items(b[1],next_op,jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service,'quantity',1,'unitPriceOverride',CASE WHEN i=1 THEN '0.00' ELSE '0.29' END)));
    IF EXISTS(SELECT 1 FROM private.persist_checkout_payment(b[1],next_op,'CASH'))
       OR EXISTS(SELECT 1 FROM private.persist_checkout_payment(b[1],next_op,'DIGITAL_WALLET'))
       OR EXISTS(SELECT 1 FROM public.payments WHERE sale_id=sale.id) THEN RAISE EXCEPTION 'BF184 zero total persisted payment'; END IF;
    checks:=checks+1;
  END LOOP;
  next_op:=gen_random_uuid();sale:=private.persist_checkout_sale(b[1],next_op,NULL,NULL,9999999999.99,0,9999999999.99);
  PERFORM private.persist_checkout_items(b[1],next_op,jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service,'quantity',1,'unitPriceOverride','9999999999.99')));
  SELECT * INTO STRICT payment FROM private.persist_checkout_payment(b[1],next_op,'CREDIT_CARD');
  IF payment.amount<>9999999999.99 THEN RAISE EXCEPTION 'BF184 maximum exact NUMERIC changed'; END IF;
  checks:=checks+1;
  FOREACH method IN ARRAY ARRAY['DRAFT','VOIDED','MISSING','FOREIGN','MISSING_ITEMS'] LOOP
    next_op:=gen_random_uuid();
    IF method IN ('DRAFT','VOIDED','FOREIGN') THEN
      INSERT INTO public.sales(business_id,operation_id,status,subtotal,total,created_by)
        VALUES(b[CASE WHEN method='FOREIGN' THEN 2 ELSE 1 END],next_op,CASE WHEN method='FOREIGN' THEN 'COMPLETED' ELSE method END,1,1,u[1]);
    ELSIF method='MISSING_ITEMS' THEN PERFORM private.persist_checkout_sale(b[1],next_op,NULL,NULL,1,0,1); END IF;
    BEGIN PERFORM private.persist_checkout_payment(b[1],next_op,'CASH'); RAISE EXCEPTION 'BF184 invalid parent accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
    checks:=checks+1;
  END LOOP;
  -- A later slice failure rolls back the full header/items/payment transaction.
  next_op:=gen_random_uuid();
  BEGIN
    sale:=private.persist_checkout_sale(b[1],next_op,NULL,NULL,0.29,0,0.29);
    PERFORM private.persist_checkout_items(b[1],next_op,jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service,'quantity',1)));
    PERFORM private.persist_checkout_payment(b[1],next_op,'CASH');
    RAISE EXCEPTION USING ERRCODE='Z0184',MESSAGE='synthetic later slice failure';
  EXCEPTION WHEN SQLSTATE 'Z0184' THEN NULL; END;
  IF EXISTS(SELECT 1 FROM public.sales WHERE operation_id=next_op)
     OR EXISTS(SELECT 1 FROM public.sale_items WHERE sale_id=sale.id)
     OR EXISTS(SELECT 1 FROM public.payments WHERE sale_id=sale.id) THEN RAISE EXCEPTION 'BF184 partial transaction'; END IF;
  IF before_history IS DISTINCT FROM jsonb_build_object('a',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.appointments t),
    's',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.appointment_services t))
     OR EXISTS(SELECT 1 FROM public.stock_movements) OR EXISTS(SELECT 1 FROM public.purchases)
     OR EXISTS(SELECT 1 FROM public.expenses) THEN RAISE EXCEPTION 'BF184 altered later effects/history'; END IF;
  checks:=checks+2;
  RAISE NOTICE 'BF184 PASS % payment/method/audit/authorization/replay/rollback assertion groups',checks;
END $$;
ROLLBACK;

BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',(SELECT user_id FROM public.business_members WHERE role='OWNER' AND is_active LIMIT 1),'role','authenticated')::text,true);
  BEGIN PERFORM private.persist_checkout_payment((SELECT business_id FROM public.business_members WHERE role='OWNER' AND is_active LIMIT 1),gen_random_uuid(),'CASH');
    RAISE EXCEPTION 'BF184 stale snapshot isolation accepted';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  RAISE NOTICE 'BF184 stale-isolation guard PASS';
END $$;
ROLLBACK;
