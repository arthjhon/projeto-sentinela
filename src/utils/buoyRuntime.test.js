import { describe, it, expect } from 'vitest';
import {
  formatCoords, formatAge, formatInterval, sensorDiagnosis,
} from './buoyRuntime';
import { SEM_LEITURA_MS } from './buoyConnection';

describe('formatos', () => {
  it('coordenadas', () => {
    expect(formatCoords(-9.6559, -35.7701)).toBe('-9.65590, -35.77010');
    expect(formatCoords(undefined, -35)).toBe('--');
  });
  it('idade', () => {
    expect(formatAge(4_200)).toBe('há 4 s');
    expect(formatAge(3 * 60_000 + 5_000)).toBe('há 3 min');
    expect(formatAge(2 * 3_600_000)).toBe('há 2 h');
    expect(formatAge(null)).toBe('--');
    expect(formatAge(-1)).toBe('agora');
    expect(formatAge(-5_000)).toBe('agora');
  });
  it('intervalo', () => {
    expect(formatInterval(5_020)).toBe('~5 s');
    expect(formatInterval(120_000)).toBe('~2 min');
    expect(formatInterval(null)).toBe('--');
    expect(formatInterval(0)).toBe('--');
  });
});

describe('sensorDiagnosis', () => {
  it('usa o limiar único da conexão (60 s), não um segundo', () => {
    expect(sensorDiagnosis({ ph: 7 }, 'ph', SEM_LEITURA_MS)).toBe('ok');
    expect(sensorDiagnosis({ ph: 7 }, 'ph', 45_000)).toBe('ok');
  });
  const r = { ph: 7.2, turbidez: 10 };
  it('ok só com leitura recente e valor numérico', () => {
    expect(sensorDiagnosis(r, 'ph', 1_000)).toBe('ok');
    expect(sensorDiagnosis(r, 'temperatura', 1_000)).toBe('sem-valor');
  });
  it('leitura velha ou ausente = sem leitura', () => {
    expect(sensorDiagnosis(r, 'ph', SEM_LEITURA_MS + 1)).toBe('sem-leitura');
    expect(sensorDiagnosis(undefined, 'ph', 1_000)).toBe('sem-leitura');
    expect(sensorDiagnosis(r, 'ph', null)).toBe('sem-leitura');
  });
});
