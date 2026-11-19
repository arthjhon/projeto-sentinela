import { describe, it, expect } from 'vitest';
import { parsePrimeira } from './useDiasMonitorados';

describe('parsePrimeira', () => {
  it('devolve a data da leitura mais antiga', () => {
    const series = [{ columns: ['time', 'first'], values: [[5000, 7], [2000, 7.1]] }];
    expect(parsePrimeira(series)).toEqual(new Date(2000));
  });
  it('sem séries = null', () => {
    expect(parsePrimeira([])).toBeNull();
  });
});
