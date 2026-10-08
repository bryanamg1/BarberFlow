\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = '';

-- Assertions consume the clean reset seed; no replacement fixture or Auth user.
DO $$
DECLARE
  owner_id constant uuid := '00000000-0000-4000-8000-000000000081';
  business_id constant uuid := '00000000-0000-4000-8000-000000000080';
  seeded_at constant timestamptz := '2026-01-01T00:00:00Z';
  demo auth.users%ROWTYPE;
  identity_row auth.identities%ROWTYPE;
  profile_row public.profiles%ROWTYPE;
  member_row public.business_members%ROWTYPE;
  target_table text;
  row_count bigint;
  checked_tables integer := 0;
BEGIN
  IF (SELECT count(*) FROM auth.users) <> 1
     OR (SELECT count(*) FROM auth.identities) <> 1
     OR (SELECT count(*) FROM public.profiles) <> 1
     OR (SELECT count(*) FROM public.business_members) <> 1
     OR (SELECT count(*) FROM public.businesses) <> 1 THEN
    RAISE EXCEPTION 'BF081 expects exactly one user, identity, profile, business and membership';
  END IF;
  SELECT * INTO STRICT demo FROM auth.users WHERE id = owner_id;
  IF demo.email IS DISTINCT FROM 'owner@barberflow.local'
     OR demo.aud IS DISTINCT FROM 'authenticated' OR demo.role IS DISTINCT FROM 'authenticated'
     OR demo.instance_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000000'::uuid
     OR demo.encrypted_password IS DISTINCT FROM '$2a$10$N9qo8uLOickgx2ZMRZoMyewkMU/lbhpM2liYLw4hI./ly6e.sBzgC'
     OR extensions.crypt('BarberFlow-Local-Only-081!', demo.encrypted_password)
        IS DISTINCT FROM demo.encrypted_password
     OR extensions.crypt('incorrect-demo-password', demo.encrypted_password) = demo.encrypted_password
     OR demo.email_confirmed_at IS DISTINCT FROM seeded_at
     OR demo.confirmed_at IS DISTINCT FROM seeded_at
     OR demo.created_at IS DISTINCT FROM seeded_at OR demo.updated_at IS DISTINCT FROM seeded_at
     OR demo.is_super_admin IS DISTINCT FROM false OR demo.is_sso_user OR demo.is_anonymous
     OR demo.banned_until IS NOT NULL OR demo.deleted_at IS NOT NULL
     OR demo.last_sign_in_at IS NOT NULL OR demo.phone IS NOT NULL
     OR demo.confirmation_token IS DISTINCT FROM '' OR demo.recovery_token IS DISTINCT FROM ''
     OR demo.email_change_token_new IS DISTINCT FROM '' OR demo.email_change IS DISTINCT FROM ''
     OR demo.email_change_token_current IS DISTINCT FROM '' OR demo.reauthentication_token IS DISTINCT FROM ''
     OR demo.raw_app_meta_data IS DISTINCT FROM '{"provider":"email","providers":["email"]}'::jsonb
     OR demo.raw_user_meta_data IS DISTINCT FROM '{"first_name":"Demo","last_name":"Owner"}'::jsonb THEN
    RAISE EXCEPTION 'BF081 Auth identity, credential/hash, confirmation or privilege state differs';
  END IF;
  SELECT * INTO STRICT identity_row FROM auth.identities WHERE user_id = owner_id;
  IF to_jsonb(identity_row) IS DISTINCT FROM jsonb_build_object(
    'id', '00000000-0000-4000-8000-000000000182', 'provider_id', owner_id,
    'user_id', owner_id, 'provider', 'email', 'email', 'owner@barberflow.local',
    'identity_data', jsonb_build_object('sub', owner_id, 'email', 'owner@barberflow.local',
      'email_verified', true, 'phone_verified', false),
    'created_at', seeded_at, 'updated_at', seeded_at, 'last_sign_in_at', NULL
  ) THEN
    RAISE EXCEPTION 'BF081 email identity differs';
  END IF;
  SELECT * INTO STRICT profile_row FROM public.profiles WHERE id = owner_id;
  IF to_jsonb(profile_row) IS DISTINCT FROM jsonb_build_object(
    'id', owner_id, 'first_name', 'Demo', 'last_name', 'Owner', 'phone', NULL,
    'avatar_path', NULL, 'created_at', seeded_at, 'updated_at', seeded_at
  ) THEN
    RAISE EXCEPTION 'BF081 profile relationship or contents differ';
  END IF;
  SELECT * INTO STRICT member_row FROM public.business_members WHERE user_id = owner_id;
  IF to_jsonb(member_row) IS DISTINCT FROM jsonb_build_object(
    'id', '00000000-0000-4000-8000-000000000181', 'business_id', business_id,
    'user_id', owner_id, 'role', 'OWNER', 'is_active', true,
    'created_at', seeded_at, 'updated_at', seeded_at
  ) OR NOT EXISTS (SELECT 1 FROM public.businesses b
                   WHERE b.id = business_id AND b.name = 'BarberFlow Demo (local)') THEN
    RAISE EXCEPTION 'BF081 OWNER membership or business relationship differs';
  END IF;
  FOR target_table IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    AND tablename NOT IN ('profiles', 'businesses', 'business_members') ORDER BY tablename
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', target_table) INTO row_count;
    IF row_count <> 0 THEN RAISE EXCEPTION 'Out-of-scope seed in %', target_table; END IF;
    checked_tables := checked_tables + 1;
  END LOOP;
  IF checked_tables <> 16 OR (SELECT count(*) FROM auth.sessions) <> 0
     OR (SELECT count(*) FROM auth.refresh_tokens) <> 0 THEN
    RAISE EXCEPTION 'BF081 baseline has extra tables, sessions or refresh tokens';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') <> 46
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
           AND NOT c.relforcerowsecurity) <> 19 THEN
    RAISE EXCEPTION 'BF081 changed RLS/policy baseline';
  END IF;
