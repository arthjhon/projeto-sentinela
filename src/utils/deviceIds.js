// Helpers puros (sem Supabase) para o histórico de uma bóia que trocou de
// número de série. Os ids são interpolados em strings Flux: só passa o que
// casa com DEVICE_ID_RE, o mesmo formato aceito pelo broker.
export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** string | string[] -> ids válidos, sem duplicata, na ordem dada. */
export function normalizeDeviceIds(input) {
  const list = Array.isArray(input) ? input : [input];
  const out = [];
  for (const id of list) {
    if (typeof id === 'string' && DEVICE_ID_RE.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** [deviceId atual, ...deviceIdsAnteriores] — só ids válidos, sem duplicata. */
export function deviceIdsOf(buoy) {
  return normalizeDeviceIds([buoy?.deviceId, ...(buoy?.deviceIdsAnteriores ?? [])]);
}

/**
 * Troca o deviceId da entrada guardando o antigo em `deviceIdsAnteriores`
 * (histórico do Influx continua sob o tópico antigo). O novo id sai da lista.
 */
export function applyDeviceIdChange(entry, newDeviceId) {
  const old = entry.deviceId || null;
  const next = newDeviceId || null;
  if (old === next) return entry;
  const prev = (entry.deviceIdsAnteriores ?? []).filter(id => id && id !== next);
  if (old && !prev.includes(old)) prev.push(old);
  return { ...entry, deviceId: next, deviceIdsAnteriores: prev };
}

/**
 * Linha Flux que filtra `topic` pela união dos ids.
 * Contrato explícito: `null`/`undefined` = sem bóia selecionada (consulta da
 * frota inteira, sem filtro). Qualquer outro valor (string ou array, inclusive
 * vazio ou só com ids inválidos) = uma bóia foi selecionada, e falha fechado:
 * sem ids válidos o filtro não casa nada, nunca "todas as bóias".
 */
export function topicFilterFlux(input, suffix = 'sensores') {
  if (input == null) return '';
  const ids = normalizeDeviceIds(input);
  if (!ids.length) return '|> filter(fn: (r) => false)';
  return `|> filter(fn: (r) => ${ids.map(id => `r.topic == "${id}/${suffix}"`).join(' or ')})`;
}
