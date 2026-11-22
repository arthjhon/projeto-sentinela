import { fetchNamed, rowsOf } from '../services/influxql';
import { PONTOS_PREVISAO } from '../services/influxQueries';

// Consultas do painel de clima (previsão Open-Meteo e telemetria recente da ANA).
// Só busca e normaliza: a leitura dos dados (dias locais, avisos) fica em utils/clima.js.

const num = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

const CAMPOS_PREVISAO = ['precipitation', 'precipitation_probability', 'temperature_2m', 'wind_speed_10m', 'cloud_cover'];

/**
 * Horas de previsão de um ponto (24 h passadas da coleta até +7 d), em baldes de 1 h.
 * @param {'celmm'|'bacia_mundau'} ponto
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<Array<{time:number, precipitation:number|null, precipitation_probability:number|null,
 *   temperature_2m:number|null, wind_speed_10m:number|null, cloud_cover:number|null}>>}
 */
export async function fetchPrevisao(ponto, { signal } = {}) {
  if (!PONTOS_PREVISAO.includes(ponto)) throw new Error('parâmetro inválido: ponto');
  const series = await fetchNamed('previsao', { ponto }, { signal });
  return rowsOf(series).map((row) => {
    const out = { time: Number(row.time) };
    for (const c of CAMPOS_PREVISAO) out[c] = num(row[c]);
    return out;
  });
}

/**
 * Chuva (3 d) e vazão (30 d) medidas na estação ANA da bacia do Mundaú, por hora.
 * O endpoint traz duas instruções; elas se distinguem pelas colunas ("chuva" / "vazao").
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{chuva: Array<{time:number, chuva:number|null}>, vazao: Array<{time:number, vazao:number|null}>}>}
 */
export async function fetchAnaRecente({ signal } = {}) {
  const series = await fetchNamed('ana-recente', {}, { signal });
  const doCampo = (campo) => rowsOf(series.filter((s) => s.columns.includes(campo)))
    .map((row) => ({ time: Number(row.time), [campo]: num(row[campo]) }));
  return { chuva: doCampo('chuva'), vazao: doCampo('vazao') };
}
