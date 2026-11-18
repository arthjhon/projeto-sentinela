import { supabase } from '../lib/supabase';
import { jobStaleness, jobTitle } from './sensorHealth';

// Modelo de estado da página/selo de status. Funções puras no topo; fetchers no fim.
// `nao_monitorado` é só de frontend (itens sem sonda) e nunca entra no pior estado.

export const STATE_RANK = { ok: 0, desconhecido: 1, degradado: 2, falha: 3 };

export const STALE_AFTER_MS = 180_000;
export const SLOW_MS = 2000;

const toMs = (t) => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : new Date(t).getTime());

/** Pior estado da lista; vazia (ou só nao_monitorado) vira 'desconhecido'. */
export function worstState(states) {
  let worst = null;
  for (const s of states ?? []) {
    if (!(s in STATE_RANK)) continue;
    if (worst === null || STATE_RANK[s] > STATE_RANK[worst]) worst = s;
  }
  return worst ?? 'desconhecido';
}

/** Linha do worker velha demais (ou sem data) deixa de valer: vira desconhecido. */
export function applyStaleness(rows, now = new Date(), maxAgeMs = STALE_AFTER_MS) {
  const n = toMs(now);
  return (rows ?? []).map((r) => {
    if (r.estado === 'nao_monitorado') return r;
    const t = r.verificado_em ? new Date(r.verificado_em).getTime() : NaN;
    if (Number.isFinite(t) && n - t <= maxAgeMs) return r;
    return { ...r, estado: 'desconhecido', detalhe: 'status desatualizado — worker parado?' };
  });
}

export function classifySupabaseHealth({ ok, status, elapsedMs, error } = {}) {
  if (error) return { estado: 'falha', detalhe: `Sem resposta: ${error}` };
  if (!ok || status !== 200) return { estado: 'falha', detalhe: `HTTP ${status || 'erro'}` };
  if (elapsedMs > SLOW_MS) return { estado: 'degradado', detalhe: `Resposta lenta (${Math.round(elapsedMs)} ms)` };
  return { estado: 'ok', detalhe: `${Math.round(elapsedMs ?? 0)} ms` };
}

/** Jobs do worker como componentes: atrasado ou ok=false → falha; nota parcial → ok com detalhe. */
export function jobsToStatus(jobs, now = new Date()) {
  return jobStaleness(jobs, now).map((j, i) => {
    const bad = j.atrasado || j.ok === false;
    return {
      componente: `job_${j.job}`,
      estado: bad ? 'falha' : 'ok',
      detalhe: jobTitle(j) ?? null,
      verificado_em: jobs[i]?.ultima_execucao ?? jobs[i]?.ultimo_sucesso ?? null,
    };
  });
}

const MIN = 60_000;

/** Estado de uma bóia (só na página, depende de MQTT). Bancada nunca é falha. */
export function buoyStatus({ modo, deviceId, availability, lastMessageAt, now = new Date() }) {
  if (!deviceId) return { estado: 'desconhecido', detalhe: 'sem hardware' };
  const t = lastMessageAt ? toMs(lastMessageAt) : NaN;
  const age = Number.isFinite(t) ? toMs(now) - t : Infinity;
  const offline = availability === 'offline' || age > 5 * MIN;
  if (modo === 'bancada') {
    return offline
      ? { estado: 'desconhecido', detalhe: 'bancada — offline é normal' }
      : { estado: 'ok', detalhe: 'bancada — online' };
  }
  if (availability === 'offline') return { estado: 'falha', detalhe: 'Offline (LWT)' };
  if (!Number.isFinite(age)) return { estado: 'falha', detalhe: 'Sem mensagens recebidas' };
  if (age > 5 * MIN) return { estado: 'falha', detalhe: 'Sem mensagens há mais de 5 min' };
  if (age > MIN) return { estado: 'degradado', detalhe: `Última mensagem há ${Math.round(age / MIN)} min` };
  return { estado: 'ok', detalhe: null };
}

/** Broker MQTT (só na página): conectado ok; caído ≤ 30 s degradado; > 30 s falha. */
export function mqttBrokerStatus(connected, disconnectedSinceMs, now = Date.now()) {
  if (connected) return { estado: 'ok', detalhe: 'Conectado' };
  const down = Number.isFinite(disconnectedSinceMs) ? toMs(now) - disconnectedSinceMs : 0;
  if (down > 30_000) return { estado: 'falha', detalhe: `Desconectado há ${Math.round(down / 1000)} s` };
  return { estado: 'degradado', detalhe: 'Conectando / reconectando…' };
}

