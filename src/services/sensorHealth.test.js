import { describe, it, expect } from 'vitest';
import { ESTADO_META, healthForDevice, jobStaleness } from './sensorHealth';

const row = (sensor, estado, device_id = 'esp_a') => ({
  device_id, sensor, estado, motivo: null, desde: '2026-11-17T10:00:00Z',
});

describe('healthForDevice', () => {
  it('picks the worst state: bad > warn > info > neutral > ok', () => {
    const rows = [row('ph', 'ok'), row('temp', 'suspeito'), row('turb', 'falha'), row('x', 'ok', 'outro')];
    const h = healthForDevice(rows, 'esp_a');
    expect(h.pior).toBe('falha');
    expect(h.sensores).toHaveLength(3);
    expect(healthForDevice([row('a', 'ok'), row('b', 'manutencao')], 'esp_a').pior).toBe('manutencao');
    expect(healthForDevice([row('a', 'ok'), row('b', 'suspeito')], 'esp_a').pior).toBe('suspeito');
    expect(healthForDevice([row('a', 'ok'), row('b', 'dados_insuficientes')], 'esp_a').pior).toBe('dados_insuficientes');
  });

  it('returns ok/empty for an unknown device', () => {
    expect(healthForDevice([], 'nada')).toEqual({ sensores: [], pior: 'ok' });
  });

  it('never escalates a bench buoy, even with stale bad rows', () => {
    const h = healthForDevice([row('ph', 'falha'), row('temp', 'suspeito')], 'esp_a', 'bancada');
    expect(h.pior).toBe('bancada');
    for (const s of h.sensores) expect(ESTADO_META[s.estado].tone).toBe('neutral');
  });
});

describe('jobStaleness', () => {
  const now = new Date('2026-11-17T12:00:00Z');
  const ago = (s) => new Date(now.getTime() - s * 1000).toISOString();

  it('flags late exactly beyond 3x the interval', () => {
    const r = jobStaleness([
      { job: 'detector', ultimo_sucesso: ago(900) },
      { job: 'ana', ultimo_sucesso: ago(2700) },
      { job: 'openmeteo', ultimo_sucesso: ago(10801) },
    ], now);
    expect(r.map((j) => j.atrasado)).toEqual([false, false, true]);
  });

  it('is late when ultimo_sucesso is missing', () => {
    expect(jobStaleness([{ job: 'ana', ultimo_sucesso: null }], now)[0].atrasado).toBe(true);
  });

  it('carries the erro for failed jobs', () => {
    const r = jobStaleness([{ job: 'ana', ok: false, erro: 'boom', ultimo_sucesso: ago(10) }], now);
    expect(r[0].erro).toBe('boom');
  });
});
