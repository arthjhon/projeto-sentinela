import { describe, it, expect, vi } from 'vitest';
import { parsePivotCsv, buildHistoryFlux, fetchUltimasLeituras } from './useInfluxHistory';

describe('parsePivotCsv', () => {
  it('lê as colunas do pivot, mais recente primeiro', () => {
    const csv = [
      '#datatype,string,long,dateTime:RFC3339,double,double,double',
      ',result,table,_time,ph,temperatura,turbidez',
      ',_result,0,2026-09-29T10:00:00Z,7.1,27.5,12',
      ',_result,0,2026-09-29T10:00:05Z,7.2,,13',
    ].join('\n');
    expect(parsePivotCsv(csv)).toEqual([
      { time: new Date('2026-09-29T10:00:05Z'), ph: 7.2, temperatura: undefined, turbidez: 13 },
      { time: new Date('2026-09-29T10:00:00Z'), ph: 7.1, temperatura: 27.5, turbidez: 12 },
    ]);
  });

  it('aceita várias tabelas com cabeçalhos diferentes', () => {
    const csv = [
      ',result,table,_time,ph',
      ',_result,0,2026-09-29T10:00:00Z,7',
      '',
      ',result,table,_time,turbidez,ph',
      ',_result,1,2026-09-29T11:00:00Z,20,7.5',
    ].join('\n');
    const rows = parsePivotCsv(csv);
    expect(rows.map(r => r.ph)).toEqual([7.5, 7]);
    expect(rows[0].turbidez).toBe(20);
  });

  it('vazio = nenhuma linha', () => {
    expect(parsePivotCsv('')).toEqual([]);
  });
});

describe('useInfluxHistory union filter', () => {
  it('buildHistoryFlux junta os tópicos com or', () => {
    const q = buildHistoryFlux('ph', { start: '-1h', every: '1m' }, ['snt-0001', 'esp_sururu']);
    expect(q).toContain('r.topic == "snt-0001/sensores" or r.topic == "esp_sururu/sensores"');
  });
  it('string única e vazio', () => {
    expect(buildHistoryFlux('ph', { start: '-1h', every: '1m' }, 'a')).toContain('r.topic == "a/sensores")');
    expect(buildHistoryFlux('ph', { start: '-1h', every: '1m' }, null)).not.toContain('r.topic');
  });
  it('fetchUltimasLeituras une os tópicos', async () => {
    let body;
    globalThis.fetch = vi.fn(async (_u, o) => { body = o.body; return { ok: true, text: async () => '' }; });
    await fetchUltimasLeituras(['snt-0001', 'esp_sururu']);
    expect(body).toContain('r.topic == "snt-0001/sensores" or r.topic == "esp_sururu/sensores"');
  });
});
