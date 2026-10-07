BEGIN;

-- OWNER sees the business agenda; BARBER sees only their active assigned membership.
-- BF-073 membership reads use BF-072's definer, so these lookups do not recurse.
CREATE POLICY appointments_select_authorized ON public.appointments
  FOR SELECT TO authenticated USING (public.has_business_role(appointments.business_id, ARRAY['OWNER']) OR EXISTS (
    SELECT 1 FROM public.business_members AS assigned
    WHERE assigned.id = appointments.barber_member_id
      AND assigned.business_id = appointments.business_id
      AND assigned.user_id = auth.uid()
      AND assigned.is_active = true
      AND assigned.role = 'BARBER'
  ));

CREATE POLICY appointments_insert_authorized ON public.appointments
  FOR INSERT TO authenticated WITH CHECK (
    appointments.created_by = auth.uid()
    AND (public.has_business_role(appointments.business_id, ARRAY['OWNER']) OR EXISTS (
    SELECT 1 FROM public.business_members AS assigned
    WHERE assigned.id = appointments.barber_member_id
      AND assigned.business_id = appointments.business_id
      AND assigned.user_id = auth.uid()
      AND assigned.is_active = true
      AND assigned.role = 'BARBER'
  ))
    AND EXISTS (
    SELECT 1 FROM public.clients AS client
    WHERE client.id = appointments.client_id
      AND client.business_id = appointments.business_id
  )
  AND EXISTS (
    SELECT 1 FROM public.business_members AS member
    WHERE member.id = appointments.barber_member_id
      AND member.business_id = appointments.business_id
  )
  );

-- The target membership must share the tenant, but need not remain active for
-- OWNER to manage history. Only the caller's authorization requires activity.
CREATE POLICY appointments_update_authorized ON public.appointments
  FOR UPDATE TO authenticated
  USING (public.has_business_role(appointments.business_id, ARRAY['OWNER']) OR EXISTS (
    SELECT 1 FROM public.business_members AS assigned
    WHERE assigned.id = appointments.barber_member_id
      AND assigned.business_id = appointments.business_id
      AND assigned.user_id = auth.uid()
      AND assigned.is_active = true
      AND assigned.role = 'BARBER'
  ))
  WITH CHECK (
    (public.has_business_role(appointments.business_id, ARRAY['OWNER']) OR EXISTS (
    SELECT 1 FROM public.business_members AS assigned
    WHERE assigned.id = appointments.barber_member_id
      AND assigned.business_id = appointments.business_id
      AND assigned.user_id = auth.uid()
      AND assigned.is_active = true
      AND assigned.role = 'BARBER'
  ))
    AND EXISTS (
    SELECT 1 FROM public.clients AS client
    WHERE client.id = appointments.client_id
      AND client.business_id = appointments.business_id
  )
  AND EXISTS (
    SELECT 1 FROM public.business_members AS member
    WHERE member.id = appointments.barber_member_id
      AND member.business_id = appointments.business_id
  )
  );

-- Child reads inherit parent visibility. Writes independently require OWNER or
-- the assigned active BARBER, even if parent SELECT is broadened in a later ticket.
CREATE POLICY appointment_services_select_authorized ON public.appointment_services
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.appointments AS parent
      WHERE parent.id = appointment_services.appointment_id
    )
  );

CREATE POLICY appointment_services_insert_authorized ON public.appointment_services
  FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.appointments AS parent
    WHERE parent.id = appointment_services.appointment_id
      AND (public.has_business_role(parent.business_id, ARRAY['OWNER'])
      OR EXISTS (
        SELECT 1 FROM public.business_members AS assigned
        WHERE assigned.id = parent.barber_member_id
          AND assigned.business_id = parent.business_id
          AND assigned.user_id = auth.uid()
          AND assigned.is_active = true
          AND assigned.role = 'BARBER'
      ))
      AND (
        appointment_services.service_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.services AS service
          WHERE service.id = appointment_services.service_id
            AND service.business_id = parent.business_id
        )
      )
  ));

CREATE POLICY appointment_services_update_authorized ON public.appointment_services
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.appointments AS parent
    WHERE parent.id = appointment_services.appointment_id
      AND (public.has_business_role(parent.business_id, ARRAY['OWNER'])
      OR EXISTS (
        SELECT 1 FROM public.business_members AS assigned
        WHERE assigned.id = parent.barber_member_id
          AND assigned.business_id = parent.business_id
          AND assigned.user_id = auth.uid()
          AND assigned.is_active = true
          AND assigned.role = 'BARBER'
      ))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.appointments AS parent
    WHERE parent.id = appointment_services.appointment_id
      AND (public.has_business_role(parent.business_id, ARRAY['OWNER'])
      OR EXISTS (
        SELECT 1 FROM public.business_members AS assigned
        WHERE assigned.id = parent.barber_member_id
          AND assigned.business_id = parent.business_id
          AND assigned.user_id = auth.uid()
          AND assigned.is_active = true
          AND assigned.role = 'BARBER'
      ))
      AND (
        appointment_services.service_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.services AS service
          WHERE service.id = appointment_services.service_id
            AND service.business_id = parent.business_id
        )
      )
  ));

CREATE POLICY appointment_services_delete_authorized ON public.appointment_services
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.appointments AS parent
    WHERE parent.id = appointment_services.appointment_id
      AND (public.has_business_role(parent.business_id, ARRAY['OWNER'])
      OR EXISTS (
        SELECT 1 FROM public.business_members AS assigned
        WHERE assigned.id = parent.barber_member_id
          AND assigned.business_id = parent.business_id
          AND assigned.user_id = auth.uid()
          AND assigned.is_active = true
          AND assigned.role = 'BARBER'
      ))
  ));

-- Exclude only the approved immutable columns, preserving every other UPDATE.
-- A table-level UPDATE grant would override a simple column REVOKE.
REVOKE UPDATE ON public.appointments, public.appointment_services FROM authenticated;
GRANT UPDATE (id, client_id, barber_member_id, start_at, end_at, status, notes, created_at, updated_at)
  ON public.appointments TO authenticated;
GRANT UPDATE (id, service_id, service_name_snapshot, unit_price_snapshot,
              duration_minutes_snapshot, quantity, line_total, created_at)
  ON public.appointment_services TO authenticated;

-- No appointment DELETE policy, new helper/trigger, status machine or global hardening.
COMMIT;
