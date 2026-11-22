import { EVERY } from '../services/influxQueries';
import { estadoMeta, ESTADO_META, TONE_RANK } from '../services/sensorHealth';

// Lógica pura do painel admin (visão geral). Sem React, sem I/O.

/** Online (LWT) sem leitura há mais que isto vira 'sem-leitura'. */
export const SEM_LEITURA_MS = 60000;

/**
 * Conexão da bóia. LWT 'offline' prevalece; LWT 'online' sem leitura recente é
 * 'sem-leitura'; sem LWT (ainda não chegou) vale a leitura: recente = online,
 * senão 'desconhecido'.
 */
export function estadoConexao({ lwt, ultimaLeituraMs, agoraMs }) {
  const recente = Number.isFinite(ultimaLeituraMs) && agoraMs - ultimaLeituraMs <= SEM_LEITURA_MS;
  if (lwt === 'offline') return 'offline';
  if (lwt === 'online') return recente ? 'online' : 'sem-leitura';
  return recente ? 'online' : 'desconhecido';
}

/** Só número finito ou string numérica não vazia; '' , true, NaN e Infinity viram null. */
export function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Valor atual de um campo: MQTT (ao vivo) se trouxer o campo; senão a leitura
 * gravada mais recente que o tenha (`ultimas`: mais recente primeiro; `time`
 * pode ser ms ou Date). Zero é valor válido; nunca devolve 0 por falta de dado.
 */
export function valorAtual({ mqtt, ultimas } = {}, campo) {
  const ao = num(mqtt?.[campo]);
  if (ao !== null) return { valor: ao, fonte: 'ao-vivo', em: num(mqtt._recebidoEm) };
  for (const r of ultimas ?? []) {
    const v = num(r?.[campo]);
    if (v !== null) return { valor: v, fonte: 'gravada', em: num(+r.time) };
  }
  return { valor: null, fonte: null, em: null };
}

const PERIODO_MS = { '1h': 3600e3, '24h': 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3 };
const EVERY_MS = { '30s': 30e3, '10m': 600e3, '1h': 3600e3, '6h': 6 * 3600e3 };

/** Janelas com valor ÷ janelas do período (duração ÷ EVERY), em [0,1]; período desconhecido = null. */
export function disponibilidade(serie, periodo) {
  const dur = PERIODO_MS[periodo];
  const passo = EVERY_MS[EVERY[periodo]];
  if (!dur || !passo) return null;
  const com = (serie ?? []).length;
  return Math.min(1, com / (dur / passo));
}

/**
 * Disponibilidade só da série do período PEDIDO: `historico` = estado do
 * useInfluxHistory ({data, loading, error, chave}); `chave` = chaveHistorico do
 * que o painel pede agora. Série ainda não buscada (montagem), de outro período
 * ou campo, carregando ou com erro = null (a UI mostra "calculando…"), nunca 0%.
 */
export function disponibilidadeDoPeriodo(historico, chave, periodo) {
  if (!historico || historico.loading || historico.error || historico.chave !== chave) return null;
  return disponibilidade(historico.data, periodo);
}

/** Qualidade do RSSI (dBm). */
export function qualidadeSinal(rssi) {
  const v = num(rssi);
  if (v === null) return 'sem leitura';
  if (v >= -60) return 'ótimo';
  if (v >= -70) return 'bom';
  if (v >= -80) return 'fraco';
  return 'muito fraco';
}

/** Bóia selecionada pela URL; inválida/ausente cai na primeira e pede correção da URL. */
export function resolverSelecao(buoys, codigoUrl) {
  if (!buoys?.length) return { codigo: null, corrigir: false };
  if (codigoUrl && buoys.some((b) => b.codigo === codigoUrl)) return { codigo: codigoUrl, corrigir: false };
  return { codigo: buoys[0].codigo, corrigir: true };
}

// ESTADO_META não traz gravidade explícita; ordena pelo tom (mesma escala de
// sensorHealth: bad > warn > info > neutral > ok). Empate no mesmo tom: o estado
// que aparece primeiro em ESTADO_META (falha antes de sem_dados). Estado
// desconhecido cai em 'neutral' via estadoMeta.
const ORDEM = Object.keys(ESTADO_META);
const gravidade = (estado) => TONE_RANK[estadoMeta(estado).tone] * 100 - (ORDEM.indexOf(estado) + 1 || ORDEM.length + 1);

/** Pior estado entre as linhas de sensor_health; sem linhas = null. */
export function piorSaude(healthRows) {
  let pior = null;
  for (const r of healthRows ?? []) {
    if (pior === null || gravidade(r.estado) > gravidade(pior)) pior = r.estado;
  }
  return pior;
}