END;
$$;

-- Real PostgreSQL roles/JWT claims; live Auth/API validation is additionally run
-- outside this rollback suite before the second reset, without saving tokens.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000081","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF current_user <> 'authenticated' OR NOT row_security_active('public.businesses'::regclass)
     OR (SELECT count(*) FROM public.profiles) <> 1
     OR (SELECT count(*) FROM public.businesses) <> 1
     OR (SELECT count(*) FROM public.business_members) <> 1
     OR NOT public.has_business_role('00000000-0000-4000-8000-000000000080', ARRAY['OWNER'])
     OR EXISTS (SELECT 1 FROM public.business_settings) OR EXISTS (SELECT 1 FROM public.business_hours) THEN
    RAISE EXCEPTION 'Demo OWNER cannot read the expected profile/business/membership under RLS';
  END IF;
END;
$$;
RESET ROLE;
UPDATE public.business_members SET is_active = false WHERE id = '00000000-0000-4000-8000-000000000181';
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.businesses) OR EXISTS (SELECT 1 FROM public.business_members)
     OR public.has_business_role('00000000-0000-4000-8000-000000000080', ARRAY['OWNER'])
     OR (SELECT count(*) FROM public.profiles) <> 1 THEN
    RAISE EXCEPTION 'Inactive demo OWNER retains business access or loses own profile';
  END IF;
END;
$$;
RESET ROLE;
UPDATE public.business_members SET is_active = true WHERE id = '00000000-0000-4000-8000-000000000181';
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.businesses) <> 1
     OR (SELECT count(*) FROM public.business_members) <> 1
     OR NOT public.has_business_role('00000000-0000-4000-8000-000000000080', ARRAY['OWNER']) THEN
    RAISE EXCEPTION 'Reactivated demo OWNER access not restored';
  END IF;
END;
$$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles) OR EXISTS (SELECT 1 FROM public.businesses)
     OR EXISTS (SELECT 1 FROM public.business_members) THEN
    RAISE EXCEPTION 'Anon can read the seeded OWNER/business';
  END IF;
END;
$$;
RESET ROLE;
DO $$ BEGIN
  RAISE NOTICE 'BF081 passed: exact Auth/hash/confirmation/identity, profile, active OWNER linkage, no extra data; OWNER/inactive/reactivated/anon RLS';
END; $$;
ROLLBACK;
