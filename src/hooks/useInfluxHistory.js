import { useState, useEffect } from 'react';
import { EVERY, ULTIMAS_LIMIT } from '../services/influxQueries';
import { fetchNamedPerDevice, rowsOf } from '../services/influxql';

// Histórico persistido no InfluxDB. Complementa (não substitui) o useMqtt:
// o MQTT segue entregando o tempo real; este hook traz o que já foi gravado.
//
// As chamadas vão para /influx/q/<nome> (ver services/influxql.js) — consultas
// nomeadas atendidas por um proxy (vite.config.js em dev, nginx em prod) que
// injeta o token só-leitura no lado servidor. O navegador nunca vê a credencial
// nem monta a consulta.

// Janelas do seletor. A agregação (`every`) vive em influxQueries.js — mesma
// fonte do proxy de dev e espelho do nginx —, então as chaves daqui e as
// janelas aceitas pelo servidor não podem divergir.
export const PERIODS = Object.fromEntries(
  Object.entries(EVERY).map(([key, every]) => [key, { label: key, every }]),
);

/** Série de history ([time, mean]) -> [{time: Date, value}], sem pontos nulos. */
export function mapHistorySeries(series) {
  const out = [];
  for (const row of rowsOf(series)) {
    if (row.mean == null) continue;
    const value = Number(row.mean);
    if (Number.isNaN(value)) continue;
    out.push({ time: new Date(row.time), value });
  }
  // defensivo: garante ordem cronológica (a frota inteira chega como uma série só, a média)
  return out.sort((x, y) => x.time - y.time);
}

/**
 * Junta o histórico de vários seriais da mesma bóia (uma lista de
 * mapHistorySeries por id) numa série só, em ordem cronológica. Se dois ids
 * caem na mesma janela (a troca de placa no meio de uma janela do GROUP BY),
 * o ponto vira a média simples das médias dos ids — não ponderada pelo número
 * de leituras de cada um, que a consulta nomeada não devolve.
 * @param {Array<Array<{time: Date, value: number}>>} lists
 */
export function mergeHistorySeries(lists) {
  if (lists.length === 1) return lists[0];
  const byTime = new Map();
  for (const list of lists) {
    for (const { time, value } of list) {
      const t = time.getTime();
      const acc = byTime.get(t);
      if (acc) { acc.sum += value; acc.n += 1; } else byTime.set(t, { sum: value, n: 1 });
    }
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, { sum, n }]) => ({ time: new Date(t), value: sum / n }));
}

/**
 * Busca o gráfico de um campo/período. `deviceIds` segue o contrato de
 * fetchNamedPerDevice: null = frota (uma consulta, sem device); bóia = uma
 * consulta por serial válido, unidas por mergeHistorySeries; sem serial
 * válido = [] sem consulta.
 */
export async function fetchHistory(field, period, deviceIds, { signal } = {}) {
  const perId = await fetchNamedPerDevice(
    'history', { campo: field, periodo: period }, deviceIds, { signal },
  );
  return mergeHistorySeries(perId.map(mapHistorySeries));
}

/** Série de ultimas -> [{time: Date, temperatura, ph, turbidez}], mais recente primeiro. */
export function mapUltimasSeries(series) {
  const num = (v) => (v == null || Number.isNaN(Number(v)) ? undefined : Number(v));
  return rowsOf(series)
    .map(r => ({ time: new Date(r.time), temperatura: num(r.temperatura), ph: num(r.ph), turbidez: num(r.turbidez) }))
    .filter(r => !Number.isNaN(r.time.getTime()))
    .sort((x, y) => y.time - x.time);
}

/**
 * Filtra por `topic`, e não pela tag `boia_id`, de propósito: boia_id só passou
 * a ser gravada quando foi adicionada ao telegraf.conf, então o histórico
 * anterior não a tem e sumiria do gráfico. `topic` existe em todo o histórico
 * (o mqtt_consumer sempre a grava) e é 1:1 com a bóia.
 *
 * @param {string} field     temperatura | ph | turbidez
 * @param {string} period    chave de PERIODS
 * @param {string|string[]|null} deviceIds  deviceId atual (+ anteriores, ver deviceIdsOf); null = sem bóia selecionada (frota)
 */