/**
 * Selo do cabeçalho. `supabase` = {estado} (auth + REST combinados) ou null antes da primeira
 * rodada; `rows` = system_status já após staleness; `jobs` = saída de jobsToStatus.
 * desconhecido (worker parado) aparece como 'degradado': nunca verde.
 */
export function badgeState({ supabase: sb, rows, jobs }) {
  if (!sb) return 'verificando';
  const w = worstState([sb.estado, ...(rows ?? []).map((r) => r.estado), ...(jobs ?? []).map((j) => j.estado)]);
  return w === 'ok' ? 'ok' : w === 'falha' ? 'falha' : 'degradado';
}

export const BADGE_META = {
  ok:          { label: 'Operacional', tone: 'green' },
  degradado:   { label: 'Degradado',   tone: 'amber' },
  falha:       { label: 'Falha',       tone: 'red' },
  verificando: { label: 'Verificando…', tone: 'neutral' },
};

// ── Fetchers ────────────────────────────────────────────────────────────

export const REST_TIMEOUT_MS = 5000;

/** Rejeita com Error('timeout') se a promessa não resolver em `ms` (rede em buraco negro). */
export function withTimeout(promise, ms = REST_TIMEOUT_MS) {
  let timer;
  const t = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

export async function fetchSystemStatus(timeoutMs = REST_TIMEOUT_MS) {
  const { data, error } = await supabase.from('system_status').select('*')
    .abortSignal(AbortSignal.timeout(timeoutMs));
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchJobsTimed(timeoutMs = REST_TIMEOUT_MS) {
  const { data, error } = await supabase.from('worker_jobs').select('*')
    .abortSignal(AbortSignal.timeout(timeoutMs));
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Leitura REST completa com timeout; nunca rejeita: {rows, jobs} ou {error}. */
export async function fetchRest(timeoutMs = REST_TIMEOUT_MS) {
  try {
    const [rows, jobs] = await withTimeout(
      Promise.all([fetchSystemStatus(timeoutMs), fetchJobsTimed(timeoutMs)]), timeoutMs + 500);
    return { rows, jobs };
  } catch (error) {
    return { error };
  }
}

/** Resultado de uma rodada → estado do contexto (puro). */
export function buildSnapshot({ auth, rest, now = new Date() }) {
  const restFailed = Boolean(rest.error);
  const sb = {
    auth: classifySupabaseHealth(auth),
    rest: restFailed
      ? { estado: 'falha', detalhe: String(rest.error?.message ?? rest.error).slice(0, 200) }
      : { estado: 'ok', detalhe: null },
  };
  sb.estado = worstState([sb.auth.estado, sb.rest.estado]);
  if (restFailed) return { loading: false, supabase: sb, rows: null, jobs: null };
  let rows = applyStaleness(rest.rows, now);
  if (!(rest.rows ?? []).length && !(rest.jobs ?? []).length) {
    rows = [{ componente: 'worker', estado: 'desconhecido', detalhe: 'worker ainda não reportou', verificado_em: null }];
  }
  return { loading: false, supabase: sb, rows, jobs: jobsToStatus(rest.jobs, now) };
}

/** Falha inesperada da rodada → estado do contexto, mesmo formato do caminho normal. */
export function buildErrorSnapshot(e, checkedAt = Date.now()) {
  const detalhe = String(e?.message ?? e).slice(0, 200);
  const falha = { estado: 'falha', detalhe };
  return { loading: false, supabase: { auth: falha, rest: falha, ...falha }, rows: null, jobs: null, checkedAt };
}

export const MQTT_GRACE_MS = 15_000;

/** Bóia de campo não é julgada enquanto o broker não conectou há ≥ 15 s (evita flash vermelho). */
export function inMqttGrace(connected, connectedSinceMs, now = Date.now()) {
  if (!connected || !Number.isFinite(connectedSinceMs)) return true;
  return toMs(now) - connectedSinceMs < MQTT_GRACE_MS;
}

/** Uma rodada por vez; só o resultado da rodada mais recente vale. */
export function createPollGuard() {
  let seq = 0;
  let inFlight = false;
  return {
    start() { if (inFlight) return null; inFlight = true; return ++seq; },
    isLatest(token) { return token === seq; },
    finish() { inFlight = false; },
  };
}

export async function checkSupabaseAuth(timeoutMs = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = performance.now();
  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
      signal: ctrl.signal,
    });
    return { ok: res.ok, status: res.status, elapsedMs: performance.now() - start };
  } catch (e) {
    const timedOut = e?.name === 'AbortError';
    return { ok: false, status: 0, elapsedMs: performance.now() - start, error: timedOut ? 'timeout' : (e?.message ?? 'erro de rede') };
  } finally {
    clearTimeout(timer);
  }
}
