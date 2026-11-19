import { describe, it, expect } from 'vitest';
import { buildNamedQuery, QUERY_NAMES } from './influxQueries';

describe('buildNamedQuery', () => {
  it('history: agregação por período, com e sem device', () => {
    expect(buildNamedQuery('history', { campo: 'ph', periodo: '1h' })).toBe(
      'SELECT mean("ph") FROM "sensores" WHERE time > now() - 1h GROUP BY time(30s) fill(none)');
    expect(buildNamedQuery('history', { campo: 'turbidez', periodo: '24h' })).toContain('GROUP BY time(10m)');
    expect(buildNamedQuery('history', { campo: 'temperatura', periodo: '7d' })).toContain('GROUP BY time(1h)');
    expect(buildNamedQuery('history', { campo: 'ph', periodo: '30d', device: 'esp_sururu' })).toBe(
      'SELECT mean("ph") FROM "sensores" WHERE time > now() - 30d AND "topic" = \'esp_sururu/sensores\' ' +
      'GROUP BY time(6h) fill(none)');
  });

  it('ultimas e export exigem device e período válidos', () => {
    expect(buildNamedQuery('ultimas', { device: 'esp_x', periodo: '24h' })).toBe(
      'SELECT "turbidez","ph","temperatura" FROM "sensores" WHERE "topic" = \'esp_x/sensores\' ' +
      'AND time > now() - 24h ORDER BY time DESC LIMIT 50');
    expect(buildNamedQuery('export', { device: 'esp_x', periodo: '30d' })).toBe(
      'SELECT "temperatura","ph","turbidez" FROM "sensores" WHERE "topic" = \'esp_x/sensores\' AND time > now() - 30d ORDER BY time DESC LIMIT 600000');
    expect(() => buildNamedQuery('ultimas', { device: 'esp_x', periodo: '7d' })).toThrow();
    expect(() => buildNamedQuery('ultimas', { periodo: '24h' })).toThrow();
    expect(() => buildNamedQuery('export', { periodo: '1h' })).toThrow();
    expect(() => buildNamedQuery('export', { device: 'esp_x', periodo: '90d' })).toThrow();
  });

  it('consultas sem parâmetro', () => {
    expect(buildNamedQuery('leituras-24h')).toBe('SELECT count("ph") FROM "sensores" WHERE time > now() - 24h');
    expect(buildNamedQuery('primeira')).toBe('SELECT first("ph") FROM "sensores"');
  });

  it('campo, período e nome inválidos lançam', () => {
    expect(() => buildNamedQuery('history', { campo: 'foo', periodo: '1h' })).toThrow();
    expect(() => buildNamedQuery('history', { campo: 'ph', periodo: '2h' })).toThrow();
    expect(() => buildNamedQuery('history', { campo: 'ph,ph', periodo: '1h' })).toThrow();
    expect(() => buildNamedQuery('history', {})).toThrow();
    expect(() => buildNamedQuery('query', {})).toThrow();
    expect(() => buildNamedQuery('__proto__', {})).toThrow();
  });

  it.each([
    "a'b", 'a"b', 'a\\b', 'a/b', 'a;b', 'a b', "' OR '1'='1", 'a'.repeat(41), '', '*', 'a\nb', 'á',
  ])('device inválido %j é rejeitado em todas as consultas que o usam', (device) => {
    expect(() => buildNamedQuery('ultimas', { device, periodo: '24h' })).toThrow();
    expect(() => buildNamedQuery('export', { device, periodo: '1h' })).toThrow();
    if (device !== '') {
      expect(() => buildNamedQuery('history', { campo: 'ph', periodo: '1h', device })).toThrow();
    }
  });

  it('device não-string é rejeitado', () => {
    expect(() => buildNamedQuery('export', { device: 123, periodo: '1h' })).toThrow();
    expect(() => buildNamedQuery('export', { device: ['a'], periodo: '1h' })).toThrow();
  });

  it('QUERY_NAMES lista os 5 endpoints', () => {
    expect(QUERY_NAMES).toEqual(['history', 'ultimas', 'leituras-24h', 'primeira', 'export']);
  });
});
