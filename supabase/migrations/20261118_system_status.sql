-- Internal status page: component status written by the worker `status` job (every 60 s).
-- Idempotent: safe to re-run. Requires 20261117_sensor_health.sql (role sentinela_worker, profiles).

CREATE TABLE IF NOT EXISTS public.system_status (
  componente    text        PRIMARY KEY,
  estado        text        NOT NULL CHECK (estado IN ('ok', 'degradado', 'falha', 'desconhecido')),
  detalhe       text,
  dados         jsonb,
  verificado_em timestamptz NOT NULL
);

-- Supabase default privileges give anon/authenticated/service_role ALL on new public tables.
-- Neutralize: clients only SELECT (through RLS); anon gets nothing; only the worker writes.
REVOKE ALL ON public.system_status FROM PUBLIC, anon, authenticated, sentinela_worker;
GRANT SELECT ON public.system_status TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.system_status TO sentinela_worker;

ALTER TABLE public.system_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_status_select ON public.system_status;
CREATE POLICY system_status_select ON public.system_status
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS system_status_worker ON public.system_status;
CREATE POLICY system_status_worker ON public.system_status
  FOR ALL TO sentinela_worker USING (true) WITH CHECK (true);
