import { describe, it, expect } from 'vitest';
import {
  collectionRings, normalizeCollectionRadius,
  DEFAULT_COLLECTION_RADIUS_M, MIN_COLLECTION_RADIUS_M, MAX_COLLECTION_RADIUS_M,
} from './collectionRadius';

describe('normalizeCollectionRadius', () => {
  it('aceita valores na faixa e arredonda', () => {
    expect(normalizeCollectionRadius(1500)).toBe(1500);
    expect(normalizeCollectionRadius('750.4')).toBe(750);
    expect(normalizeCollectionRadius(MIN_COLLECTION_RADIUS_M)).toBe(MIN_COLLECTION_RADIUS_M);
    expect(normalizeCollectionRadius(MAX_COLLECTION_RADIUS_M)).toBe(MAX_COLLECTION_RADIUS_M);
  });

  it('cai no padrão para inválido ou fora da faixa', () => {
    for (const v of [undefined, null, '', 'abc', NaN, 0, -10, MIN_COLLECTION_RADIUS_M - 1, MAX_COLLECTION_RADIUS_M + 1]) {
      expect(normalizeCollectionRadius(v)).toBe(DEFAULT_COLLECTION_RADIUS_M);
    }
  });
});

describe('collectionRings', () => {
  it('desenha os anéis com o raio padrão (200 / 110 / 44 m)', () => {
    expect(collectionRings(DEFAULT_COLLECTION_RADIUS_M)).toEqual([
      { radius: 200, fillOpacity: 0.05 },
      { radius: 110, fillOpacity: 0.10 },
      { radius: 44,  fillOpacity: 0.20 },
    ]);
  });

  it('escala os anéis proporcionalmente ao raio externo (proporção original 1000/550/220)', () => {
    expect(collectionRings(1000).map(r => r.radius)).toEqual([1000, 550, 220]);
    expect(collectionRings(2000).map(r => r.radius)).toEqual([2000, 1100, 440]);
  });

  it('usa o padrão quando o raio é inválido', () => {
    expect(collectionRings('x').map(r => r.radius)).toEqual([200, 110, 44]);
  });
});
