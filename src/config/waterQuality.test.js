import { describe, it, expect } from 'vitest';
import { classifyParam, computeWQI, sessionStats, histogramBins, WATER_PARAMS } from './waterQuality';

describe('classifyParam', () => {
  it('classifica pH dentro do ideal como good', () => {
    expect(classifyParam('ph', 7.5).level).toBe('good');
  });
  it('classifica pH em atenção', () => {
    expect(classifyParam('ph', 8.7).level).toBe('warning');
  });
  it('classifica pH crítico', () => {
    expect(classifyParam('ph', 9.5).level).toBe('critical');
  });
  it('classifica turbidez alta como crítica', () => {
    expect(classifyParam('turbidez', 150).level).toBe('critical');
  });
  it('retorna null para valor ausente', () => {
    expect(classifyParam('ph', null)).toBeNull();
  });
});

describe('computeWQI', () => {
  it('dá 100/BOA quando tudo está no ideal', () => {
    const r = computeWQI({ temperatura: 26, ph: 7.5, turbidez: 10 });
    expect(r.score).toBe(100);
    expect(r.level).toBe('BOA');
  });
  it('cai para RUIM quando há parâmetro crítico', () => {
    const r = computeWQI({ temperatura: 40, ph: 9.8, turbidez: 200 });
    expect(r.score).toBeLessThan(50);
    expect(r.level).toBe('RUIM');
  });
  it('retorna null sem leitura', () => {
    expect(computeWQI(null)).toBeNull();
  });
});

describe('sessionStats', () => {
  it('calcula min/max/avg por parâmetro', () => {
    const h = [
      { temperatura: 20, ph: 7, turbidez: 10 },
      { temperatura: 30, ph: 8, turbidez: 20 },
    ];
    const s = sessionStats(h);
    expect(s.temperatura).toEqual({ min: 20, max: 30, avg: 25 });
    expect(s.ph.avg).toBe(7.5);
  });
  it('ignora nulos', () => {
    const s = sessionStats([{ temperatura: null, ph: 7, turbidez: 10 }]);
    expect(s.temperatura).toBeNull();
    expect(s.ph.avg).toBe(7);
  });
});

describe('histogramBins', () => {
  it('agrupa leituras em bins', () => {
    const h = [{ ph: 6 }, { ph: 7 }, { ph: 7 }, { ph: 8 }];
    const bins = histogramBins(h, 'ph', 4);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(4);
    expect(bins.length).toBe(4);
  });
  it('retorna [] sem dados', () => {
    expect(histogramBins([], 'ph', 4)).toEqual([]);
  });
});

describe('WATER_PARAMS', () => {
  it('tem os 3 parâmetros', () => {
    expect(WATER_PARAMS.map(p => p.key)).toEqual(['temperatura', 'ph', 'turbidez']);
  });
});
