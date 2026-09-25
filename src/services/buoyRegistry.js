import { getSetting, saveSetting } from './settings';
import { FLEET } from '../config/fleet';

export const MAP_BUOYS_KEY = 'map_buoys';

// Semente usada só se `map_buoys` nunca foi salvo. Coordenadas decimais — não
// convertidas de FLEET.coordinates (string GMS), pra não arriscar erro de
// parsing/sinal num dado que já existe correto em produção (mesmas
// coordenadas hoje hardcoded em InteractiveMap.jsx).
const SEED_BUOYS = [
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
