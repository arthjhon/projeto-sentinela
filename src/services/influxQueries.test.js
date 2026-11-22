import { describe, it, expect } from 'vitest';
import { buildNamedQuery, QUERY_NAMES, QUERY_DB } from './influxQueries';

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

  it('QUERY_NAMES lista os 8 endpoints e QUERY_DB cobre todos', () => {
    expect(QUERY_NAMES).toEqual(['history', 'ultimas', 'leituras-24h', 'primeira', 'export', 'ana', 'turbidez-janela', 'status']);
    expect(Object.keys(QUERY_DB).sort()).toEqual([...QUERY_NAMES].sort());
    expect(QUERY_DB.ana).toBe('externos');
    expect(QUERY_DB['turbidez-janela']).toBe('iot');
    expect(QUERY_DB.status).toBe('iot');
  });

  it('status monta o modelo fixo com o topic <device>/status', () => {
    expect(buildNamedQuery('status', { device: 'esp_sururu', periodo: '24h' })).toBe(
      'SELECT mean("rssi") AS "rssi", mean("mqtt_latency") AS "mqtt_latency", min("free_heap") AS "free_heap" ' +
      'FROM "status" WHERE "topic" = \'esp_sururu/status\' AND time > now() - 24h GROUP BY time(10m) fill(none)');
  });

  it('status rejeita período fora da lista e device inválido', () => {
    expect(() => buildNamedQuery('status', { device: 'esp_sururu', periodo: '2h' })).toThrow();
    expect(() => buildNamedQuery('status', { device: 'esp_sururu' })).toThrow();
    for (const device of ['a/b', "a'b", '', undefined, 123]) {
      expect(() => buildNamedQuery('status', { device, periodo: '24h' })).toThrow();
    }
  });

  it('ana monta o modelo fixo com janela em UTC-3', () => {
    expect(buildNamedQuery('ana', { estacao: '39770000', inicio: '2026-05-01', duracao: '30d' })).toBe(
      'SELECT sum("chuva") AS "chuva", mean("vazao") AS "vazao", mean("nivel") AS "nivel" FROM "ana_telemetria" ' +
      'WHERE "estacao" = \'39770000\' AND time >= \'2026-05-01T03:00:00Z\' AND time < \'2026-05-01T03:00:00Z\' + 30d ' +
      'GROUP BY time(1h) fill(none)');
  });

  it('ana rejects station outside list', () => {
    for (const estacao of ['39770001', '', "39770000' OR '1'='1", undefined]) {
      expect(() => buildNamedQuery('ana', { estacao, inicio: '2026-05-01', duracao: '7d' })).toThrow();
    }
  });

  it("ana rejects inicio '2026-5-1' and '2026-13-01'", () => {
    for (const inicio of ['2026-5-1', '2026-13-01', '2026-05-32', '1999-05-01', '2026-05-01T00:00', undefined]) {
      expect(() => buildNamedQuery('ana', { estacao: '39770000', inicio, duracao: '7d' })).toThrow();
    }
  });

  it("ana rejects duracao '365d'", () => {
    expect(() => buildNamedQuery('ana', { estacao: '39770000', inicio: '2026-05-01', duracao: '365d' })).toThrow();
  });

  it('turbidez-janela requires device', () => {
    expect(() => buildNamedQuery('turbidez-janela', { inicio: '2026-05-01', duracao: '7d' })).toThrow();
    expect(() => buildNamedQuery('turbidez-janela', { device: "a'b", inicio: '2026-05-01', duracao: '7d' })).toThrow();
    expect(buildNamedQuery('turbidez-janela', { device: 'esp_x', inicio: '2026-05-01', duracao: '7d' })).toBe(
      'SELECT mean("turbidez") FROM "sensores" WHERE "topic" = \'esp_x/sensores\' AND time >= \'2026-05-01T03:00:00Z\' ' +
      'AND time < \'2026-05-01T03:00:00Z\' + 7d GROUP BY time(15m) fill(none)');
  });

  it('180d groups by time(6h,3h)', () => {
    expect(buildNamedQuery('ana', { estacao: '39770000', inicio: '2026-05-01', duracao: '180d' })).toContain('GROUP BY time(6h,3h) fill(none)');
  });
});
