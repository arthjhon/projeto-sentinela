-- ================================================
-- Backlog de implementação — tabelas de apoio
-- Cole e execute no SQL Editor do Supabase.
--
-- Cobre:
--   3.1 log de manutenção        -> maintenance_logs
--   3.2 calibração por sensor    -> sensor_calibrations
--   4.2 histórico de versões OTA -> firmware_deploys
--   6.1 log de auditoria         -> audit_logs
--
-- Nota de modelagem: as bóias NÃO vivem no Postgres — a fonte de verdade é
-- src/config/fleet.js. Por isso boia_id é TEXT ('SM-01') e não uma FK. Se a
-- frota migrar para o banco algum dia, estas colunas viram FK.
-- ================================================

-- ── 3.1 Log de manutenção ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.maintenance_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boia_id          TEXT NOT NULL,
  operador_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  operador_nome    TEXT NOT NULL,
  motivo           TEXT NOT NULL,
  timestamp_inicio TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- nulo enquanto a bóia está em manutenção; preenchido ao sair do modo
  timestamp_fim    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS maintenance_logs_boia_idx
  ON public.maintenance_logs (boia_id, timestamp_inicio DESC);

-- Só pode haver UMA manutenção aberta por bóia (evita duplo "entrar em modo")
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_logs_uma_aberta_por_boia
  ON public.maintenance_logs (boia_id) WHERE timestamp_fim IS NULL;

-- ── 3.2 Calibração por sensor ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sensor_calibrations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boia_id       TEXT NOT NULL,
  sensor_key    TEXT NOT NULL,          -- temperatura | ph | turbidez
  operador_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  operador_nome TEXT NOT NULL,
  observacao    TEXT,
  calibrated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sensor_calibrations_lookup_idx
  ON public.sensor_calibrations (boia_id, sensor_key, calibrated_at DESC);

-- ── 4.2 Histórico de versões / deploys OTA ────────────────────
CREATE TABLE IF NOT EXISTS public.firmware_deploys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boia_id       TEXT NOT NULL,
  versao        TEXT NOT NULL,
  sha256        TEXT,                   -- 4.1: hash do .bin enviado
  notas_release TEXT,
  status        TEXT NOT NULL DEFAULT 'pendente'
                CHECK (status IN ('pendente','sucesso','falha','revertido')),
  operador_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  operador_nome TEXT,
  data_deploy   TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmado_em TIMESTAMPTZ             -- 4.3: quando a bóia reportou boot ok
);

CREATE INDEX IF NOT EXISTS firmware_deploys_boia_idx
  ON public.firmware_deploys (boia_id, data_deploy DESC);

-- ── 5.4 Configurações da plataforma (chave/valor) ─────────────
-- Genérica de propósito: hoje guarda só a meta de financiamento, mas 5.3 e
-- futuras configs editáveis pelo admin caem aqui sem migração nova.
CREATE TABLE IF NOT EXISTS public.app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ── 6.1 Log de auditoria ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operador_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  operador_nome     TEXT NOT NULL,
  acao              TEXT NOT NULL,      -- ex: boia.editar, firmware.deploy
  entidade_afetada  TEXT,               -- ex: SM-01
  detalhes          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_operador_idx ON public.audit_logs (operador_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_acao_idx ON public.audit_logs (acao, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────
-- Mesma postura do schema existente: leitura para autenticados, escrita
-- restrita. Auditoria é append-only: sem UPDATE e sem DELETE, nem para admin —
-- um log que o operador pode apagar não serve como auditoria.

ALTER TABLE public.maintenance_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensor_calibrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firmware_deploys    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings        ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Leitura: qualquer usuário autenticado
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_logs' AND policyname='mlogs_select') THEN
    CREATE POLICY mlogs_select ON public.maintenance_logs FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sensor_calibrations' AND policyname='calib_select') THEN
    CREATE POLICY calib_select ON public.sensor_calibrations FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='firmware_deploys' AND policyname='fw_select') THEN
    CREATE POLICY fw_select ON public.firmware_deploys FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_logs' AND policyname='audit_select') THEN
    CREATE POLICY audit_select ON public.audit_logs FOR SELECT USING (auth.role() = 'authenticated');
  END IF;

  -- Escrita: autenticado insere; o app grava sempre o próprio operador
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_logs' AND policyname='mlogs_insert') THEN
    CREATE POLICY mlogs_insert ON public.maintenance_logs FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='maintenance_logs' AND policyname='mlogs_update') THEN
    -- update existe só para fechar a manutenção (timestamp_fim)
    CREATE POLICY mlogs_update ON public.maintenance_logs FOR UPDATE USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sensor_calibrations' AND policyname='calib_insert') THEN
    CREATE POLICY calib_insert ON public.sensor_calibrations FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='firmware_deploys' AND policyname='fw_insert') THEN
    CREATE POLICY fw_insert ON public.firmware_deploys FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='firmware_deploys' AND policyname='fw_update') THEN
    CREATE POLICY fw_update ON public.firmware_deploys FOR UPDATE USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_logs' AND policyname='audit_insert') THEN
    CREATE POLICY audit_insert ON public.audit_logs FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  END IF;

  -- app_settings: leitura PÚBLICA (a página de apoio é anônima e precisa da
  -- meta), escrita só para admin.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_settings' AND policyname='settings_public_read') THEN
    CREATE POLICY settings_public_read ON public.app_settings FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_settings' AND policyname='settings_admin_insert') THEN
    CREATE POLICY settings_admin_insert ON public.app_settings FOR INSERT
      WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_settings' AND policyname='settings_admin_update') THEN
    CREATE POLICY settings_admin_update ON public.app_settings FOR UPDATE
      USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
END $$;
