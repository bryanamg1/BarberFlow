-- Documented barber agenda and client history by their reference and start time.
-- Existing business-first indexes remain useful for explicitly tenant-scoped queries;
-- they do not bound a PostgreSQL 17 B-tree scan by barber/client alone.
-- These leading reference columns also support restrictive FK lookups.
CREATE INDEX appointments_barber_member_id_start_at_idx
  ON public.appointments (barber_member_id, start_at);
CREATE INDEX appointments_client_id_start_at_idx
  ON public.appointments (client_id, start_at);

-- Category expense lookup/filter and category FK checks, not covered by business/date.
-- Expense purchase lookup already has its UNIQUE index; do not duplicate it.
CREATE INDEX expenses_category_id_idx ON public.expenses (category_id);

-- All other reviewed patterns reuse existing PK, UNIQUE or explicit indexes.
-- No drops, new constraints, partial/expression indexes or security changes.
