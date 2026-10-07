\set ON_ERROR_STOP on
BEGIN;

-- Local-only SQL fixtures, including auth identities needed for FK checks.
-- Everything is rolled back; no Auth schema changes or permanent seed data.
DO $$
DECLARE
  v_policy_names constant text[] := ARRAY[
    'profiles.profiles_select_self',
    'profiles.profiles_insert_self',
    'profiles.profiles_update_self',
    'businesses.businesses_select_members',
    'businesses.businesses_update_owners',
    'business_members.business_members_select_members',
    'business_members.business_members_insert_owners',
    'business_members.business_members_update_owners',
    'business_settings.business_settings_select_members',
    'business_settings.business_settings_insert_owners',
    'business_settings.business_settings_update_owners',
    'business_hours.business_hours_select_members',
    'business_hours.business_hours_insert_owners',
    'business_hours.business_hours_update_owners',
    'business_hours.business_hours_delete_owners'
  ];
  foundation_tables constant text[] := ARRAY[
    'business_hours', 'business_members', 'business_settings', 'businesses', 'profiles'
  ];
  user_id uuid := gen_random_uuid();
  barber_id uuid := gen_random_uuid();
  business_id uuid;
  other_business_id uuid;
  member_id uuid;
  hours_id uuid;
  business_row public.businesses%ROWTYPE;
  settings_row public.business_settings%ROWTYPE;
  target_table text;
  client_role text;
  actual_tables text[];
  actual_state text;
  actual_constraint text;
  actual_updated_at timestamptz;
  actual_created_at timestamptz;
  affected_rows bigint;
  row_count bigint;
  check_case record;
