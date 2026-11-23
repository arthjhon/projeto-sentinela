import { getSetting, saveSetting } from './settings';
import { FLEET } from '../config/fleet';

import { serialValido } from '../utils/deviceIds';
export { deviceIdsOf, applyDeviceIdChange } from '../utils/deviceIds';

const MAP_BUOYS_KEY = 'map_buoys';

// Rótulo de exibição de cada valor de `lagoa` (o registro só guarda a chave).
export const LAGOA_LABEL = { mundau: 'Lagoa Mundaú', manguaba: 'Lagoa Manguaba' };

// Semente usada só se `map_buoys` nunca foi salvo — e como fallback quando o
// registro não pode ser lido (ver useBuoyRegistry). Coordenadas decimais, as mesmas
// hoje hardcoded em InteractiveMap.jsx.
export const SEED_BUOYS = [
  { codigo: 'SM-01', nome: 'Bóia Mundaú Centro', lagoa: 'mundau',   lat: -9.6559, lng: -35.7701, deviceId: FLEET.find(f => f.id === 'SM-01')?.deviceId ?? null, deviceIdsAnteriores: FLEET.find(f => f.id === 'SM-01')?.deviceIdsAnteriores ?? [] },
  { codigo: 'SM-02', nome: 'Bóia Mundaú Sul',     lagoa: 'mundau',   lat: -9.6862, lng: -35.7847, deviceId: FLEET.find(f => f.id === 'SM-02')?.deviceId ?? null },
  { codigo: 'MG-01', nome: 'Bóia Manguaba Norte', lagoa: 'manguaba', lat: -9.5873, lng: -35.8394, deviceId: FLEET.find(f => f.id === 'MG-01')?.deviceId ?? null },
];

/** Lista completa de bóias — do Supabase se já existir, senão a semente. */
export async function getBuoyRegistry() {
  return getSetting(MAP_BUOYS_KEY, SEED_BUOYS);
}

/** Substitui a lista inteira (adicionar/editar/remover = editar o array e salvar de volta). */
export async function saveBuoyRegistry(buoys) {
  return saveSetting(MAP_BUOYS_KEY, buoys);
}

/** Tópicos MQTT das bóias com deviceId, no mesmo formato de getMqttTopics (fleet.js). */
export function topicsForRegistry(buoys, suffixes = ['sensores', 'status', 'availability']) {
  return buoys
    .map(b => serialValido(b))
    .filter(Boolean)
    .flatMap(id => suffixes.map(s => `${id}/${s}`));
}

/**
 * true se `codigo` já pertence a OUTRA bóia. `codigoAtual` é o código da bóia
 * em edição (ela pode manter o próprio código); null ao cadastrar uma nova.
 * Comparação exata: o chamador passa o código já normalizado (trim), o mesmo
 * valor que vai gravar.
 */
export function codigoEmUso(codigos, codigo, codigoAtual = null) {
  return codigos.some(c => c === codigo && c !== codigoAtual);
}

/**
 * Grava `entry` na lista do registro sem mudar a ordem: substitui no lugar a
 * entrada `codigoOriginal` (edição, inclusive renomeando o código) ou acrescenta
 * ao fim (cadastro: `codigoOriginal` null). A ordem importa — "primeira com
 * deviceId" é a bóia em destaque da página pública e o foco padrão do
 * dashboard. Lança erro se o código novo já pertence a outra entrada: salvar
 * sobrescreveria aquela bóia. Atenção: um `codigoOriginal` que não está mais na
 * lista (apagada em outra sessão com o modal aberto) também é acrescentado — a
 * bóia volta; para recusar, confira a presença dele na lista antes de chamar.
 */
export function upsertRegistryEntry(list, codigoOriginal, entry) {
  if (codigoEmUso(list.map(r => r.codigo), entry.codigo, codigoOriginal)) {
    throw new Error(`já existe uma bóia com o código ${entry.codigo}`);
  }
  return list.some(r => r.codigo === codigoOriginal)
    ? list.map(r => (r.codigo === codigoOriginal ? entry : r))
    : [...list, entry];
}

export const MODOS = ['bancada', 'campo'];

/** Valor ausente/inválido vale 'bancada' (mesmo default do worker). */
export function normalizeModo(value) {
  return MODOS.includes(value) ? value : 'bancada';
}

/**
 * Normaliza `entry.modo` e mantém `modoDesde`: vira `nowIso` quando o modo muda
 * em relação a `previous` (ou no cadastro novo, previous null); se não mudou,
 * preserva `previous.modoDesde`. O worker zera as estatísticas do detector a
 * partir de `modoDesde` quando o modo muda.
 */
export function withModo(previous, entry, nowIso) {
  const modo = normalizeModo(entry.modo);
  const { modoDesde: _descartado, ...rest } = entry;
  if (!previous || normalizeModo(previous.modo) !== modo) {
    return { ...rest, modo, modoDesde: nowIso };
  }
  return previous.modoDesde ? { ...rest, modo, modoDesde: previous.modoDesde } : { ...rest, modo };
}

const CODIGOS_RESERVADOS = ['frota', 'firmware'];

/**
 * Motivo pelo qual o código geraria uma ficha inalcançável em /admin/boias/:codigo
 * (rotas irmãs do painel, ou segmento que o roteador não casa); null se serve.
 */
export function motivoCodigoInvalido(codigo) {
  if (CODIGOS_RESERVADOS.includes(String(codigo).toLowerCase())) {
    return `O código "${codigo}" é reservado pelo painel.`;
  }
  const c = String(codigo);
  if (c.includes('/') || c === '.' || c === '..') {
    return 'O código não pode conter "/" nem ser "." ou "..".';
  }
  return null;
}
