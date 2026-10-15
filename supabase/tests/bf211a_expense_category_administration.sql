\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  b uuid[]:=ARRAY[gen_random_uuid(),gen_random_uuid()];
  u uuid[]:=ARRAY(SELECT gen_random_uuid() FROM generate_series(1,4));
  category uuid[]:=ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  expense uuid:=gen_random_uuid();
  before_expense jsonb;
  actor uuid;
  checks integer:=0;
  role_name text;
BEGIN
  INSERT INTO auth.users(id) SELECT unnest(u);
  INSERT INTO public.businesses(id,name) VALUES(b[1],'BF211A A'),(b[2],'BF211A B');
  INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES
    (b[1],u[1],'OWNER',true),(b[1],u[2],'BARBER',true),(b[1],u[3],'OWNER',false),(b[2],u[4],'OWNER',true);
  INSERT INTO public.expense_categories(id,business_id,name) VALUES
    (category[1],b[1],'  Original  '),(category[2],b[1],'  Original  '),(category[3],b[2],'Foreign');
  INSERT INTO public.expenses(id,business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by)
  VALUES(expense,b[1],category[1],'MANUAL','Historical expense',1,'CASH','2026-01-01',u[1]);
  SELECT to_jsonb(e) INTO before_expense FROM public.expenses e WHERE id=expense;

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[1],'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF (SELECT count(*) FROM public.expense_categories WHERE business_id=b[1])<>2
     OR EXISTS(SELECT 1 FROM public.expense_categories WHERE business_id=b[2]) THEN
    RAISE EXCEPTION 'BF211A owner scope/duplicate name mismatch';
  END IF;
  INSERT INTO public.expense_categories(business_id,name) VALUES(b[1],'  Original  ');
  IF (SELECT count(*) FROM public.expense_categories WHERE business_id=b[1] AND is_active AND name='  Original  ')<>3 THEN
    RAISE EXCEPTION 'BF211A create default/original name/duplicates';
  END IF;
  UPDATE public.expense_categories SET name='  Updated  ' WHERE id=category[1];
  UPDATE public.expense_categories SET is_active=false WHERE id=category[1];
  IF (SELECT name FROM public.expense_categories WHERE id=category[1])<>'  Updated  '
     OR NOT EXISTS(SELECT 1 FROM public.expense_categories WHERE id=category[1] AND NOT is_active)
     OR before_expense IS DISTINCT FROM (SELECT to_jsonb(e) FROM public.expenses e WHERE id=expense) THEN
    RAISE EXCEPTION 'BF211A archived category lost readability or mutated expense history';
  END IF;
  UPDATE public.expense_categories SET is_active=true WHERE id=category[1];
  IF NOT EXISTS(SELECT 1 FROM public.expense_categories WHERE id=category[1] AND is_active) THEN
    RAISE EXCEPTION 'BF211A explicit reactivation failed';
  END IF;
  checks:=checks+5;
  BEGIN DELETE FROM public.expense_categories WHERE id=category[1]; RAISE EXCEPTION 'BF211A hard delete granted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.expense_categories SET business_id=b[2] WHERE id=category[1]; RAISE EXCEPTION 'BF211A tenant transfer granted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.expense_categories(business_id,name) VALUES(b[2],'Foreign'); RAISE EXCEPTION 'BF211A cross-business create';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE public.expense_categories SET name='Cannot update' WHERE id=category[3];
  IF FOUND THEN RAISE EXCEPTION 'BF211A cross-business update'; END IF;
  checks:=checks+4;
  EXECUTE 'RESET ROLE';
  FOREACH actor IN ARRAY ARRAY[u[2],u[3],u[4],gen_random_uuid()] LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    IF EXISTS(SELECT 1 FROM public.expense_categories WHERE business_id=b[1]) THEN
      RAISE EXCEPTION 'BF211A denied identity read categories';
    END IF;
    BEGIN INSERT INTO public.expense_categories(business_id,name) VALUES(b[1],'Denied'); RAISE EXCEPTION 'BF211A denied identity inserted';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    UPDATE public.expense_categories SET is_active=false WHERE id=category[1];
    IF FOUND THEN RAISE EXCEPTION 'BF211A denied identity updated'; END IF;
    EXECUTE 'RESET ROLE'; checks:=checks+3;
  END LOOP;
  PERFORM set_config('request.jwt.claims','{}',true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN PERFORM 1 FROM public.expense_categories; RAISE EXCEPTION 'BF211A anon read';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE'; checks:=checks+1;
  IF before_expense IS DISTINCT FROM (SELECT to_jsonb(e) FROM public.expenses e WHERE id=expense)
     OR NOT EXISTS(SELECT 1 FROM public.expense_categories WHERE id=category[1] AND is_active)
     OR (SELECT count(*) FROM public.expense_categories WHERE business_id=b[1])<>3 THEN
    RAISE EXCEPTION 'BF211A denied writes altered history/category rows';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_table_privilege(role_name,'public.expense_categories','DELETE') THEN
      RAISE EXCEPTION 'BF211A DELETE grant changed';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public')<>41 THEN RAISE EXCEPTION 'BF211A changed policies'; END IF;
  checks:=checks+3;
  RAISE NOTICE 'BF211A PASS % real role/archive/history assertion groups; no schema or policy changes',checks;
END $$;
ROLLBACK;
