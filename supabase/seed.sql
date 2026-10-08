-- BF-080: fictional local development business only. Run via Supabase CLI reset.
-- BF-081 owns user/OWNER linkage; no auth, membership, catalog or transaction seed.
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
