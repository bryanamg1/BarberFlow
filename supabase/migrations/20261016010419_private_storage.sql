BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('avatars', 'avatars', false, 5242880, ARRAY['image/jpeg', 'image/png']),
  ('business-assets', 'business-assets', false, 5242880, ARRAY['image/jpeg', 'image/png']),
  ('receipts', 'receipts', false, 10485760, ARRAY['image/jpeg', 'image/png', 'application/pdf']);

-- Pure parsing, not an authorization bypass. CASE prevents invalid UUID casts
-- regardless of PostgreSQL's evaluation order for policy predicates.
CREATE FUNCTION private.storage_path_uuid(p_name text, p_part integer)
RETURNS uuid LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN pg_catalog.split_part(p_name, '/', p_part)
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN pg_catalog.split_part(p_name, '/', p_part)::uuid
    ELSE NULL
  END;
$$;
REVOKE ALL ON FUNCTION private.storage_path_uuid(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.storage_path_uuid(text, integer) TO authenticated;

CREATE POLICY bf234a_avatars_select ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'avatars'
  AND name ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png)$'
  AND private.storage_path_uuid(name, 1) = (SELECT auth.uid())
  AND private.storage_path_uuid(pg_catalog.split_part(name, '.', 1), 2) IS NOT NULL
);
CREATE POLICY bf234a_avatars_insert ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'avatars'
  AND name ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png)$'
  AND private.storage_path_uuid(name, 1) = (SELECT auth.uid())
  AND private.storage_path_uuid(pg_catalog.split_part(name, '.', 1), 2) IS NOT NULL
);
CREATE POLICY bf234a_avatars_delete_unreferenced ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id = 'avatars'
  AND name ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png)$'
  AND private.storage_path_uuid(name, 1) = (SELECT auth.uid())
  AND private.storage_path_uuid(pg_catalog.split_part(name, '.', 1), 2) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles profile
    WHERE profile.id = (SELECT auth.uid())
      AND profile.avatar_path = objects.bucket_id || '/' || objects.name
  )
);

CREATE POLICY bf234a_business_assets_select ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'business-assets'
  AND name ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png)$'
  AND private.storage_path_uuid(pg_catalog.split_part(name, '.', 1), 2) IS NOT NULL
  AND public.is_business_member(private.storage_path_uuid(name, 1))
);
CREATE POLICY bf234a_business_assets_insert ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'business-assets'
  AND name ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png)$'
  AND private.storage_path_uuid(pg_catalog.split_part(name, '.', 1), 2) IS NOT NULL
  AND public.has_business_role(private.storage_path_uuid(name, 1), ARRAY['OWNER'])
);
CREATE POLICY bf234a_business_assets_delete_unreferenced ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id = 'business-assets'
  AND name ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png)$'
  AND private.storage_path_uuid(pg_catalog.split_part(name, '.', 1), 2) IS NOT NULL
  AND public.has_business_role(private.storage_path_uuid(name, 1), ARRAY['OWNER'])
  AND NOT EXISTS (
    SELECT 1 FROM public.businesses business
    WHERE business.id = private.storage_path_uuid(objects.name, 1)
      AND business.logo_path = objects.bucket_id || '/' || objects.name
  )
);

CREATE POLICY bf234a_receipts_select ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'receipts'
  AND name ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|pdf)$'
  AND private.storage_path_uuid(pg_catalog.split_part(name, '.', 1), 3) IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.expenses expense
    WHERE expense.id = private.storage_path_uuid(objects.name, 2)
      AND expense.business_id = private.storage_path_uuid(objects.name, 1)
  )
);
CREATE POLICY bf234a_receipts_insert_manual ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'receipts'
  AND name ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|pdf)$'
  AND private.storage_path_uuid(pg_catalog.split_part(name, '.', 1), 3) IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.expenses expense
    WHERE expense.id = private.storage_path_uuid(objects.name, 2)
      AND expense.business_id = private.storage_path_uuid(objects.name, 1)
      AND expense.source_type = 'MANUAL' AND expense.purchase_id IS NULL
  )
);

-- No UPDATE policy: upsert/overwrite/move is not a V1 capability.
-- No receipt DELETE policy, even for an unreferenced object: historical
-- retention cannot be inferred from the current receipt_path alone.
-- Existing public-table policies/grants and security-definer helpers are intact.
COMMIT;
