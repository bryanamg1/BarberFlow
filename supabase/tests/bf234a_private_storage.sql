\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = '';
-- Mirror Storage API's transaction flag; this suite touches metadata fixtures
-- only. Real blob deletion is exercised separately through the local API.
SET LOCAL storage.allow_delete_query = 'true';

-- Each case runs as the actual caller and rolls back its own mutation.
CREATE FUNCTION pg_temp.storage_case(statement text, expected integer, caller uuid, caller_role text DEFAULT 'authenticated', is_select boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual integer;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', coalesce(caller::text, ''), true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', caller, 'role', caller_role)::text, true);
    PERFORM set_config('role', caller_role, true);
    BEGIN
      IF is_select THEN EXECUTE statement INTO actual;
      ELSE EXECUTE statement; GET DIAGNOSTICS actual = ROW_COUNT;
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN actual := 0;
    END;
    IF actual IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'Storage case expected %, got %: %', expected, actual, statement;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'Z234A';
  EXCEPTION WHEN SQLSTATE 'Z234A' THEN NULL;
  END;
END;
$$;

DO $$
DECLARE
  owner_a uuid := gen_random_uuid(); owner_b uuid := gen_random_uuid();
  barber uuid := gen_random_uuid(); inactive uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  business_a uuid := gen_random_uuid(); business_b uuid := gen_random_uuid();
  category_a uuid := gen_random_uuid(); category_b uuid := gen_random_uuid();
  expense_a uuid := gen_random_uuid(); expense_b uuid := gen_random_uuid(); bad_expense uuid := gen_random_uuid();
  purchase uuid := gen_random_uuid(); purchase_expense uuid := gen_random_uuid();
  file_id uuid := gen_random_uuid(); new_id uuid := gen_random_uuid();
  avatar text; logo text; receipt text; purchase_receipt text;
  bucket text; object_name text; actor uuid; actual record;
