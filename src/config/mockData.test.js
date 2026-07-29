import { describe, it, expect } from 'vitest';
import { makeMockReading, makeMockStatus } from './mockData';

describe('makeMockReading', () => {
  it('gera valores dentro de faixas plausíveis', () => {
    for (let i = 0; i < 50; i++) {
      const r = makeMockReading(null);
      expect(r.temperatura).toBeGreaterThanOrEqual(24);
      expect(r.temperatura).toBeLessThanOrEqual(29);
      expect(r.ph).toBeGreaterThanOrEqual(7.0);
      expect(r.ph).toBeLessThanOrEqual(8.4);
      expect(r.turbidez).toBeGreaterThanOrEqual(8);
      expect(r.turbidez).toBeLessThanOrEqual(55);
    }
  });
  it('mantém continuidade a partir do valor anterior', () => {
    const a = makeMockReading(null);
    const b = makeMockReading(a);
    expect(Math.abs(b.temperatura - a.temperatura)).toBeLessThanOrEqual(0.6);
  });
});

describe('makeMockStatus', () => {
  it('retorna os campos esperados do payload /status', () => {
    const s = makeMockStatus(12345);
    expect(s.uptime).toBe(12345);
    expect(s.firmware).toContain('mock');
    expect(typeof s.rssi).toBe('number');
    expect(typeof s.free_heap).toBe('number');
    expect(typeof s.mqtt_latency).toBe('number');
  });
});
