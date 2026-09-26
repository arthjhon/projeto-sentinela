// Raio de "coleta" desenhado ao redor de cada bóia no mapa (anéis do heatmap).
// O admin ajusta só o anel externo, em metros; os internos mantêm a proporção
// que o mapa sempre teve (1000 / 550 / 220 m).

export const DEFAULT_COLLECTION_RADIUS_M = 1000;
export const MIN_COLLECTION_RADIUS_M = 100;
export const MAX_COLLECTION_RADIUS_M = 5000;

const RING_RATIOS = [
  { ratio: 1,    fillOpacity: 0.05 },
  { ratio: 0.55, fillOpacity: 0.10 },
  { ratio: 0.22, fillOpacity: 0.20 },
];

/** Valor salvo (ou digitado) → raio válido em metros; fora da faixa ou inválido → padrão. */
export function normalizeCollectionRadius(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < MIN_COLLECTION_RADIUS_M || n > MAX_COLLECTION_RADIUS_M) {
    return DEFAULT_COLLECTION_RADIUS_M;
  }
  return Math.round(n);
}

/** Anéis (do maior para o menor) para um raio externo em metros. */
export function collectionRings(outerRadiusM) {
  const outer = normalizeCollectionRadius(outerRadiusM);
  return RING_RATIOS.map(r => ({ radius: Math.round(outer * r.ratio), fillOpacity: r.fillOpacity }));
}
