import { describe, it, expect } from 'vitest';
import {
  buoyStatus, formatCoords, formatAge, formatInterval, sensorDiagnosis, readingsToCsv,
  LEITURA_RECENTE_MS,
} from './buoyRuntime';

describe('buoyStatus', () => {
  it('sem deviceId é planejada, mesmo com availability', () => {
    expect(buoyStatus(null, 'online')).toBe('planejada');
    expect(buoyStatus('', undefined)).toBe('planejada');
  });
  it('segue o LWT e não inventa online sem ele', () => {
    expect(buoyStatus('esp', 'online')).toBe('online');
    expect(buoyStatus('esp', 'offline')).toBe('offline');
    expect(buoyStatus('esp', undefined)).toBe('sem-sinal');
    expect(buoyStatus('esp', { status: 'x' })).toBe('sem-sinal');
  });
});

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
    expect(formatAge(-1)).toBe('--');
  });
  it('intervalo', () => {
    expect(formatInterval(5_020)).toBe('~5 s');
    expect(formatInterval(120_000)).toBe('~2 min');
    expect(formatInterval(null)).toBe('--');
    expect(formatInterval(0)).toBe('--');
  });
});

describe('sensorDiagnosis', () => {
  const r = { ph: 7.2, turbidez: 10 };
  it('ok só com leitura recente e valor numérico', () => {
    expect(sensorDiagnosis(r, 'ph', 1_000)).toBe('ok');
    expect(sensorDiagnosis(r, 'temperatura', 1_000)).toBe('sem-valor');
  });
  it('leitura velha ou ausente = sem leitura', () => {
    expect(sensorDiagnosis(r, 'ph', LEITURA_RECENTE_MS + 1)).toBe('sem-leitura');
    expect(sensorDiagnosis(undefined, 'ph', 1_000)).toBe('sem-leitura');
    expect(sensorDiagnosis(r, 'ph', null)).toBe('sem-leitura');
  });
});

describe('readingsToCsv', () => {
  it('cabeçalho, vírgula decimal e célula vazia para valor ausente', () => {
    const csv = readingsToCsv([
      { time: new Date('2026-09-29T10:00:00Z'), temperatura: 27.5, ph: 7.21, turbidez: undefined },
    ]);
    expect(csv).toBe('data_hora_utc;temperatura_c;ph;turbidez_ntu\n2026-09-29T10:00:00.000Z;27,5;7,21;');
  });
});
