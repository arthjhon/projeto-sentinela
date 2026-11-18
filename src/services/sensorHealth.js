import { supabase } from '../lib/supabase';

// Saúde dos sensores (detector do worker). Somente leitura: as tabelas são
// escritas pelo worker; a RLS libera SELECT a qualquer usuário autenticado.

export const ESTADO_META = {
  ok:                  { label: 'OK',                  tone: 'ok' },
  suspeito:            { label: 'Suspeito',            tone: 'warn' },
  falha:               { label: 'Falha',               tone: 'bad' },
  sem_dados:           { label: 'Sem dados',           tone: 'bad' },
  manutencao:          { label: 'Manutenção',          tone: 'info' },
  bancada:             { label: 'Bancada',             tone: 'neutral' },
  dados_insuficientes: { label: 'Coletando histórico', tone: 'neutral' },
  nao_cadastrado:      { label: 'Não cadastrada',      tone: 'neutral' },
};

export const DADOS_INSUFICIENTES_HINT =
  'Detector estatístico precisa de ~3 dias de dados após manutenção ou troca de modo; regras básicas seguem ativas.';

const TONE_RANK = { bad: 4, warn: 3, info: 2, neutral: 1, ok: 0 };
/** Meta de um estado; estado desconhecido mostra o valor cru em tom neutro. */
export const estadoMeta = (estado) =>
  ESTADO_META[estado] ?? { label: String(estado ?? '—'), tone: 'neutral' };
const metaOf = estadoMeta;

/** Tom de um estado; bóia de bancada é sempre neutra (precedência do registro). */
export const eventTone = (estado, modo) =>
  (modo === 'bancada' ? 'neutral' : estadoMeta(estado).tone);

/** Data legível em pt-BR; ausente/inválida vira "—". */
export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
const rank = (estado) => TONE_RANK[metaOf(estado).tone];

/**
 * Sensores de um device e o pior estado (bad > warn > info > neutral > ok).
 * `modo` do REGISTRO tem precedência: bóia de bancada nunca escala, mesmo que
 * sobre uma linha antiga de sensor_health dizendo outra coisa.
 */
export function healthForDevice(rows, deviceId, modo) {
  const mine = (rows ?? []).filter((r) => r.device_id === deviceId);
  const bancada = modo === 'bancada';
  const sensores = mine.map((r) => ({
    sensor: r.sensor,
    estado: bancada ? 'bancada' : r.estado,
    motivo: bancada ? null : (r.motivo ?? null),
    desde: r.desde,
  }));
  if (bancada && sensores.length) return { sensores, pior: 'bancada' };
  let pior = 'ok';
  for (const s of sensores) if (rank(s.estado) > rank(pior)) pior = s.estado;
  return { sensores, pior };
}

export const JOB_INTERVAL_S = { openmeteo: 3600, ana: 900, detector: 300 };

/** Job atrasado: último sucesso há mais de 3x o intervalo, ou inexistente. */
export function jobStaleness(jobs, now = new Date()) {
  return (jobs ?? []).map((j) => {
    const limite = 3 * (JOB_INTERVAL_S[j.job] ?? 900) * 1000;
    const t = j.ultimo_sucesso ? new Date(j.ultimo_sucesso).getTime() : NaN;
    const atrasado = !Number.isFinite(t) || new Date(now).getTime() - t > limite;
    return { job: j.job, atrasado, ok: j.ok, erro: j.erro ?? null };
  });
}

/**
 * Tooltip de um job no cabeçalho: erro da falha; atraso; ou, num job ok, a nota de falha
 * parcial que o worker grava em `erro` (ex.: estação secundária da ANA fora do ar).
 */
export function jobTitle(j) {
  if (j.ok === false && j.erro) return String(j.erro).slice(0, 200);
  if (j.atrasado) return 'Sem execução bem-sucedida recente';
  if (j.erro) return `Parcial: ${String(j.erro).slice(0, 200)}`;
  return undefined;
}

export async function fetchSensorHealth() {
  const { data, error } = await supabase.from('sensor_health').select('*');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchHealthEvents(deviceId, limit = 10) {
  const { data, error } = await supabase
    .from('sensor_health_events').select('*')
    .eq('device_id', deviceId)
    .order('inicio', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchWorkerJobs() {
  const { data, error } = await supabase.from('worker_jobs').select('*');
  if (error) throw new Error(error.message);
  return data ?? [];
}
