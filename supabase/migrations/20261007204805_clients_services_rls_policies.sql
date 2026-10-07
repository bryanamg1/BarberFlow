BEGIN;

-- BF-074: clients are operational for both literal roles; only OWNER administers
-- the services catalog. Archived records stay visible to active members.
CREATE POLICY clients_select_members ON public.clients
  FOR SELECT TO authenticated USING (public.is_business_member(business_id));
CREATE POLICY clients_insert_members ON public.clients
  FOR INSERT TO authenticated WITH CHECK (public.is_business_member(business_id));
CREATE POLICY clients_update_members ON public.clients
  FOR UPDATE TO authenticated
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

CREATE POLICY services_select_members ON public.services
  FOR SELECT TO authenticated USING (public.is_business_member(business_id));
CREATE POLICY services_insert_owners ON public.services
  FOR INSERT TO authenticated WITH CHECK (public.has_business_role(business_id, ARRAY['OWNER']));
CREATE POLICY services_update_owners ON public.services
  FOR UPDATE TO authenticated
  USING (public.has_business_role(business_id, ARRAY['OWNER']))
  WITH CHECK (public.has_business_role(business_id, ARRAY['OWNER']));

-- Both old/new tenant predicates can pass for a caller belonging to A and B.
-- Follow BF-073: exclude only business_id from authenticated UPDATE privileges.
-- No DELETE policy, new helper/trigger or global grant hardening.
REVOKE UPDATE ON public.clients, public.services FROM authenticated;
GRANT UPDATE (id, first_name, last_name, phone, email, instagram, birth_date,
              notes, preferences, is_active, created_at, updated_at)
  ON public.clients TO authenticated;
GRANT UPDATE (id, name, description, price, duration_minutes, is_active, created_at, updated_at)
  ON public.services TO authenticated;

COMMIT;
