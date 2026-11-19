import { describe, it, expect } from 'vitest';
import { parseCount } from './useLeiturasDia';

describe('parseCount', () => {
  it('lê o count da série', () => {
    expect(parseCount([{ columns: ['time', 'count'], values: [[0, 17280]] }])).toBe(17280);
  });
  it('janela sem nenhuma série = 0 leituras', () => {
    expect(parseCount([])).toBe(0);
  });
  it('formato inesperado ou valor inválido = null (falha, não zero)', () => {
    expect(parseCount([{ columns: ['time', 'x'], values: [[0, 1]] }])).toBeNull();
    expect(parseCount([{ columns: ['time', 'count'], values: [[0, 'abc']] }])).toBeNull();
    expect(parseCount([{ columns: ['time', 'count'], values: [] }])).toBeNull();
  });
});
