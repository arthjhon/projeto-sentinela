-- Sensor health detector: tables, RLS and the least-privilege role used by the worker.
-- Idempotent: safe to re-run in the Supabase SQL Editor (or psql as postgres).
-- After the first run, enable login (see infra/README.md, "Role sentinela_worker").

-- ---------------------------------------------------------------- tables
CREATE TABLE IF NOT EXISTS public.sensor_health (
  device_id     text        NOT NULL,
  sensor        text        NOT NULL,
  boia_id       text,
  modo          text        NOT NULL CHECK (modo IN ('bancada', 'campo')),
  estado        text        NOT NULL CHECK (estado IN (
                  'ok', 'suspeito', 'falha', 'sem_dados', 'manutencao',
                  'bancada', 'dados_insuficientes', 'nao_cadastrado')),
  motivo        text,
  desde         timestamptz NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, sensor)
);

CREATE TABLE IF NOT EXISTS public.sensor_health_events (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text        NOT NULL,
  sensor    text        NOT NULL,
  boia_id   text,
  estado    text        NOT NULL,
  motivo    text,
  inicio    timestamptz NOT NULL,
  fim       timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS sensor_health_events_one_open
  ON public.sensor_health_events (device_id, sensor) WHERE fim IS NULL;
CREATE INDEX IF NOT EXISTS sensor_health_events_inicio
  ON public.sensor_health_events (inicio DESC);

CREATE TABLE IF NOT EXISTS public.worker_jobs (
  job             text PRIMARY KEY,
  ok              boolean,
  ultima_execucao timestamptz,
  ultimo_sucesso  timestamptz,
  duracao_s       real,
  erro            text
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sensor_health_events_fim_check'
                 AND conrelid = 'public.sensor_health_events'::regclass) THEN
    ALTER TABLE public.sensor_health_events
      ADD CONSTRAINT sensor_health_events_fim_check CHECK (fim IS NULL OR fim >= inicio);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sensor_health_events_estado_check'
                 AND conrelid = 'public.sensor_health_events'::regclass) THEN
    ALTER TABLE public.sensor_health_events
      ADD CONSTRAINT sensor_health_events_estado_check CHECK (estado IN (
        'ok', 'suspeito', 'falha', 'sem_dados', 'manutencao',
        'bancada', 'dados_insuficientes', 'nao_cadastrado'));
  END IF;
END
$$;

-- ---------------------------------------------------------------- role
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sentinela_worker') THEN
    CREATE ROLE sentinela_worker NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;

-- Unconditional hardening (also corrects a role that pre-existed with other attributes).
-- LOGIN is deliberately not touched: the owner enables it in the runbook.
-- (NOSUPERUSER/NOBYPASSRLS cannot be written here: on Supabase `postgres` is not a superuser and
-- PG15 refuses those keywords for non-superusers. Instead fail closed if either is set.)
ALTER ROLE sentinela_worker NOINHERIT NOCREATEDB NOCREATEROLE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sentinela_worker'
             AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'sentinela_worker must not be SUPERUSER or BYPASSRLS';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO sentinela_worker;

-- ---------------------------------------------------------------- privileges
-- Supabase default privileges give anon/authenticated/service_role ALL on new public
-- tables. Neutralize: clients only SELECT (through RLS); anon gets nothing.
REVOKE ALL ON public.sensor_health, public.sensor_health_events, public.worker_jobs
  FROM PUBLIC, anon, authenticated, sentinela_worker;
GRANT SELECT ON public.sensor_health, public.sensor_health_events, public.worker_jobs
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.sensor_health, public.sensor_health_events, public.worker_jobs
  TO sentinela_worker;
GRANT SELECT ON public.app_settings, public.maintenance_logs TO sentinela_worker;

-- ---------------------------------------------------------------- RLS
ALTER TABLE public.sensor_health        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensor_health_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_jobs          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sensor_health_select ON public.sensor_health;
CREATE POLICY sensor_health_select ON public.sensor_health
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS sensor_health_events_select ON public.sensor_health_events;
CREATE POLICY sensor_health_events_select ON public.sensor_health_events
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS worker_jobs_select ON public.worker_jobs;
CREATE POLICY worker_jobs_select ON public.worker_jobs
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS sensor_health_worker ON public.sensor_health;
CREATE POLICY sensor_health_worker ON public.sensor_health
  FOR ALL TO sentinela_worker USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS sensor_health_events_worker ON public.sensor_health_events;
CREATE POLICY sensor_health_events_worker ON public.sensor_health_events
  FOR ALL TO sentinela_worker USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS worker_jobs_worker ON public.worker_jobs;
CREATE POLICY worker_jobs_worker ON public.worker_jobs
  FOR ALL TO sentinela_worker USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS app_settings_worker_select ON public.app_settings;
CREATE POLICY app_settings_worker_select ON public.app_settings
  FOR SELECT TO sentinela_worker USING (true);

DROP POLICY IF EXISTS maintenance_logs_worker_select ON public.maintenance_logs;
CREATE POLICY maintenance_logs_worker_select ON public.maintenance_logs
  FOR SELECT TO sentinela_worker USING (true);
