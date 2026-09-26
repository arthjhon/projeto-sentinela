import { describe, it, expect } from 'vitest';
import { computeFleetAverage } from './fleetAverage';

describe('computeFleetAverage', () => {
  it('calcula a média ignorando null/undefined', () => {
    expect(computeFleetAverage([10, 20, null, 30])).toBe(20);
  });
  it('devolve null se não houver nenhum valor', () => {
    expect(computeFleetAverage([])).toBeNull();
    expect(computeFleetAverage([null, undefined])).toBeNull();
  });
  it('arredonda para 2 casas decimais', () => {
    expect(computeFleetAverage([1, 2, 2])).toBe(1.67);
  });
});
