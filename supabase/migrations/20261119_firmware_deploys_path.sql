-- OTA via edge function: the deploy row now records the storage object name, so
-- `ota-command` builds the download URL server-side instead of trusting the browser.
-- Idempotent: safe to re-run. No backfill; old rows keep NULL and are refused (bad_path).
-- RLS unchanged: fw_insert / fw_update (admin, operador) are row-level, not column-level,
-- so the new column is covered; no column grants exist on this table.

ALTER TABLE public.firmware_deploys ADD COLUMN IF NOT EXISTS arquivo_path text;
