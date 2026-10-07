\set ON_ERROR_STOP on
BEGIN;

-- Administrative local fixtures only, including FK identities; everything rolls back.
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_business_id uuid;
  v_client_id uuid;
  v_member_id uuid;
  v_default_appointment public.appointments%ROWTYPE;
  v_full_appointment public.appointments%ROWTYPE;
  v_updated_appointment public.appointments%ROWTYPE;
  v_status text;
  v_role text;
  v_count bigint;
  v_affected bigint;
  v_state text;
  v_constraint text;
  v_column text;
  v_case record;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'appointments') <> 11 THEN
    RAISE EXCEPTION 'Unexpected appointments columns';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('id', 'uuid', 'NO'),
      ('business_id', 'uuid', 'NO'),
      ('client_id', 'uuid', 'NO'),
      ('barber_member_id', 'uuid', 'NO'),
      ('start_at', 'timestamptz', 'NO'),
      ('end_at', 'timestamptz', 'NO'),
      ('status', 'text', 'NO'),
      ('notes', 'text', 'YES'),
      ('created_by', 'uuid', 'NO'),
      ('created_at', 'timestamptz', 'NO'),
      ('updated_at', 'timestamptz', 'NO')
    ) AS columns(column_name, udt_name, is_nullable)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = 'appointments'
        AND c.column_name = v_case.column_name AND c.udt_name = v_case.udt_name
        AND c.is_nullable = v_case.is_nullable
    ) THEN
      RAISE EXCEPTION 'Type/nullability mismatch for %', v_case.column_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'appointments'
               AND column_name = 'created_by' AND column_default IS NOT NULL) THEN
    RAISE EXCEPTION 'created_by must be supplied explicitly';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.appointments'::regclass
                 AND conname = 'appointments_pkey' AND contype = 'p') THEN
    RAISE EXCEPTION 'Appointments PK missing';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('appointments_business_id_fkey', 'public.businesses'),
      ('appointments_client_id_fkey', 'public.clients'),
      ('appointments_barber_member_id_fkey', 'public.business_members'),
      ('appointments_created_by_fkey', 'auth.users')
    ) AS foreign_keys(constraint_name, target_table)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.appointments'::regclass
                   AND conname = v_case.constraint_name AND contype = 'f'
                   AND confrelid = v_case.target_table::regclass AND confdeltype = 'r') THEN
      RAISE EXCEPTION 'Restrictive FK missing: %', v_case.constraint_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.appointments'::regclass
              AND contype IN ('u', 'x')) THEN
    RAISE EXCEPTION 'No uniqueness or overlap exclusion constraint is approved';
  END IF;
  -- BF-070 audits the full index inventory; retain the BF-058 required indexes here.
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'appointments') < 4 THEN
    RAISE EXCEPTION 'Required PK and three agenda/history indexes missing';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('appointments_business_id_start_at_idx', '% USING btree (business_id, start_at)'),
      ('appointments_business_id_barber_member_id_start_at_idx', '% USING btree (business_id, barber_member_id, start_at)'),
      ('appointments_business_id_client_id_start_at_idx', '% USING btree (business_id, client_id, start_at)')
    ) AS indexes(index_name, definition)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'appointments'
                   AND indexname = v_case.index_name AND indexdef LIKE v_case.definition) THEN
      RAISE EXCEPTION 'Agenda/history index missing: %', v_case.index_name;
    END IF;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.appointments'::regclass)
     OR (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'appointments') IS DISTINCT FROM
        ARRAY['appointments_insert_authorized', 'appointments_select_authorized', 'appointments_update_authorized']::text[] THEN
    RAISE EXCEPTION 'Appointments must have RLS and exactly the three BF-075 policies';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.appointments'::regclass AND NOT tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.appointments'::regclass
                    AND tgname = 'appointments_set_updated_at'
                    AND tgfoid = 'public.set_updated_at()'::regprocedure AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Only the existing updated_at utility is allowed';
  END IF;

  INSERT INTO auth.users (id) VALUES (v_user_id);
  INSERT INTO public.businesses (name) VALUES ('Temporary appointments test') RETURNING id INTO v_business_id;
  INSERT INTO public.clients (business_id, first_name) VALUES (v_business_id, 'Temporary') RETURNING id INTO v_client_id;
  INSERT INTO public.business_members (business_id, user_id, role)
  VALUES (v_business_id, v_user_id, 'BARBER') RETURNING id INTO v_member_id;
  INSERT INTO public.appointments (business_id, client_id, barber_member_id, start_at, end_at, created_by)
  VALUES (v_business_id, v_client_id, v_member_id, '2030-01-07T09:00:00-03:00',
          '2030-01-07T09:30:00-03:00', v_user_id) RETURNING * INTO v_default_appointment;
  IF v_default_appointment.id IS NULL OR v_default_appointment.status IS DISTINCT FROM 'PENDING'
     OR v_default_appointment.notes IS NOT NULL
     OR v_default_appointment.created_at IS DISTINCT FROM transaction_timestamp()
     OR v_default_appointment.updated_at IS DISTINCT FROM transaction_timestamp()
     OR v_default_appointment.start_at IS DISTINCT FROM '2030-01-07T12:00:00Z'::timestamptz
     OR v_default_appointment.end_at IS DISTINCT FROM '2030-01-07T12:30:00Z'::timestamptz THEN
    RAISE EXCEPTION 'Appointment defaults or timezone instants failed';
  END IF;

  FOR v_case IN
    SELECT * FROM (VALUES
      ('business_id', 'gen_random_uuid()', '23503', 'appointments_business_id_fkey', NULL),
      ('client_id', 'gen_random_uuid()', '23503', 'appointments_client_id_fkey', NULL),
      ('barber_member_id', 'gen_random_uuid()', '23503', 'appointments_barber_member_id_fkey', NULL),
      ('created_by', 'gen_random_uuid()', '23503', 'appointments_created_by_fkey', NULL),
      ('business_id', 'NULL', '23502', NULL, 'business_id'),
      ('client_id', 'NULL', '23502', NULL, 'client_id'),
      ('barber_member_id', 'NULL', '23502', NULL, 'barber_member_id'),
      ('created_by', 'NULL', '23502', NULL, 'created_by'),
      ('start_at', 'NULL', '23502', NULL, 'start_at'),
      ('end_at', 'NULL', '23502', NULL, 'end_at'),
      ('status', 'NULL', '23502', NULL, 'status'),
      ('end_at', 'start_at', '23514', 'appointments_time_check', NULL),
      ('end_at', 'start_at - interval ''1 minute''', '23514', 'appointments_time_check', NULL),
      ('status', '''INVALID''', '23514', 'appointments_status_check', NULL),
      ('status', '''DELETED''', '23514', 'appointments_status_check', NULL),
      ('status', '''ARCHIVED''', '23514', 'appointments_status_check', NULL),
      ('status', '''RESCHEDULED''', '23514', 'appointments_status_check', NULL),
      ('status', '''pending''', '23514', 'appointments_status_check', NULL)
    ) AS cases(column_name, expression, expected_state, expected_constraint, expected_column)
  LOOP
    BEGIN
      -- INSERT exercises the same FK/check/nullability contract as subsequent updates.
      EXECUTE format(
        'INSERT INTO public.appointments (business_id, client_id, barber_member_id, start_at, end_at, status, created_by)
         SELECT %s FROM public.appointments WHERE id = %L',
        (SELECT string_agg(CASE WHEN column_name = v_case.column_name THEN v_case.expression
                               ELSE quote_ident(column_name) END, ', ' ORDER BY position)
         FROM unnest(ARRAY['business_id', 'client_id', 'barber_member_id', 'start_at', 'end_at', 'status', 'created_by'])
              WITH ORDINALITY AS columns(column_name, position)),
        v_default_appointment.id
      );
      RAISE EXCEPTION 'Expected rejection for % = %', v_case.column_name, v_case.expression;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME, v_column = COLUMN_NAME;
      IF v_state <> v_case.expected_state
         OR (v_case.expected_constraint IS NOT NULL AND v_constraint <> v_case.expected_constraint)
         OR (v_case.expected_column IS NOT NULL AND v_column <> v_case.expected_column) THEN
        RAISE;
      END IF;
    END;
  END LOOP;

  -- Each allowed status persists. Overlaps/hours/transitions are intentionally not enforced here.
  FOREACH v_status IN ARRAY ARRAY['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] LOOP
    INSERT INTO public.appointments (business_id, client_id, barber_member_id, start_at, end_at, status,
                                     notes, created_by, created_at, updated_at)
    VALUES (v_business_id, v_client_id, v_member_id, v_default_appointment.start_at,
            v_default_appointment.end_at, v_status, 'Initial notes', v_user_id,
            '1999-01-01T00:00:00Z', '2000-01-01T00:00:00Z') RETURNING * INTO v_full_appointment;
    IF v_full_appointment.status IS DISTINCT FROM v_status THEN
      RAISE EXCEPTION 'Approved status did not persist: %', v_status;
    END IF;
  END LOOP;
  UPDATE public.appointments SET notes = 'Updated notes', status = 'CANCELLED',
    start_at = start_at + interval '1 hour', end_at = end_at + interval '1 hour'
  WHERE id = v_full_appointment.id RETURNING * INTO v_updated_appointment;
  IF v_updated_appointment.updated_at IS DISTINCT FROM transaction_timestamp()
     OR v_updated_appointment.updated_at <= v_full_appointment.updated_at
     OR v_updated_appointment.created_at IS DISTINCT FROM v_full_appointment.created_at
     OR v_updated_appointment.created_by IS DISTINCT FROM v_user_id
     OR v_updated_appointment.status IS DISTINCT FROM 'CANCELLED'
     OR v_updated_appointment.notes IS DISTINCT FROM 'Updated notes'
     OR v_updated_appointment.start_at IS DISTINCT FROM v_full_appointment.start_at + interval '1 hour'
     OR v_updated_appointment.end_at IS DISTINCT FROM v_full_appointment.end_at + interval '1 hour' THEN
    RAISE EXCEPTION 'Reschedule, status or timestamp update failed';
  END IF;
  -- Restore NO_SHOW to verify both historical states remain stored, without deleting rows.
  UPDATE public.appointments SET status = 'NO_SHOW' WHERE id = v_full_appointment.id;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    SELECT count(*) INTO v_count FROM public.appointments;
    IF v_count <> 0 THEN
      RAISE EXCEPTION '% can read appointments', v_role;
    END IF;
    UPDATE public.appointments SET notes = 'Forbidden';
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN
      RAISE EXCEPTION '% can update appointments', v_role;
    END IF;
    DELETE FROM public.appointments;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN
      RAISE EXCEPTION '% can delete appointments', v_role;
    END IF;
    BEGIN
      INSERT INTO public.appointments (business_id, client_id, barber_member_id, start_at, end_at, created_by)
      VALUES (v_business_id, v_client_id, v_member_id, v_default_appointment.start_at,
              v_default_appointment.end_at, v_user_id);
      RAISE EXCEPTION '% can insert appointments', v_role;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
    RESET ROLE;
  END LOOP;
  SELECT count(*) INTO v_count FROM public.appointments WHERE business_id = v_business_id;
  SELECT * INTO v_updated_appointment FROM public.appointments WHERE id = v_full_appointment.id;
  IF v_count <> 7 OR v_updated_appointment.notes IS DISTINCT FROM 'Updated notes'
     OR v_updated_appointment.status IS DISTINCT FROM 'NO_SHOW'
     OR (SELECT count(*) FROM public.appointments WHERE business_id = v_business_id AND status = 'CANCELLED') <> 1 THEN
    RAISE EXCEPTION 'Historical rows or denied client writes changed the fixtures';
  END IF;
  RAISE NOTICE 'BF-058 passed: schema, defaults, 18 constraint rejections, six statuses, timezone, timestamps and RLS';
END;
$$;

ROLLBACK;
