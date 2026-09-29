import { describe, it, expect } from 'vitest';
import { parsePivotCsv } from './useInfluxHistory';

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
