// Cliente das consultas nomeadas do InfluxDB (/influx/q/<nome>). O navegador
// nunca monta InfluxQL: manda só o nome e parâmetros validados; o proxy
// (nginx em produção, vite.config.js em dev) monta a consulta fixa.
import { QUERY_NAMES, DEVICE_RE } from './influxQueries';
import { deviceScope } from '../utils/deviceIds';

/**
 * Normaliza a resposta JSON do InfluxDB v1 em uma lista plana de séries.
 * Erro do Influx pode vir com HTTP 200 (results[i].error) ou no topo ({error}).
 * @returns {Array<{name: string, tags?: object, columns: string[], values: any[][]}>}
 * @throws {Error} com a mensagem do Influx
 */
export function parseInfluxQLResponse(json) {
  if (json?.error) throw new Error(String(json.error));
  const out = [];
  for (const result of json?.results ?? []) {
    if (result.error) throw new Error(String(result.error));
    for (const s of result.series ?? []) {
      const serie = { name: s.name, columns: s.columns ?? [], values: s.values ?? [] };
      if (s.tags) serie.tags = s.tags;
      out.push(serie);
    }
  }
  return out;
}

/**
 * GET /influx/q/<name>?<params>. Valida nome e device antes de enviar.
 * @param {string} name   um de QUERY_NAMES
 * @param {object} params parâmetros da consulta; undefined/'' são omitidos
 * @param {{signal?: AbortSignal}} [opts]
 */
export async function fetchNamed(name, params = {}, { signal } = {}) {
  if (!QUERY_NAMES.includes(name)) throw new Error(`consulta desconhecida: ${name}`);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  const device = qs.get('device');
  if (device !== null && !DEVICE_RE.test(device)) throw new Error('parâmetro inválido: device');

  const query = qs.toString();
  const res = await fetch(`/influx/q/${name}${query ? `?${query}` : ''}`, { signal });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error ?? ''; } catch { /* corpo não-JSON */ }
    throw new Error(`Influx ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return parseInfluxQLResponse(await res.json());
}

/**
 * Uma consulta nomeada no escopo de uma bóia que pode ter trocado de serial.
 * As consultas do nginx são de um device só (sem lista, sem `q` livre), então
 * a união é feita aqui: uma chamada por id, e quem chama junta os resultados.
 *
 * Contrato de `deviceIds` (ver deviceScope em utils/deviceIds.js):
 * - `null`/`undefined` = frota: UMA chamada, sem `device`;
 * - string/array = só aquela bóia: uma chamada por id válido; sem id válido,
 *   nenhuma chamada e resultado vazio (falha fechado, nunca a frota).
 *
 * Em sequência, não em paralelo: o nginx limita conexões simultâneas por IP
 * (3, somando todos os endpoints) e o export a 1 no servidor inteiro; em
 * paralelo, uma bóia com vários seriais tomaria 429. Qualquer falha rejeita o
 * todo: histórico parcial (só um dos seriais) pareceria completo.
 *
 * @param {string} name      um de QUERY_NAMES
 * @param {object} params    parâmetros da consulta, sem `device`
 * @param {string|string[]|null|undefined} deviceIds
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<Array<Array<object>>>} as séries de cada chamada, na ordem dos ids
 */
export async function fetchNamedPerDevice(name, params, deviceIds, opts = {}) {
  const base = { ...params };
  delete base.device;
  const ids = deviceScope(deviceIds);
  if (ids === null) return [await fetchNamed(name, base, opts)];
  const out = [];
  for (const device of ids) out.push(await fetchNamed(name, { ...base, device }, opts));
  return out;
}

/** Linhas de uma série como objetos {coluna: valor}. */
export function rowsOf(series) {
  const rows = [];
  for (const s of series) {
    for (const v of s.values) {
      rows.push(Object.fromEntries(s.columns.map((c, i) => [c, v[i]])));
    }
  }
  return rows;
}
