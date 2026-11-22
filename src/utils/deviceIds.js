import { DEVICE_RE } from '../services/influxQueries';

// Helpers puros (sem Supabase) para o histórico de uma bóia que trocou de
// número de série. Cada id vira o parâmetro `device` de uma consulta nomeada
// (/influx/q/*): só passa o que casa com DEVICE_ID_RE, o mesmo formato aceito
// pelo broker e pelo proxy (fonte única: DEVICE_RE de influxQueries.js).
export const DEVICE_ID_RE = DEVICE_RE;

/** string | string[] -> ids válidos, sem duplicata, na ordem dada. */
export function normalizeDeviceIds(input) {
  const list = Array.isArray(input) ? input : [input];
  const out = [];
  for (const id of list) {
    if (typeof id === 'string' && DEVICE_ID_RE.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Serial atual da bóia se estiver no formato aceito (DEVICE_ID_RE); senão null. Card, painel e MQTT usam este. */
export function serialValido(buoy) {
  const id = buoy?.deviceId;
  return typeof id === 'string' && DEVICE_ID_RE.test(id) ? id : null;
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
 * Escopo de uma consulta do histórico. Contrato explícito: `null`/`undefined`
 * = sem bóia selecionada (frota inteira, devolve null). Qualquer outro valor
 * (string ou array, inclusive vazio ou só com ids inválidos) = uma bóia foi
 * selecionada, e falha fechado: devolve só os ids válidos, possivelmente [],
 * e [] significa "nada", nunca "todas as bóias".
 * @returns {string[]|null}
 */
export function deviceScope(input) {
  return input == null ? null : normalizeDeviceIds(input);
}

/**
 * Entrada a gravar numa edição do registro: tudo vem de `edited`, exceto os
 * dois campos de serial, derivados do registro guardado (`previous`). Sem
 * `previous` (cadastro novo) não há anteriores.
 */
export function mergeRegistryEdit(previous, edited) {
  if (!previous) return edited;
  return {
    ...edited,
    ...applyDeviceIdChange(
      { deviceId: previous.deviceId ?? null, deviceIdsAnteriores: previous.deviceIdsAnteriores ?? [] },
      edited.deviceId,
    ),
  };
}
