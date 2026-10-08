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

-- BF-082: approved fictional service catalog for the existing demo business only.
-- Prices use the business currency (ARS); no appointment/sale snapshots are seeded.
INSERT INTO public.services (
  id, business_id, name, description, price, duration_minutes, is_active,
  created_at, updated_at
) VALUES
  (
    '00000000-0000-4000-8000-000000000821',
    '00000000-0000-4000-8000-000000000080',
    'Corte clásico', NULL, 10000.00, 30, true,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  ),
  (
    '00000000-0000-4000-8000-000000000822',
    '00000000-0000-4000-8000-000000000080',
    'Barba', NULL, 5000.00, 15, true,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  ),
  (
    '00000000-0000-4000-8000-000000000823',
    '00000000-0000-4000-8000-000000000080',
    'Corte + barba', NULL, 14000.00, 45, true,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  );

-- BF-083: approved product categories only; no products or expense categories.
INSERT INTO public.product_categories (
  id, business_id, name, is_active, created_at, updated_at
) VALUES
  (
    '00000000-0000-4000-8000-000000000831',
    '00000000-0000-4000-8000-000000000080',
    'Cabello', true,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  ),
  (
    '00000000-0000-4000-8000-000000000832',
    '00000000-0000-4000-8000-000000000080',
    'Barba', true,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  ),
  (
    '00000000-0000-4000-8000-000000000833',
    '00000000-0000-4000-8000-000000000080',
    'Accesorios', true,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  );

-- BF-084: approved product catalog only; inventory comes from future movements.
INSERT INTO public.products (
  id, business_id, category_id, name, description, sku, sale_price,
  default_purchase_cost, minimum_stock, is_active, created_at, updated_at
) VALUES
  (
    '00000000-0000-4000-8000-000000000841',
    '00000000-0000-4000-8000-000000000080',
    '00000000-0000-4000-8000-000000000831',
    'Cera mate', NULL, 'BF-CAB-001', 12000.00, 6500.00, 3, true,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  ),
  (
    '00000000-0000-4000-8000-000000000842',
    '00000000-0000-4000-8000-000000000080',
    '00000000-0000-4000-8000-000000000831',
    'Shampoo', NULL, 'BF-CAB-002', 10000.00, 5500.00, 3, true,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  ),
  (
    '00000000-0000-4000-8000-000000000843',
    '00000000-0000-4000-8000-000000000080',
    '00000000-0000-4000-8000-000000000832',
    'Aceite para barba', NULL, 'BF-BAR-001', 11000.00, 6000.00, 2, true,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  ),
  (
    '00000000-0000-4000-8000-000000000844',
    '00000000-0000-4000-8000-000000000080',
    '00000000-0000-4000-8000-000000000832',
    'Bálsamo para barba', NULL, 'BF-BAR-002', 13000.00, 7000.00, 2, true,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  ),
  (
    '00000000-0000-4000-8000-000000000845',
    '00000000-0000-4000-8000-000000000080',
    '00000000-0000-4000-8000-000000000833',
    'Peine profesional', NULL, 'BF-ACC-001', 6000.00, 3000.00, 4, true,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  ),
  (
    '00000000-0000-4000-8000-000000000846',
    '00000000-0000-4000-8000-000000000080',
    '00000000-0000-4000-8000-000000000833',
    'Cepillo para barba', NULL, 'BF-ACC-002', 9000.00, 4500.00, 3, true,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  );

-- BF-085: fictional clients only; no contact data, Auth users or transactions.
INSERT INTO public.clients (
  id, business_id, first_name, last_name, phone, email, instagram, birth_date,
  notes, preferences, is_active, created_at, updated_at
) VALUES
  (
    '00000000-0000-4000-8000-000000000851',
    '00000000-0000-4000-8000-000000000080',
    'Martín', 'Pérez', NULL, NULL, NULL, NULL, NULL, NULL, true,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  ),
  (
    '00000000-0000-4000-8000-000000000852',
    '00000000-0000-4000-8000-000000000080',
    'Lucía', 'Gómez', NULL, NULL, NULL, NULL, NULL, NULL, true,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  ),
  (
    '00000000-0000-4000-8000-000000000853',
    '00000000-0000-4000-8000-000000000080',
    'Diego', NULL, NULL, NULL, NULL, NULL, NULL, NULL, true,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  ),
  (
    '00000000-0000-4000-8000-000000000854',
    '00000000-0000-4000-8000-000000000080',
    'Valentina', 'Ríos', NULL, NULL, NULL, NULL, NULL, NULL, false,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  );
