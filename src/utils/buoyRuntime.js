import { formatIdade } from './format';

// Formatos e diagnóstico de sensor da página Bóias. O estado de conexão vive em
// buoyConnection.js (única definição); nada de valor default "online" / 100%.

/** Coordenadas decimais do registro para exibição. */
export function formatCoords(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '--';
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** Idade de um evento ("há 4 s"); inválida = "--". Formatação em format.js. */
export function formatAge(ms) {
  return formatIdade(ms) ?? '--';
}

/** Intervalo entre as duas últimas leituras recebidas: "~5 s", "~2 min". */
export function formatInterval(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '--';
  const s = Math.round(ms / 1000);
  if (s < 60) return `~${s} s`;
  return `~${Math.round(s / 60)} min`;
}

// Leitura mais velha que isso não conta como "sensor respondendo" (o firmware
// publica a cada 5 s; 30 s tolera algumas perdas sem mascarar uma queda).
export const LEITURA_RECENTE_MS = 30_000;

/**
 * Diagnóstico de um sensor a partir da última leitura recebida nesta sessão.
 * @param {object|undefined} reading  payload de /sensores
 * @param {string} key                campo do payload (ph, turbidez, temperatura)
 * @param {number|null} ageMs         idade da leitura
 * @returns {'ok'|'sem-valor'|'sem-leitura'}
 *   sem-valor = a leitura chegou, mas sem esse campo (o firmware omite a
 *   temperatura quando o DS18B20 não responde).
 */
export function sensorDiagnosis(reading, key, ageMs) {
  if (!reading || !Number.isFinite(ageMs) || ageMs > LEITURA_RECENTE_MS) return 'sem-leitura';
  return Number.isFinite(reading[key]) ? 'ok' : 'sem-valor';
}
