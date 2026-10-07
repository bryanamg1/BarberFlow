-- Keep creation and EXECUTE restrictions atomic, including Supabase default ACLs.
BEGIN;

-- The migration role owns business_members and bypasses its RLS. A minimal
-- definer query avoids re-entering future membership policies. Identity always
-- comes from auth.uid(); callers cannot inspect another user's membership.
CREATE FUNCTION public.is_business_member(target_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members AS member
    WHERE member.business_id = target_business_id
      AND member.user_id = (SELECT auth.uid())
      AND member.is_active = true
  );
$$;

-- Literal set membership: OWNER does not imply BARBER (or vice versa).
-- EXISTS returns false for missing identity/business, NULL/empty allowed roles,
-- or an inactive membership. Business activity is not part of this contract.
CREATE FUNCTION public.has_business_role(target_business_id uuid, allowed_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members AS member
    WHERE member.business_id = target_business_id
      AND member.user_id = (SELECT auth.uid())
      AND member.is_active = true
      AND member.role = ANY (allowed_roles)
  );
$$;

-- Default function grants explicitly include anon as well as PUBLIC locally.
-- Leave service_role's existing default EXECUTE intact; add no special grant.
REVOKE ALL ON FUNCTION public.is_business_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_business_role(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_business_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_business_role(uuid, text[]) TO authenticated;

COMMIT;
