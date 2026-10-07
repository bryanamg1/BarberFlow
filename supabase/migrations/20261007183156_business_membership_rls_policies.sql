BEGIN;

-- BF-073: personal profiles plus business/membership configuration only.
CREATE POLICY profiles_select_self ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY profiles_insert_self ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Business/first OWNER bootstrap and physical deletion remain server-side work.
CREATE POLICY businesses_select_members ON public.businesses
  FOR SELECT TO authenticated USING (public.is_business_member(id));
CREATE POLICY businesses_update_owners ON public.businesses
  FOR UPDATE TO authenticated
  USING (public.has_business_role(id, ARRAY['OWNER']))
  WITH CHECK (public.has_business_role(id, ARRAY['OWNER']));

-- The approved definer reads membership without recursively invoking this policy.
CREATE POLICY business_members_select_members ON public.business_members
  FOR SELECT TO authenticated USING (public.is_business_member(business_id));
CREATE POLICY business_members_insert_owners ON public.business_members
  FOR INSERT TO authenticated WITH CHECK (public.has_business_role(business_id, ARRAY['OWNER']));
CREATE POLICY business_members_update_owners ON public.business_members
  FOR UPDATE TO authenticated
  USING (public.has_business_role(business_id, ARRAY['OWNER']))
  WITH CHECK (public.has_business_role(business_id, ARRAY['OWNER']));

CREATE POLICY business_settings_select_members ON public.business_settings
  FOR SELECT TO authenticated USING (public.is_business_member(business_id));
CREATE POLICY business_settings_insert_owners ON public.business_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_business_role(business_id, ARRAY['OWNER']));
CREATE POLICY business_settings_update_owners ON public.business_settings
  FOR UPDATE TO authenticated
  USING (public.has_business_role(business_id, ARRAY['OWNER']))
  WITH CHECK (public.has_business_role(business_id, ARRAY['OWNER']));

CREATE POLICY business_hours_select_members ON public.business_hours
  FOR SELECT TO authenticated USING (public.is_business_member(business_id));
CREATE POLICY business_hours_insert_owners ON public.business_hours
  FOR INSERT TO authenticated WITH CHECK (public.has_business_role(business_id, ARRAY['OWNER']));
CREATE POLICY business_hours_update_owners ON public.business_hours
  FOR UPDATE TO authenticated
  USING (public.has_business_role(business_id, ARRAY['OWNER']))
  WITH CHECK (public.has_business_role(business_id, ARRAY['OWNER']));
CREATE POLICY business_hours_delete_owners ON public.business_hours
  FOR DELETE TO authenticated USING (public.has_business_role(business_id, ARRAY['OWNER']));

-- USING/WITH CHECK validate each tenant independently. A user owning BOTH
-- tenants must still be unable to reparent an existing row. Narrow only the
-- authenticated UPDATE grants on these three tables: exclude business_id.
-- All other existing columns remain updatable subject to the OWNER policies.
-- No new function/trigger, service_role change or global grant hardening.
REVOKE UPDATE ON public.business_members, public.business_settings, public.business_hours FROM authenticated;
GRANT UPDATE (id, user_id, role, is_active, created_at, updated_at)
  ON public.business_members TO authenticated;
GRANT UPDATE (appointment_interval_minutes, default_service_buffer_minutes,
              allow_overlapping_appointments, low_stock_notifications, created_at, updated_at)
  ON public.business_settings TO authenticated;
GRANT UPDATE (id, day_of_week, open_time, close_time, is_closed, created_at, updated_at)
  ON public.business_hours TO authenticated;

COMMIT;
