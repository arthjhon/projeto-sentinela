// Estado de uma bóia no painel derivado só do que é real: registro (map_buoys)
// e o que chega do firmware pelo MQTT. Nada de valor default "online" / 100%.

/**
 * @param {string|null} deviceId
 * @param {string|undefined} availability  payload do LWT (<deviceId>/availability)
 * @returns {'planejada'|'online'|'offline'|'sem-sinal'}
 *   sem-sinal = tem hardware cadastrado, mas o broker nunca recebeu o LWT dele
 *   (placa nunca conectou com esse deviceId, ou deviceId digitado errado).
 */
export function buoyStatus(deviceId, availability) {
  if (!deviceId) return 'planejada';
  if (availability === 'online') return 'online';
  if (availability === 'offline') return 'offline';
  return 'sem-sinal';
}

export const STATUS_LABEL = {
  online: 'ONLINE',
  offline: 'OFFLINE',
  planejada: 'PLANEJADA',
  'sem-sinal': 'SEM SINAL',
};

/** Coordenadas decimais do registro para exibição. */
export function formatCoords(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '--';
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** Idade de um evento: "há 4 s", "há 3 min", "há 2 h". */
export function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '--';
  const s = Math.round(ms / 1000);
  if (s < 60) return `há ${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `há ${min} min`;
  return `há ${Math.floor(min / 60)} h`;
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

/** Linhas {time: Date, ph, temperatura, turbidez} → CSV (separador ;, pt-BR). */
export function readingsToCsv(rows) {
  const num = (v) => (Number.isFinite(v) ? String(v).replace('.', ',') : '');
  const linhas = rows.map(r =>
    [r.time.toISOString(), num(r.temperatura), num(r.ph), num(r.turbidez)].join(';'));
  return ['data_hora_utc;temperatura_c;ph;turbidez_ntu', ...linhas].join('\n');
}
