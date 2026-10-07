\set ON_ERROR_STOP on
BEGIN;

-- Local administrative fixtures only, including FK identities; everything rolls back.
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_business_id uuid;
  v_client_id uuid;
  v_member_id uuid;
  v_appointment_id uuid;
  v_other_appointment_id uuid;
  v_service_id uuid;
  v_other_service_id uuid;
  v_snapshot public.appointment_services%ROWTYPE;
  v_actual_snapshot public.appointment_services%ROWTYPE;
  v_multiple public.appointment_services%ROWTYPE;
  v_role text;
  v_count bigint;
  v_affected bigint;
  v_state text;
  v_constraint text;
  v_column text;
  v_case record;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'appointment_services') <> 9 THEN
    RAISE EXCEPTION 'Unexpected appointment_services columns';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('id', 'uuid', 'NO'),
      ('appointment_id', 'uuid', 'NO'),
      ('service_id', 'uuid', 'YES'),
      ('service_name_snapshot', 'text', 'NO'),
      ('unit_price_snapshot', 'numeric', 'NO'),
      ('duration_minutes_snapshot', 'int4', 'NO'),
      ('quantity', 'int4', 'NO'),
      ('line_total', 'numeric', 'NO'),
      ('created_at', 'timestamptz', 'NO')
    ) AS columns(column_name, udt_name, is_nullable)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = 'appointment_services'
        AND c.column_name = v_case.column_name AND c.udt_name = v_case.udt_name
        AND c.is_nullable = v_case.is_nullable
    ) THEN
      RAISE EXCEPTION 'Type/nullability mismatch for %', v_case.column_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
       AND table_name = 'appointment_services' AND column_name IN ('unit_price_snapshot', 'line_total')
       AND numeric_precision = 12 AND numeric_scale = 2) <> 2 THEN
    RAISE EXCEPTION 'Both monetary fields must use numeric(12,2)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
              AND table_name = 'appointment_services' AND column_name = 'line_total'
              AND (column_default IS NOT NULL OR is_generated <> 'NEVER')) THEN
    RAISE EXCEPTION 'line_total must be supplied explicitly without default or generation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.appointment_services'::regclass
                 AND conname = 'appointment_services_pkey' AND contype = 'p') THEN
    RAISE EXCEPTION 'Appointment services PK missing';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('appointment_services_appointment_id_fkey', 'public.appointments'),
      ('appointment_services_service_id_fkey', 'public.services')
    ) AS foreign_keys(constraint_name, target_table)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.appointment_services'::regclass
                   AND conname = v_case.constraint_name AND contype = 'f'
                   AND confrelid = v_case.target_table::regclass AND confdeltype = 'r') THEN
      RAISE EXCEPTION 'Restrictive FK missing: %', v_case.constraint_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.appointment_services'::regclass AND contype = 'u') THEN
    RAISE EXCEPTION 'Duplicate appointment/service pairs must remain allowed';
  END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'appointment_services') <> 3 THEN
    RAISE EXCEPTION 'Expected PK and two reference indexes';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('appointment_services_appointment_id_idx', '% USING btree (appointment_id)'),
      ('appointment_services_service_id_idx', '% USING btree (service_id)')
    ) AS indexes(index_name, definition)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'appointment_services'
                   AND indexname = v_case.index_name AND indexdef LIKE v_case.definition) THEN
      RAISE EXCEPTION 'Reference index missing: %', v_case.index_name;
    END IF;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.appointment_services'::regclass)
     OR (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'appointment_services') IS DISTINCT FROM
        ARRAY['appointment_services_delete_authorized', 'appointment_services_insert_authorized',
              'appointment_services_select_authorized', 'appointment_services_update_authorized']::text[] THEN
    RAISE EXCEPTION 'Appointment services must have RLS and exactly the four BF-075 policies';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.appointment_services'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'No automatic snapshot or updated_at trigger is approved';
  END IF;

  INSERT INTO auth.users (id) VALUES (v_user_id);
  INSERT INTO public.businesses (name) VALUES ('Temporary snapshot test') RETURNING id INTO v_business_id;
  INSERT INTO public.clients (business_id, first_name) VALUES (v_business_id, 'Temporary') RETURNING id INTO v_client_id;
  INSERT INTO public.business_members (business_id, user_id, role)
  VALUES (v_business_id, v_user_id, 'BARBER') RETURNING id INTO v_member_id;
  INSERT INTO public.appointments (business_id, client_id, barber_member_id, start_at, end_at, created_by)
  VALUES (v_business_id, v_client_id, v_member_id, '2030-01-07T12:00:00Z', '2030-01-07T13:00:00Z', v_user_id)
  RETURNING id INTO v_appointment_id;
  INSERT INTO public.appointments (business_id, client_id, barber_member_id, start_at, end_at, created_by)
  VALUES (v_business_id, v_client_id, v_member_id, '2030-01-08T12:00:00Z', '2030-01-08T13:00:00Z', v_user_id)
  RETURNING id INTO v_other_appointment_id;
  INSERT INTO public.services (business_id, name, price, duration_minutes)
  VALUES (v_business_id, 'Corte', 100, 30) RETURNING id INTO v_service_id;
  INSERT INTO public.services (business_id, name, price, duration_minutes)
  VALUES (v_business_id, 'Barba', 0, 5) RETURNING id INTO v_other_service_id;

  -- Critical snapshot fixture: quantity is omitted to exercise DEFAULT 1.
  INSERT INTO public.appointment_services (appointment_id, service_id, service_name_snapshot,
                                          unit_price_snapshot, duration_minutes_snapshot, line_total)
  VALUES (v_appointment_id, v_service_id, 'Corte', 100, 30, 100) RETURNING * INTO v_snapshot;
  IF v_snapshot.id IS NULL OR v_snapshot.quantity IS DISTINCT FROM 1
     OR v_snapshot.created_at IS DISTINCT FROM transaction_timestamp() THEN
    RAISE EXCEPTION 'Snapshot UUID, quantity or timestamp default failed';
  END IF;
  -- Multiple services on one appointment, and the same service on another appointment.
  INSERT INTO public.appointment_services (appointment_id, service_id, service_name_snapshot,
                                          unit_price_snapshot, duration_minutes_snapshot, line_total)
  VALUES (v_appointment_id, v_other_service_id, 'Barba', 0, 5, 0);
  INSERT INTO public.appointment_services (appointment_id, service_id, service_name_snapshot,
                                          unit_price_snapshot, duration_minutes_snapshot, quantity, line_total)
  VALUES (v_other_appointment_id, v_service_id, 'Corte', 100.25, 30, 2, 200.50) RETURNING * INTO v_multiple;
  IF v_multiple.quantity <> 2 OR v_multiple.unit_price_snapshot IS DISTINCT FROM 100.25
     OR v_multiple.line_total IS DISTINCT FROM 200.50 THEN
    RAISE EXCEPTION 'Positive decimal snapshot and quantity > 1 failed';
  END IF;
  -- Duplicate pairs and an absent catalog reference are valid by contract.
  INSERT INTO public.appointment_services (appointment_id, service_id, service_name_snapshot,
                                          unit_price_snapshot, duration_minutes_snapshot, line_total)
  VALUES (v_appointment_id, v_service_id, 'Corte', 100, 30, 100),
         (v_appointment_id, NULL, 'Historical service', 50, 10, 50);
  IF (SELECT count(*) FROM public.appointment_services WHERE appointment_id = v_appointment_id
       AND service_id = v_service_id) <> 2
     OR (SELECT count(*) FROM public.appointment_services WHERE appointment_id = v_appointment_id
          AND service_id IS NULL) <> 1 THEN
    RAISE EXCEPTION 'Duplicate pairs or nullable service reference failed';
  END IF;

  FOR v_case IN
    SELECT * FROM (VALUES
      ('appointment_id', 'gen_random_uuid()', '23503', 'appointment_services_appointment_id_fkey', NULL),
      ('service_id', 'gen_random_uuid()', '23503', 'appointment_services_service_id_fkey', NULL),
      ('appointment_id', 'NULL', '23502', NULL, 'appointment_id'),
      ('service_name_snapshot', 'NULL', '23502', NULL, 'service_name_snapshot'),
      ('service_name_snapshot', '''''', '23514', 'appointment_services_service_name_snapshot_check', NULL),
      ('service_name_snapshot', '''   ''', '23514', 'appointment_services_service_name_snapshot_check', NULL),
      ('unit_price_snapshot', 'NULL', '23502', NULL, 'unit_price_snapshot'),
      ('unit_price_snapshot', '-1', '23514', NULL, NULL),
      ('unit_price_snapshot', '''NaN''::numeric', '23514', NULL, NULL),
      ('duration_minutes_snapshot', 'NULL', '23502', NULL, 'duration_minutes_snapshot'),
      ('duration_minutes_snapshot', '0', '23514', 'appointment_services_duration_minutes_snapshot_check', NULL),
      ('duration_minutes_snapshot', '-1', '23514', 'appointment_services_duration_minutes_snapshot_check', NULL),
      ('quantity', 'NULL', '23502', NULL, 'quantity'),
      ('quantity', '0', '23514', NULL, NULL),
      ('quantity', '-1', '23514', NULL, NULL),
      ('line_total', 'NULL', '23502', NULL, 'line_total'),
      ('line_total', '-1', '23514', 'appointment_services_line_total_check', NULL),
      ('line_total', '''NaN''::numeric', '23514', 'appointment_services_line_total_check', NULL),
      ('line_total', '101', '23514', 'appointment_services_line_total_check', NULL)
    ) AS cases(column_name, expression, expected_state, expected_constraint, expected_column)
  LOOP
    BEGIN
      EXECUTE format(
        'INSERT INTO public.appointment_services (appointment_id, service_id, service_name_snapshot,
          unit_price_snapshot, duration_minutes_snapshot, quantity, line_total)
         SELECT %s FROM public.appointment_services WHERE id = %L',
        (SELECT string_agg(CASE WHEN column_name = v_case.column_name THEN v_case.expression
                               ELSE quote_ident(column_name) END, ', ' ORDER BY position)
         FROM unnest(ARRAY['appointment_id', 'service_id', 'service_name_snapshot', 'unit_price_snapshot',
                           'duration_minutes_snapshot', 'quantity', 'line_total'])
              WITH ORDINALITY AS columns(column_name, position)), v_snapshot.id
      );
      RAISE EXCEPTION 'Expected rejection for % = %', v_case.column_name, v_case.expression;
    EXCEPTION WHEN OTHERS THEN
      -- Price/quantity violations may also violate the exact line-total invariant.
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME, v_column = COLUMN_NAME;
      IF v_state <> v_case.expected_state
         OR (v_case.expected_constraint IS NOT NULL AND v_constraint <> v_case.expected_constraint)
         OR (v_case.expected_column IS NOT NULL AND v_column <> v_case.expected_column) THEN
        RAISE;
      END IF;
    END;
  END LOOP;
  FOR v_case IN
    SELECT * FROM (VALUES
      (format('DELETE FROM public.appointments WHERE id = %L', v_appointment_id), '23503', 'appointment_services_appointment_id_fkey'),
      (format('DELETE FROM public.services WHERE id = %L', v_service_id), '23503', 'appointment_services_service_id_fkey'),
      (format('UPDATE public.appointment_services SET unit_price_snapshot = 101 WHERE id = %L', v_snapshot.id), '23514', 'appointment_services_line_total_check'),
      (format('UPDATE public.appointment_services SET quantity = 2 WHERE id = %L', v_snapshot.id), '23514', 'appointment_services_line_total_check'),
      (format('UPDATE public.appointment_services SET line_total = 99 WHERE id = %L', v_snapshot.id), '23514', 'appointment_services_line_total_check')
    ) AS cases(statement, expected_state, expected_constraint)
  LOOP
    BEGIN
      EXECUTE v_case.statement;
      RAISE EXCEPTION 'Expected rejection: %', v_case.statement;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME;
      IF v_state <> v_case.expected_state OR v_constraint <> v_case.expected_constraint THEN
        RAISE;
      END IF;
    END;
  END LOOP;
  -- Consistent multi-column edits are allowed until historical workflow rules are implemented.
  UPDATE public.appointment_services SET quantity = 3, line_total = 300.75 WHERE id = v_multiple.id;
  SELECT * INTO v_multiple FROM public.appointment_services WHERE id = v_multiple.id;
  IF v_multiple.quantity <> 3 OR v_multiple.line_total IS DISTINCT FROM 300.75 THEN
    RAISE EXCEPTION 'Consistent quantity/total update failed';
  END IF;

  -- Critical historical test: later catalog edits/archival must not rewrite any snapshot.
  UPDATE public.services SET name = 'Corte Premium', price = 150, duration_minutes = 45, is_active = false
  WHERE id = v_service_id;
  IF NOT EXISTS (SELECT 1 FROM public.services WHERE id = v_service_id AND name = 'Corte Premium'
                 AND price = 150 AND duration_minutes = 45 AND NOT is_active) THEN
    RAISE EXCEPTION 'Catalog update fixture failed';
  END IF;
  SELECT * INTO v_actual_snapshot FROM public.appointment_services WHERE id = v_snapshot.id;
  IF v_actual_snapshot IS DISTINCT FROM v_snapshot THEN
    RAISE EXCEPTION 'Catalog change rewrote the Corte / 100 / 30 snapshot';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointment_services WHERE service_id = v_service_id
              AND (service_name_snapshot <> 'Corte' OR duration_minutes_snapshot <> 30)) THEN
    RAISE EXCEPTION 'Catalog change rewrote other historical lines';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    SELECT count(*) INTO v_count FROM public.appointment_services;
    IF v_count <> 0 THEN
      RAISE EXCEPTION '% can read appointment services', v_role;
    END IF;
    UPDATE public.appointment_services SET service_name_snapshot = 'Forbidden';
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN
      RAISE EXCEPTION '% can update appointment services', v_role;
    END IF;
    DELETE FROM public.appointment_services;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN
      RAISE EXCEPTION '% can delete appointment services', v_role;
    END IF;
    BEGIN
      INSERT INTO public.appointment_services (appointment_id, service_id, service_name_snapshot,
                                              unit_price_snapshot, duration_minutes_snapshot, line_total)
      VALUES (v_appointment_id, v_service_id, 'Denied', 100, 30, 100);
      RAISE EXCEPTION '% can insert appointment services', v_role;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
    RESET ROLE;
  END LOOP;
  SELECT count(*) INTO v_count FROM public.appointment_services
  WHERE appointment_id IN (v_appointment_id, v_other_appointment_id);
  SELECT * INTO v_actual_snapshot FROM public.appointment_services WHERE id = v_snapshot.id;
  IF v_count <> 5 OR v_actual_snapshot IS DISTINCT FROM v_snapshot THEN
    RAISE EXCEPTION 'Denied client writes changed historical fixtures';
  END IF;
  RAISE NOTICE 'BF-059 passed: schema, defaults, 24 constraint rejections, relationships, exact totals, independent snapshots and RLS';
END;
$$;

ROLLBACK;
