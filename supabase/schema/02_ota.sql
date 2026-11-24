-- ================================================
-- OTA — Bucket de Firmware no Supabase Storage
-- Cole e execute no SQL Editor do Supabase
-- ================================================

-- 1. Cria o bucket público para armazenar os binários
INSERT INTO storage.buckets (id, name, public)
VALUES ('firmware', 'firmware', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Qualquer usuário autenticado pode ler (o ESP32 vai baixar via URL pública)
CREATE POLICY "Firmware public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'firmware');

-- 3. Apenas Administradores podem fazer upload de novos firmwares
CREATE POLICY "Admins upload firmware"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'firmware' AND
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
);

-- 4. Apenas Administradores podem deletar firmwares antigos
CREATE POLICY "Admins delete firmware"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'firmware' AND
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
);
