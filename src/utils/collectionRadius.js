// Raio de "coleta" desenhado ao redor de cada bóia no mapa (anéis do heatmap).
// O admin ajusta só o anel externo, em metros; os internos mantêm a proporção
// original dos anéis (1 : 0,55 : 0,22). A leitura dos sensores é pontual —
// o padrão de 200 m é só a área representativa, não o alcance do sensor.

export const DEFAULT_COLLECTION_RADIUS_M = 200;
export const MIN_COLLECTION_RADIUS_M = 25;
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

// Piso visual: no zoom inicial do mapa, 200 m viram ~5 px e somem atrás do
// marcador. O anel externo nunca é desenhado com menos que este raio em
// pixels; ao aproximar o zoom, o raio real em metros volta a mandar.
export const MIN_OUTER_RING_PX = 28;

/**
 * Raio externo efetivo (m) para desenhar: o real, ou o piso em pixels
 * convertido para metros no zoom atual — o que for maior.
 * @param {number} outerRadiusM  raio configurado, em metros
 * @param {number} metersPerPixel escala do mapa no centro da bóia
 * @param {number} [minPx]        piso em pixels (raio)
 */
export function effectiveOuterRadius(outerRadiusM, metersPerPixel, minPx = MIN_OUTER_RING_PX) {
  const outer = normalizeCollectionRadius(outerRadiusM);
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return outer;
  return Math.max(outer, Math.round(minPx * metersPerPixel));
}
