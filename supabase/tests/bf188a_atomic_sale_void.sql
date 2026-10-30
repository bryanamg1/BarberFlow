\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE f record; r text; cols text[];
BEGIN
  SELECT array_agg(column_name::text ORDER BY ordinal_position) INTO cols FROM information_schema.columns
    WHERE table_schema='private' AND table_name='sale_voids';
  IF cols IS DISTINCT FROM ARRAY['id','business_id','sale_id','operation_id','reason','created_by','created_at']
    OR NOT (SELECT relrowsecurity AND NOT relforcerowsecurity FROM pg_class WHERE oid='private.sale_voids'::regclass)
    OR EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='private' AND tablename='sale_voids')
    OR (SELECT count(*) FROM pg_constraint WHERE conrelid='private.sale_voids'::regclass AND contype='u')<>2
    OR (SELECT count(*) FROM pg_constraint WHERE conrelid='private.sale_voids'::regclass AND contype='p')<>1
    OR (SELECT count(*) FROM pg_constraint WHERE conrelid='private.sale_voids'::regclass AND contype='f' AND confdeltype='r')<>3 THEN
    RAISE EXCEPTION 'BF188A audit contract';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_table_privilege(r,'private.sale_voids','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_function_privilege(r,'private.read_sale_void_history(uuid,uuid)','EXECUTE')
      OR has_function_privilege(r,'private.prevent_sale_void_changes()','EXECUTE') THEN
      RAISE EXCEPTION 'BF188A private boundary';
    END IF;
  END LOOP;
  FOR f IN SELECT * FROM pg_proc WHERE oid IN ('public.void_sale(uuid,uuid,uuid,text)'::regprocedure,
    'public.get_sale_correction_detail(uuid,uuid)'::regprocedure) LOOP
    IF NOT f.prosecdef OR f.proretset OR f.prorettype<>'jsonb'::regtype OR f.pronargdefaults<>0
      OR f.proowner<>'postgres'::regrole OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
      OR NOT has_function_privilege('authenticated',f.oid,'EXECUTE')
      OR EXISTS(SELECT 1 FROM aclexplode(f.proacl) WHERE grantee NOT IN(f.proowner,'authenticated'::regrole) OR is_grantable)
      OR (f.proname='void_sale' AND (f.provolatile<>'v' OR f.proargnames IS DISTINCT FROM
        ARRAY['p_business_id','p_operation_id','p_sale_id','p_reason']::text[]))
      OR (f.proname='get_sale_correction_detail' AND (f.provolatile<>'s' OR f.proargnames IS DISTINCT FROM
        ARRAY['p_business_id','p_sale_id']::text[])) THEN RAISE EXCEPTION 'BF188A RPC contract'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public')<>41
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND (NOT c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'BF188A changed existing RLS';
  END IF;
END $$;
ROLLBACK;
\echo 'PASS BF188A audit7, uniqueness/FK, private grants/RLS and exact authenticated-only public RPC contracts'