BEGIN
  FOR actual IN SELECT * FROM (VALUES
    ('avatars', 5242880::bigint, ARRAY['image/jpeg','image/png']),
    ('business-assets', 5242880::bigint, ARRAY['image/jpeg','image/png']),
    ('receipts', 10485760::bigint, ARRAY['image/jpeg','image/png','application/pdf'])
  ) x(id, size, mime) LOOP
    IF NOT EXISTS(SELECT 1 FROM storage.buckets b WHERE b.id=actual.id AND b.name=actual.id
      AND NOT b.public AND b.file_size_limit=actual.size AND b.allowed_mime_types=actual.mime) THEN
      RAISE EXCEPTION 'Incorrect bucket contract: %', actual.id;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects') <> 8
     OR EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
       AND (roles <> ARRAY['authenticated']::name[] OR cmd IN ('UPDATE','ALL'))) THEN
    RAISE EXCEPTION 'Expected eight authenticated-only policies, without overwrite';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc WHERE oid='private.storage_path_uuid(text,integer)'::regprocedure
      AND (prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=""']))
     OR has_function_privilege('anon','private.storage_path_uuid(text,integer)','EXECUTE')
     OR NOT has_function_privilege('authenticated','private.storage_path_uuid(text,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'Unsafe path parser privileges';
  END IF;
  IF private.storage_path_uuid('------------------------------------/x',1) IS NOT NULL THEN
    RAISE EXCEPTION 'Malformed UUID must not raise or authorize';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public') <> 41
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity) <> 19
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname IN ('public','private') AND p.prosecdef) <> 7 THEN
    RAISE EXCEPTION 'Public security baseline changed';
  END IF;

  INSERT INTO auth.users(id) VALUES(owner_a),(owner_b),(barber),(inactive),(outsider);
  INSERT INTO public.profiles(id,first_name,last_name) VALUES(owner_a,'Storage','Fixture'),(owner_b,'Storage','Fixture'),(outsider,'Storage','Fixture');
  INSERT INTO public.businesses(id,name) VALUES(business_a,'Storage A'),(business_b,'Storage B');
  INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES
    (business_a,owner_a,'OWNER',true),(business_b,owner_b,'OWNER',true),
    (business_a,barber,'BARBER',true),(business_a,inactive,'OWNER',false);
  INSERT INTO public.expense_categories(id,business_id,name) VALUES(category_a,business_a,'A'),(category_b,business_b,'B');
  INSERT INTO public.purchases(id,business_id,operation_id,supplier,total,created_by)
    VALUES(purchase,business_a,gen_random_uuid(),'Fixture',10,owner_a);
  INSERT INTO public.expenses(id,business_id,category_id,source_type,purchase_id,description,amount,payment_method,expense_date,created_by) VALUES
    (expense_a,business_a,category_a,'MANUAL',NULL,'A',0,'CASH',DATE '2026-01-01',owner_a),
    (expense_b,business_b,category_b,'MANUAL',NULL,'B',0,'CASH',DATE '2026-01-01',owner_b),
    (bad_expense,business_a,category_b,'MANUAL',NULL,'Inconsistent',0,'CASH',DATE '2026-01-01',owner_a),
    (purchase_expense,business_a,category_a,'PURCHASE',purchase,'Purchase',10,'CASH',DATE '2026-01-01',owner_a);
  avatar := owner_a || '/' || file_id || '.png';
  logo := business_a || '/' || file_id || '.jpg';
  receipt := business_a || '/' || expense_a || '/' || file_id || '.pdf';
  purchase_receipt := business_a || '/' || purchase_expense || '/' || file_id || '.png';
  INSERT INTO storage.objects(bucket_id,name) VALUES('avatars',avatar),('business-assets',logo),('receipts',receipt),('receipts',purchase_receipt);

  FOREACH actor IN ARRAY ARRAY[owner_a,owner_b,barber,inactive,outsider] LOOP
    PERFORM pg_temp.storage_case(format('SELECT count(*) FROM storage.objects WHERE bucket_id=%L AND name=%L','avatars',avatar),
      CASE WHEN actor=owner_a THEN 1 ELSE 0 END, actor, 'authenticated',true);
    PERFORM pg_temp.storage_case(format('SELECT count(*) FROM storage.objects WHERE bucket_id=%L AND name=%L','business-assets',logo),
      CASE WHEN actor IN (owner_a,barber) THEN 1 ELSE 0 END, actor,'authenticated',true);
    PERFORM pg_temp.storage_case(format('SELECT count(*) FROM storage.objects WHERE bucket_id=%L AND name=%L','receipts',receipt),
      CASE WHEN actor=owner_a THEN 1 ELSE 0 END,actor,'authenticated',true);
    PERFORM pg_temp.storage_case(format('INSERT INTO storage.objects(bucket_id,name) VALUES(%L,%L)','business-assets',business_a||'/'||new_id||'.png'),
      CASE WHEN actor=owner_a THEN 1 ELSE 0 END,actor);
    PERFORM pg_temp.storage_case(format('INSERT INTO storage.objects(bucket_id,name) VALUES(%L,%L)','receipts',business_a||'/'||expense_a||'/'||new_id||'.pdf'),
      CASE WHEN actor=owner_a THEN 1 ELSE 0 END,actor);
    PERFORM pg_temp.storage_case(format('DELETE FROM storage.objects WHERE bucket_id=%L AND name=%L','business-assets',logo),
      CASE WHEN actor=owner_a THEN 1 ELSE 0 END,actor);
  END LOOP;
  -- Avatars do not require business membership.
  PERFORM pg_temp.storage_case(format('INSERT INTO storage.objects(bucket_id,name) VALUES(%L,%L)','avatars',outsider||'/'||new_id||'.png'),1,outsider);
  PERFORM pg_temp.storage_case(format('INSERT INTO storage.objects(bucket_id,name) VALUES(%L,%L)','avatars',owner_b||'/'||new_id||'.png'),0,owner_a);
  PERFORM pg_temp.storage_case(format('SELECT count(*) FROM storage.objects WHERE name=%L',purchase_receipt),1,owner_a,'authenticated',true);
  FOREACH object_name IN ARRAY ARRAY[
    business_a||'/'||purchase_expense||'/'||new_id||'.png',
    business_b||'/'||expense_b||'/'||new_id||'.pdf',
    business_a||'/'||expense_b||'/'||new_id||'.pdf',
    business_a||'/'||bad_expense||'/'||new_id||'.pdf',
    business_a||'/'||gen_random_uuid()||'/'||new_id||'.pdf'
  ] LOOP
    PERFORM pg_temp.storage_case(format('INSERT INTO storage.objects(bucket_id,name) VALUES(%L,%L)','receipts',object_name),0,owner_a);
  END LOOP;
  FOREACH object_name IN ARRAY ARRAY['../'||new_id||'.png',business_a||'/bad.png',
    '------------------------------------/'||new_id||'.png',business_a||'/'||new_id||'.svg',business_a||'/'||new_id||'.pdf',business_a||'/extra/'||new_id||'.png'] LOOP
    PERFORM pg_temp.storage_case(format('INSERT INTO storage.objects(bucket_id,name) VALUES(%L,%L)','business-assets',object_name),0,owner_a);
  END LOOP;
  FOREACH bucket IN ARRAY ARRAY['avatars','business-assets','receipts'] LOOP
    object_name := CASE bucket WHEN 'avatars' THEN avatar WHEN 'business-assets' THEN logo ELSE receipt END;
    PERFORM pg_temp.storage_case(format('SELECT count(*) FROM storage.objects WHERE bucket_id=%L AND name=%L',bucket,object_name),0,NULL,'anon',true);
    PERFORM pg_temp.storage_case(format('INSERT INTO storage.objects(bucket_id,name) VALUES(%L,%L)',bucket,replace(object_name,file_id::text,new_id::text)),0,NULL,'anon');
    PERFORM pg_temp.storage_case(format('UPDATE storage.objects SET metadata=''{}'' WHERE bucket_id=%L AND name=%L',bucket,object_name),0,owner_a);
  END LOOP;
  PERFORM pg_temp.storage_case(format('DELETE FROM storage.objects WHERE name=%L',avatar),1,owner_a);
  UPDATE public.profiles SET avatar_path='avatars/'||avatar WHERE id=owner_a;
  UPDATE public.businesses SET logo_path='business-assets/'||logo WHERE id=business_a;
  PERFORM pg_temp.storage_case(format('DELETE FROM storage.objects WHERE name=%L',avatar),0,owner_a);
  PERFORM pg_temp.storage_case(format('DELETE FROM storage.objects WHERE name=%L',logo),0,owner_a);
  PERFORM pg_temp.storage_case(format('DELETE FROM storage.objects WHERE name IN (%L,%L)',receipt,purchase_receipt),0,owner_a);
  UPDATE public.expenses SET receipt_path='receipts/'||receipt WHERE id=expense_a;
  PERFORM pg_temp.storage_case(format('DELETE FROM storage.objects WHERE name=%L',receipt),0,owner_a);
  UPDATE public.business_members SET is_active=false WHERE business_id=business_a AND user_id=owner_a;
  PERFORM pg_temp.storage_case(format('SELECT count(*) FROM storage.objects WHERE name IN (%L,%L)',logo,receipt),0,owner_a,'authenticated',true);
  PERFORM pg_temp.storage_case(format('SELECT count(*) FROM storage.objects WHERE name=%L',avatar),1,owner_a,'authenticated',true);
  RAISE NOTICE 'BF234A bucket contract, role/tenant isolation, malformed paths, manual/purchase receipts, retention, inactivity and overwrite tests passed';
END;
$$;
ROLLBACK;
