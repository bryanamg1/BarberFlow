-- BF-080: fictional local development business only. Run via Supabase CLI reset.
-- BF-080 owns only this business; BF-081 links the local demo OWNER below.
-- Fixed identity and synthetic timestamps make clean resets reproducible.
INSERT INTO public.businesses (
  id, name, currency_code, timezone, is_active, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000080',
  'BarberFlow Demo (local)',
  'ARS',
  'America/Argentina/Buenos_Aires',
  true,
  '2026-01-01T00:00:00Z',
  '2026-01-01T00:00:00Z'
);

-- BF-081: LOCAL DEVELOPMENT ONLY. Public fixture credentials, never production.
-- owner@barberflow.local / BarberFlow-Local-Only-081!
-- Login-capable email user for local GoTrue v2.197.0 (users + email identity).
-- Bcrypt cost 10 generated once with existing pgcrypto; literal hash preserves
-- byte-for-byte reset reproducibility. This public fixture is not a hash policy.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user, is_anonymous,
  created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000000081',
  'authenticated',
  'authenticated',
  'owner@barberflow.local',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyewkMU/lbhpM2liYLw4hI./ly6e.sBzgC',
  '2026-01-01T00:00:00Z',
  '', '', '', '',
  '{"provider":"email","providers":["email"]}',
  '{"first_name":"Demo","last_name":"Owner"}',
  false, false, false,
  '2026-01-01T00:00:00Z',
  '2026-01-01T00:00:00Z'
);

INSERT INTO auth.identities (
  id, provider_id, user_id, identity_data, provider, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000182',
  '00000000-0000-4000-8000-000000000081',
  '00000000-0000-4000-8000-000000000081',
  '{"sub":"00000000-0000-4000-8000-000000000081","email":"owner@barberflow.local","email_verified":true,"phone_verified":false}',
  'email',
  '2026-01-01T00:00:00Z',
  '2026-01-01T00:00:00Z'
);

INSERT INTO public.profiles (id, first_name, last_name, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000000081', 'Demo', 'Owner',
  '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
);

INSERT INTO public.business_members (
  id, business_id, user_id, role, is_active, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000181',
  '00000000-0000-4000-8000-000000000080',
  '00000000-0000-4000-8000-000000000081',
  'OWNER', true,
  '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
);
