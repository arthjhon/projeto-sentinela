-- Device registry: permanent serial (snt-NNNN) per ESP board, keyed by MAC.
-- Registry only: nothing in panel/OTA/firmware_deploys depends on it. Written exclusively by the
-- provisioning script, which calls the functions below as `postgres` (ssh + docker exec psql).
-- Idempotent: safe to re-run. Requires 20261117_sensor_health.sql (profiles). Touches no existing table.
-- MAC normalization (lowercase aa:bb:..) is the caller's job; the CHECK rejects anything else.

CREATE TABLE IF NOT EXISTS public.dispositivos (
  serial          text        PRIMARY KEY CHECK (serial ~ '^snt-[0-9]{4}$'),
  mac             text        NOT NULL UNIQUE CHECK (mac ~ '^([0-9a-f]{2}:){5}[0-9a-f]{2}$'),
  hardware        text        NOT NULL,
  situacao        text        NOT NULL CHECK (situacao IN ('reservado', 'provisionado', 'baixado')),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  provisionado_em timestamptz,
  observacao      text
);

-- Supabase default privileges grant ALL on new public tables. Neutralize: admins only SELECT
-- (through RLS); no client write path at all.
REVOKE ALL ON public.dispositivos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dispositivos TO authenticated;

ALTER TABLE public.dispositivos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dispositivos_admin_read ON public.dispositivos;
CREATE POLICY dispositivos_admin_read ON public.dispositivos
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- ---------------------------------------------------------------- functions
-- Existing MAC -> its row unchanged (error 'dispositivo_baixado' if retired).
-- New MAC -> next serial over ALL rows (incl. baixado), so a serial is never reused.
CREATE OR REPLACE FUNCTION public.dispositivo_reservar(p_mac text, p_hardware text)
RETURNS TABLE(serial text, situacao text)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.dispositivos%ROWTYPE;
  v_next integer;
BEGIN
  LOCK TABLE public.dispositivos IN EXCLUSIVE MODE;  -- serializes concurrent allocators

  SELECT * INTO v_row FROM public.dispositivos d WHERE d.mac = p_mac;
  IF FOUND THEN
    IF v_row.situacao = 'baixado' THEN
      RAISE EXCEPTION 'dispositivo_baixado' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_row.serial, v_row.situacao;
    RETURN;
  END IF;

  SELECT COALESCE(max(substr(d.serial, 5)::integer), 0) + 1 INTO v_next FROM public.dispositivos d;
  IF v_next > 9999 THEN
    RAISE EXCEPTION 'serial_esgotado' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.dispositivos (serial, mac, hardware, situacao)
  VALUES ('snt-' || lpad(v_next::text, 4, '0'), p_mac, p_hardware, 'reservado')
  RETURNING dispositivos.serial, dispositivos.situacao INTO v_row.serial, v_row.situacao;

  RETURN QUERY SELECT v_row.serial, v_row.situacao;
END;
$$;

CREATE OR REPLACE FUNCTION public.dispositivo_marcar(p_serial text, p_situacao text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.dispositivos d
     SET situacao = p_situacao,
         provisionado_em = CASE WHEN p_situacao = 'provisionado' THEN now() ELSE d.provisionado_em END
   WHERE d.serial = p_serial;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispositivo_inexistente' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- Undo of a reservation: only rows still 'reservado' are removed.
CREATE OR REPLACE FUNCTION public.dispositivo_liberar_reserva(p_serial text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.dispositivos d WHERE d.serial = p_serial AND d.situacao = 'reservado';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dispositivo_reservar(text, text),
                           public.dispositivo_marcar(text, text),
                           public.dispositivo_liberar_reserva(text)
  FROM PUBLIC, anon, authenticated;
