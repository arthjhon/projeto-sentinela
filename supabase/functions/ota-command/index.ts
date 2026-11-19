// Publishes `<device>/ota/command` on behalf of an admin. Browsers are anonymous
// read-only MQTT clients, so the OTA page cannot publish; this function does it
// with the broker credential `svc/ota` (ACL: write `+/ota/command` only).
//
// Flow:
//   1. Caller JWT -> profiles.role must be 'admin' (service_role client)
//   2. Load the firmware_deploys row + the buoy's deviceId (app_settings.map_buoys)
//   3. buildOtaCommand validates everything; nothing is published on failure
//   4. connect + publish (QoS 1, waits PUBACK) + end, bounded by a 10 s timeout
//
// On success the deploy row is NOT changed: the OTA page and the device's
// `ota/status` close the loop. On broker failure (502) the deploy becomes `falha`.
//
// Env: MQTT_OTA_URL, MQTT_OTA_USER, MQTT_OTA_PASS, OTA_PUBLIC_BASE_URL.
// CORS is handled by Kong (functions-v1 route).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import mqtt from 'npm:mqtt@5.10.3';
import { buildOtaCommand, findDeviceId, OtaCommandError } from './command.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MQTT_OTA_URL = Deno.env.get('MQTT_OTA_URL');
const MQTT_OTA_USER = Deno.env.get('MQTT_OTA_USER');
const MQTT_OTA_PASS = Deno.env.get('MQTT_OTA_PASS');
const OTA_PUBLIC_BASE_URL = Deno.env.get('OTA_PUBLIC_BASE_URL');

const PUBLISH_TIMEOUT_MS = 10_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function publishOnce(topic: string, payload: string): Promise<void> {
  // Create the client synchronously so the reference exists even if connect
  // never settles; it is always ended in `finally`.
  const client = mqtt.connect(MQTT_OTA_URL!, {
    username: MQTT_OTA_USER,
    password: MQTT_OTA_PASS,
    connectTimeout: PUBLISH_TIMEOUT_MS,
    reconnectPeriod: 0, // fail fast, never retry in the background
  });
  // Permanent no-op listener: the `once('error')` below is consumed by the
  // first error, and a second one (e.g. after a timeout, during endAsync)
  // would otherwise be an unhandled 'error' event that crashes the worker.
  client.on('error', () => {});
  let timer: number | undefined;
  const work = (async () => {
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('error', (err: Error) => reject(err));
      client.once('close', () => reject(new Error('mqtt connection closed')));
    });
    await client.publishAsync(topic, payload, { qos: 1 });
  })();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('mqtt timeout')), PUBLISH_TIMEOUT_MS);
  });
  try {
    await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    // `work` may still be pending after a timeout; swallow its late rejection.
    work.catch(() => {});
    // Forced end, itself bounded: never leaves the instance alive.
    let endTimer: number | undefined;
    try {
      await Promise.race([
        client.endAsync(true),
        new Promise<void>((resolve) => {
          endTimer = setTimeout(resolve, 2000);
        }),
      ]);
    } catch { /* ignore */ }
    clearTimeout(endTimer);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthenticated' }, 401);

  let body: { deploy_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const deployId = body.deploy_id;
  if (typeof deployId !== 'string' || !UUID_RE.test(deployId)) {
    return json({ error: 'invalid_deploy_id' }, 400);
  }

  if (!MQTT_OTA_URL || !MQTT_OTA_USER || !MQTT_OTA_PASS || !OTA_PUBLIC_BASE_URL) {
    console.error('ota-command: missing MQTT_OTA_* / OTA_PUBLIC_BASE_URL env');
    return json({ error: 'not_configured' }, 500);
  }

  // Caller session: only used to identify who is calling.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !caller) return json({ error: 'invalid_session' }, 401);

  // service_role only after the caller is identified.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', caller.id)
    .single();
  if (profileError || profile?.role !== 'admin') return json({ error: 'forbidden' }, 403);

  const { data: deploy, error: deployError } = await admin
    .from('firmware_deploys')
    .select('id, boia_id, versao, sha256, status, arquivo_path')
    .eq('id', deployId)
    .maybeSingle();
  if (deployError) {
    console.error('ota-command: deploy lookup failed', deployError.message);
    return json({ error: 'lookup_failed' }, 500);
  }
  if (!deploy) return json({ error: 'deploy_not_found' }, 404);

  // The buoy registry lives in app_settings.map_buoys (array of {codigo, deviceId}).
  const { data: setting, error: settingError } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'map_buoys')
    .maybeSingle();
  if (settingError) {
    console.error('ota-command: registry lookup failed', settingError.message);
    return json({ error: 'lookup_failed' }, 500);
  }
  const deviceId = findDeviceId(setting?.value, deploy.boia_id);

  let command: { topic: string; payload: string };
  try {
    command = buildOtaCommand(
      {
        status: deploy.status,
        versao: deploy.versao,
        sha256: deploy.sha256 ?? '',
        arquivo_path: deploy.arquivo_path,
        device_id: deviceId,
      },
      OTA_PUBLIC_BASE_URL,
    );
  } catch (e) {
    if (e instanceof OtaCommandError) return json({ error: e.code }, 422);
    throw e;
  }

  try {
    await publishOnce(command.topic, command.payload);
  } catch (e) {
    // Never log credentials; the message is the library error only.
    console.error('ota-command: broker failure', e instanceof Error ? e.message : 'unknown');
    const { error: markError } = await admin
      .from('firmware_deploys')
      .update({ status: 'falha', confirmado_em: new Date().toISOString() })
      .eq('id', deployId)
      .eq('status', 'pendente');
    if (markError) console.error('ota-command: could not mark deploy as falha', markError.message);
    return json({ error: 'broker_unavailable' }, 502);
  }

  return json({ ok: true });
});
