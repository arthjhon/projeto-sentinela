import { getSetting, saveSetting } from './settings';
import { FLEET } from '../config/fleet';

export const MAP_BUOYS_KEY = 'map_buoys';

// Rótulo de exibição de cada valor de `lagoa` (o registro só guarda a chave).
export const LAGOA_LABEL = { mundau: 'Lagoa Mundaú', manguaba: 'Lagoa Manguaba' };

// Semente usada só se `map_buoys` nunca foi salvo — e como fallback quando o
// registro não pode ser lido (ver useBuoyRegistry). Coordenadas decimais — não
// convertidas de FLEET.coordinates (string GMS), pra não arriscar erro de
// parsing/sinal num dado que já existe correto em produção (mesmas
// coordenadas hoje hardcoded em InteractiveMap.jsx).
export const SEED_BUOYS = [
  { codigo: 'SM-01', nome: 'Bóia Mundaú Centro', lagoa: 'mundau',   lat: -9.6559, lng: -35.7701, deviceId: FLEET.find(f => f.id === 'SM-01')?.deviceId ?? null },
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
    .filter(b => b.deviceId)
    .flatMap(b => suffixes.map(s => `${b.deviceId}/${s}`));
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

/**
 * Reconcilia as linhas locais do painel (localStorage: sensores mock, bateria,
 * status...) com o registro, que é a fonte de verdade da identidade de cada
 * bóia: uma linha por entrada, na ordem do registro, com código/nome/deviceId
 * vindos dele. Entrada sem linha local ganha `makeRow(entry)`; linha local cujo
 * código não está no registro (apagada em outra sessão) sai da lista.
 */
export function mergeRegistryIntoRows(rows, registry, makeRow) {
  return registry.map(entry => ({
    ...(rows.find(r => r.id === entry.codigo) ?? makeRow(entry)),
    id: entry.codigo,
    name: entry.nome,
    deviceId: entry.deviceId ?? '',
  }));
}
