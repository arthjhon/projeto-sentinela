import { describe, it, expect } from 'vitest';
import { parseMqttPayload } from './mqttPayload';

describe('parseMqttPayload', () => {
  it('faz parse de JSON válido', () => {
    expect(parseMqttPayload('{"temperatura":27.5}')).toEqual({ temperatura: 27.5 });
  });

  it('devolve a string crua quando não é JSON (ex: LWT de availability)', () => {
    expect(parseMqttPayload('online')).toBe('online');
    expect(parseMqttPayload('offline')).toBe('offline');
  });

  it('devolve a string crua para payload vazio', () => {
    expect(parseMqttPayload('')).toBe('');
  });
});