BEGIN
  SELECT array_agg(tablename::text ORDER BY tablename) INTO actual_tables
  FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY(foundation_tables);
  IF actual_tables IS DISTINCT FROM foundation_tables THEN
    RAISE EXCEPTION 'Unexpected public tables: %', actual_tables;
  END IF;

  IF (SELECT array_agg(tablename || '.' || policyname ORDER BY tablename, policyname)
      FROM pg_policies WHERE schemaname = 'public')
     IS DISTINCT FROM (SELECT array_agg(p ORDER BY p) FROM unnest(v_policy_names) AS names(p)) THEN
    RAISE EXCEPTION 'Expected exactly the 15 approved BF-073 policies and no others';
  END IF;

  FOREACH target_table IN ARRAY foundation_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = target_table AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS missing on %', target_table;
    END IF;
    IF (SELECT count(*) FROM pg_constraint
        WHERE conrelid = format('public.%I', target_table)::regclass AND contype = 'p') <> 1 THEN
      RAISE EXCEPTION 'Primary key missing on %', target_table;
    END IF;
    IF (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND information_schema.columns.table_name = target_table
          AND column_name IN ('created_at', 'updated_at')
          AND data_type = 'timestamp with time zone' AND is_nullable = 'NO'
          AND column_default IS NOT NULL) <> 2 THEN
      RAISE EXCEPTION 'Timestamp contract failed on %', target_table;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_constraint
      WHERE conrelid IN (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'public' AND c.relname = ANY(foundation_tables))
        AND contype = 'f' AND confdeltype = 'r') <> 5 THEN
    RAISE EXCEPTION 'Expected five restrictive foreign keys';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'set_updated_at' AND p.prosecdef) THEN
    RAISE EXCEPTION 'Timestamp utility must not be SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                 AND indexname = 'business_members_user_id_idx') THEN
    RAISE EXCEPTION 'Membership user lookup index missing';
  END IF;

  INSERT INTO auth.users (id) VALUES (user_id), (barber_id);
  INSERT INTO public.profiles (id, first_name, last_name)
  VALUES (user_id, 'Foundation', 'Test');
  INSERT INTO public.businesses (name) VALUES ('Temporary foundation test') RETURNING * INTO business_row;
  business_id := business_row.id;
  INSERT INTO public.businesses (name) VALUES ('Temporary constraint test') RETURNING id INTO other_business_id;
  IF business_row.currency_code <> 'ARS'
     OR business_row.timezone <> 'America/Argentina/Buenos_Aires'
     OR business_row.is_active IS DISTINCT FROM true
     OR business_row.created_at IS NULL OR business_row.updated_at IS NULL THEN
    RAISE EXCEPTION 'Business defaults failed';
  END IF;

  INSERT INTO public.business_members (business_id, user_id, role)
  VALUES (business_id, user_id, 'OWNER') RETURNING id INTO member_id;
  INSERT INTO public.business_members (business_id, user_id, role)
  VALUES (business_id, barber_id, 'BARBER');
  IF NOT (SELECT is_active FROM public.business_members WHERE id = member_id) THEN
    RAISE EXCEPTION 'Membership must default to active';
  END IF;
  INSERT INTO public.business_settings (business_id) VALUES (business_id) RETURNING * INTO settings_row;
  IF settings_row.appointment_interval_minutes <> 30
     OR settings_row.default_service_buffer_minutes <> 0
     OR settings_row.allow_overlapping_appointments IS DISTINCT FROM false
     OR settings_row.low_stock_notifications IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Settings defaults failed';
  END IF;
  INSERT INTO public.business_hours (business_id, day_of_week, open_time, close_time)
  VALUES (business_id, 0, '09:00', '18:00') RETURNING id INTO hours_id;
  IF (SELECT is_closed FROM public.business_hours WHERE id = hours_id) THEN
    RAISE EXCEPTION 'Hours must default to open';
  END IF;
  INSERT INTO public.business_hours (business_id, day_of_week, open_time, close_time, is_closed)
  VALUES (business_id, 1, '09:00', '09:00', true);
  UPDATE public.businesses SET is_active = false WHERE id = business_id;
  UPDATE public.business_members SET is_active = false WHERE id = member_id;

  FOR check_case IN
    SELECT * FROM (VALUES
      (format('INSERT INTO public.business_members (business_id, user_id, role) VALUES (%L, %L, ''OWNER'')', business_id, user_id), '23505', 'business_members_business_user_key'),
      (format('INSERT INTO public.business_members (business_id, user_id, role) VALUES (%L, %L, ''ADMIN'')', other_business_id, user_id), '23514', 'business_members_role_check'),
      (format('INSERT INTO public.business_settings (business_id, appointment_interval_minutes) VALUES (%L, 0)', other_business_id), '23514', 'business_settings_appointment_interval_check'),
      (format('INSERT INTO public.business_settings (business_id, appointment_interval_minutes) VALUES (%L, -1)', other_business_id), '23514', 'business_settings_appointment_interval_check'),
      (format('INSERT INTO public.business_settings (business_id, default_service_buffer_minutes) VALUES (%L, -1)', other_business_id), '23514', 'business_settings_service_buffer_check'),
      (format('INSERT INTO public.business_settings (business_id) VALUES (%L)', business_id), '23505', 'business_settings_pkey'),
      (format('INSERT INTO public.business_hours (business_id, day_of_week, open_time, close_time) VALUES (%L, -1, ''09:00'', ''18:00'')', business_id), '23514', 'business_hours_day_of_week_check'),
      (format('INSERT INTO public.business_hours (business_id, day_of_week, open_time, close_time) VALUES (%L, 7, ''09:00'', ''18:00'')', business_id), '23514', 'business_hours_day_of_week_check'),
      (format('INSERT INTO public.business_hours (business_id, day_of_week, open_time, close_time) VALUES (%L, 0, ''09:00'', ''18:00'')', business_id), '23505', 'business_hours_business_day_key'),
      (format('INSERT INTO public.business_hours (business_id, day_of_week, open_time, close_time) VALUES (%L, 2, ''09:00'', ''09:00'')', business_id), '23514', 'business_hours_open_interval_check'),
      (format('INSERT INTO public.business_hours (business_id, day_of_week, open_time, close_time) VALUES (%L, 2, ''18:00'', ''09:00'')', business_id), '23514', 'business_hours_open_interval_check'),
      ('INSERT INTO public.profiles (id, first_name, last_name) VALUES (gen_random_uuid(), ''Missing'', ''User'')', '23503', 'profiles_id_fkey'),
      (format('INSERT INTO public.business_members (business_id, user_id, role) VALUES (%L, gen_random_uuid(), ''BARBER'')', business_id), '23503', 'business_members_user_id_fkey'),
      (format('INSERT INTO public.business_members (business_id, user_id, role) VALUES (gen_random_uuid(), %L, ''BARBER'')', user_id), '23503', 'business_members_business_id_fkey'),
      ('INSERT INTO public.business_settings (business_id) VALUES (gen_random_uuid())', '23503', 'business_settings_business_id_fkey'),
      ('INSERT INTO public.business_hours (business_id, day_of_week, open_time, close_time) VALUES (gen_random_uuid(), 0, ''09:00'', ''18:00'')', '23503', 'business_hours_business_id_fkey'),
      (format('DELETE FROM public.businesses WHERE id = %L', business_id), '23503', NULL),
      (format('DELETE FROM auth.users WHERE id = %L', user_id), '23503', NULL)
    ) AS cases(statement, expected_state, expected_constraint)
  LOOP
    BEGIN
      EXECUTE check_case.statement;
      RAISE EXCEPTION 'Expected rejection: %', check_case.statement;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE, actual_constraint = CONSTRAINT_NAME;
      IF actual_state <> check_case.expected_state
         OR (check_case.expected_constraint IS NOT NULL AND actual_constraint <> check_case.expected_constraint) THEN
        RAISE;
      END IF;
    END;
  END LOOP;

  FOREACH target_table IN ARRAY foundation_tables LOOP
    EXECUTE format('UPDATE public.%I SET created_at = ''1999-01-01T00:00:00Z''', target_table);
    EXECUTE format('UPDATE public.%I SET updated_at = ''2000-01-01T00:00:00Z'' RETURNING updated_at, created_at', target_table)
      INTO actual_updated_at, actual_created_at;
    IF actual_updated_at IS DISTINCT FROM transaction_timestamp()
       OR actual_created_at IS DISTINCT FROM '1999-01-01T00:00:00Z'::timestamptz THEN
      RAISE EXCEPTION 'updated_at trigger or created_at preservation failed on %', target_table;
    END IF;
  END LOOP;

  -- Both roles without a request identity remain denied despite BF-073 policies.
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', client_role);
    FOREACH target_table IN ARRAY foundation_tables LOOP
      EXECUTE format('SELECT count(*) FROM public.%I', target_table) INTO row_count;
      IF row_count <> 0 THEN
        RAISE EXCEPTION '% can read rows in %', client_role, target_table;
      END IF;
      EXECUTE format('UPDATE public.%I SET updated_at = now()', target_table);
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      IF affected_rows <> 0 THEN
        RAISE EXCEPTION '% can update rows in %', client_role, target_table;
      END IF;
      EXECUTE format('DELETE FROM public.%I', target_table);
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      IF affected_rows <> 0 THEN
        RAISE EXCEPTION '% can delete rows in %', client_role, target_table;
      END IF;
    END LOOP;
    FOR check_case IN
      SELECT * FROM (VALUES
        (format('INSERT INTO public.profiles (id, first_name, last_name) VALUES (%L, ''Denied'', ''Profile'')', barber_id)),
        ('INSERT INTO public.businesses (name) VALUES (''Denied business'')'),
        (format('INSERT INTO public.business_members (business_id, user_id, role) VALUES (%L, %L, ''BARBER'')', other_business_id, barber_id)),
        (format('INSERT INTO public.business_settings (business_id) VALUES (%L)', other_business_id)),
        (format('INSERT INTO public.business_hours (business_id, day_of_week, open_time, close_time) VALUES (%L, 2, ''09:00'', ''18:00'')', business_id))
      ) AS cases(statement)
    LOOP
      BEGIN
        EXECUTE check_case.statement;
        RAISE EXCEPTION 'Expected RLS write rejection on %: %', client_role, check_case.statement;
      EXCEPTION WHEN insufficient_privilege THEN
        NULL;
      END;
    END LOOP;
    RESET ROLE;
  END LOOP;

  FOREACH target_table IN ARRAY foundation_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', target_table) INTO row_count;
    IF row_count <> (CASE WHEN target_table IN ('businesses', 'business_members', 'business_hours') THEN 2 ELSE 1 END) THEN
      RAISE EXCEPTION 'Denied writes changed the fixture rows in %', target_table;
    END IF;
  END LOOP;
  RAISE NOTICE 'BF-050 passed: structure, defaults, 18 constraint rejections, timestamps and client RLS denial';
END;
$$;

ROLLBACK;