export function useInfluxHistory(field, period, deviceIds) {
  // chave estável: o array novo a cada render não pode refazer a busca
  const idsKey = JSON.stringify(deviceIds ?? null);
  // Estado único: data/loading/error mudam sempre juntos, e agrupá-los evita
  // três renders por transição.
  const [state, setState] = useState({ data: [], loading: false, error: null });

  useEffect(() => {
    if (!PERIODS[period] || !field) return;

    const controller = new AbortController();

    // A busca vive dentro desta função: setState no corpo do effect dispara
    // render em cascata (react-hooks/set-state-in-effect).
    async function run() {
      setState(s => ({ ...s, loading: true, error: null }));
      try {
        const data = await fetchHistory(field, period, JSON.parse(idsKey), { signal: controller.signal });
        setState({ data, loading: false, error: null });
      } catch (err) {
        // abort é troca de período/desmontagem, não falha: o efeito seguinte
        // já está buscando a janela nova
        if (err.name === 'AbortError') return;
        setState(s => ({ ...s, loading: false, error: err.message }));
      }
    }
    run();

    return () => controller.abort();
  }, [field, period, idsKey]);

  return state;
}

/**
 * Junta as últimas leituras de vários seriais: mais recente primeiro, só as
 * `limit` mais recentes no total (cada serial já veio limitado a `limit`).
 */
export function mergeUltimas(lists, limit = ULTIMAS_LIMIT) {
  return lists.flat().sort((x, y) => y.time - x.time).slice(0, limit);
}

/**
 * Últimas 50 leituras brutas (sem agregação) de uma bóia, mais recentes primeiro,
 * somando o serial atual e os anteriores (uma consulta `ultimas` por id).
 * Mesmo filtro por `topic` do useInfluxHistory (feito no servidor). Não há
 * `ultimas` da frota: `null`, [] ou só ids inválidos = [] sem consulta.
 * @param {string|string[]|null} deviceIds
 * @param {{periodo?: '24h'|'30d', signal?: AbortSignal}} [opts]
 */
export async function fetchUltimasLeituras(deviceIds, { periodo = '24h', signal } = {}) {
  if (deviceIds == null) return [];
  const perId = await fetchNamedPerDevice('ultimas', { periodo }, deviceIds, { signal });
  return mergeUltimas(perId.map(mapUltimasSeries));
}

const STATUS_CAMPOS = ['rssi', 'mqtt_latency', 'free_heap'];

/** Série de status -> [{time: number (ms), rssi, mqtt_latency, free_heap}], campo ausente = null. */
export function mapStatusSeries(series) {
  const num = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
  return rowsOf(series)
    .map(r => ({ time: Number(r.time), rssi: num(r.rssi), mqtt_latency: num(r.mqtt_latency), free_heap: num(r.free_heap) }))
    .filter(r => Number.isFinite(r.time));
}

/**
 * Junta o status de vários seriais por janela: rssi e latência = média simples
 * das médias dos ids; heap = o menor (pior caso). Ids sem valor no campo não entram.
 */
export function mergeStatusSeries(lists) {
  const byTime = new Map();
  for (const row of lists.flat()) {
    const acc = byTime.get(row.time) ?? { time: row.time, rssi: [], mqtt_latency: [], free_heap: [] };
    for (const c of STATUS_CAMPOS) if (row[c] != null) acc[c].push(row[c]);
    byTime.set(row.time, acc);
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return [...byTime.values()]
    .sort((a, b) => a.time - b.time)
    .map(a => ({
      time: a.time,
      rssi: mean(a.rssi),
      mqtt_latency: mean(a.mqtt_latency),
      free_heap: a.free_heap.length ? Math.min(...a.free_heap) : null,
    }));
}

/**
 * Saúde da placa (RSSI, latência MQTT, heap livre mínimo) por janela de PERIODS,
 * somando o serial atual e os anteriores (uma consulta `status` por id, em
 * sequência). Não há status da frota: `null`, [] ou só ids inválidos = [] sem consulta.
 * @param {string|string[]|null} deviceIds
 * @param {string} periodo  chave de PERIODS
 * @param {{signal?: AbortSignal}} [opts]
 */
export async function fetchStatusHistory(deviceIds, periodo, { signal } = {}) {
  if (deviceIds == null) return [];
  const perId = await fetchNamedPerDevice('status', { periodo }, deviceIds, { signal });
  return mergeStatusSeries(perId.map(mapStatusSeries));
}
