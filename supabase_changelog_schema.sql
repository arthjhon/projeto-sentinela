-- ================================================
-- Changelog público ("Evolução") — tabela + storage
-- Cole e execute no SQL Editor do Supabase.
--
-- Cobre a spec docs/superpowers/specs/2026-07-20-changelog-publico-design.md:
--   changelog_entries  -> entradas do changelog (manuais, curadas pelo admin)
--   bucket 'changelog' -> fotos das entradas
--
-- A data oficial que ancora os marcos automáticos de dias
-- (app_settings.monitoramento_inicio) NÃO precisa de migração: app_settings
-- já existe e é genérica (ver supabase_backlog_schema.sql).
--
-- Arquivo isolado de propósito: pode rodar em produção sem depender do resto
-- do backlog já ter sido aplicado — só depende de `public.profiles` existir.
--
-- Ressalva: essa independência é só do SQL. A funcionalidade completa (contador
-- de dias na página pública /evolucao) também depende de `app_settings` existir
-- (ver supabase_backlog_schema.sql) para ler monitoramento_inicio. Sem essa
-- tabela a página funciona em modo degradado (timeline sem o contador de dias
-- no hero) — ver EvolucaoPage.jsx, que trata a falha de leitura de settings
-- separadamente da falha de leitura de changelog_entries.
-- ================================================

CREATE TABLE IF NOT EXISTS public.changelog_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo      TEXT NOT NULL,
  descricao   TEXT NOT NULL,
  categoria   TEXT NOT NULL
              CHECK (categoria IN ('Hardware','Sensor','Marco','Parceria','Reconhecimento','Software')),
  data        DATE NOT NULL,
  imagem_url  TEXT,
  publicado   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS changelog_entries_public_idx
  ON public.changelog_entries (publicado, data DESC);

ALTER TABLE public.changelog_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Leitura pública: só publicados. Duas policies permissivas em SELECT se
  -- somam com OR (semântica nativa do Postgres) — anon só bate na primeira;
  -- admin bate nas duas, então enxerga rascunho também.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='changelog_entries' AND policyname='changelog_select_public') THEN
    CREATE POLICY changelog_select_public ON public.changelog_entries
      FOR SELECT USING (publicado = true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='changelog_entries' AND policyname='changelog_select_admin') THEN
    CREATE POLICY changelog_select_admin ON public.changelog_entries
      FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;

  -- Escrita: só admin
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='changelog_entries' AND policyname='changelog_insert_admin') THEN
    CREATE POLICY changelog_insert_admin ON public.changelog_entries
      FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='changelog_entries' AND policyname='changelog_update_admin') THEN
    CREATE POLICY changelog_update_admin ON public.changelog_entries
      FOR UPDATE USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='changelog_entries' AND policyname='changelog_delete_admin') THEN
    CREATE POLICY changelog_delete_admin ON public.changelog_entries
      FOR DELETE USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
END $$;

-- ── Storage: bucket 'changelog' (fotos das entradas) ──────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('changelog', 'changelog', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='changelog_storage_public_read') THEN
    CREATE POLICY changelog_storage_public_read ON storage.objects
      FOR SELECT USING (bucket_id = 'changelog');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='changelog_storage_admin_insert') THEN
    CREATE POLICY changelog_storage_admin_insert ON storage.objects
      FOR INSERT WITH CHECK (
        bucket_id = 'changelog' AND
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='changelog_storage_admin_delete') THEN
    CREATE POLICY changelog_storage_admin_delete ON storage.objects
      FOR DELETE USING (
        bucket_id = 'changelog' AND
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
      );
  END IF;
END $$;
