-- ================================================
-- Fecha o buraco de RLS que a conta demo (role visualizador) expõe:
-- maintenance_logs, sensor_calibrations e firmware_deploys aceitavam
-- escrita de QUALQUER autenticado (auth.role() = 'authenticated'), não só
-- admin/operador. Nunca foi problema na prática porque só admins tinham
-- conta — passa a ser um buraco real assim que uma conta visualizador
-- existir.
--
-- changelog_entries, app_settings e os buckets de Storage (changelog,
-- firmware) já exigem profiles.role = 'admin' nas policies de escrita —
-- não precisam de mudança, o que automaticamente também exclui visualizador.
--
-- Cole e execute no SQL Editor do Supabase. Idempotente (DROP + CREATE).
-- ================================================

DROP POLICY IF EXISTS mlogs_insert ON public.maintenance_logs;
CREATE POLICY mlogs_insert ON public.maintenance_logs
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'operador'))
  );

DROP POLICY IF EXISTS mlogs_update ON public.maintenance_logs;
CREATE POLICY mlogs_update ON public.maintenance_logs
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'operador'))
  );

DROP POLICY IF EXISTS calib_insert ON public.sensor_calibrations;
CREATE POLICY calib_insert ON public.sensor_calibrations
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'operador'))
  );

DROP POLICY IF EXISTS fw_insert ON public.firmware_deploys;
CREATE POLICY fw_insert ON public.firmware_deploys
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'operador'))
  );

DROP POLICY IF EXISTS fw_update ON public.firmware_deploys;
CREATE POLICY fw_update ON public.firmware_deploys
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'operador'))
  );
