import { describe, it, expect } from 'vitest';
import { buildCsv } from './exportHistoryCsv';

// Linhas reais vindas do Influx (query pivotada de 30d), incluindo o outlier
// de 85 que existe no histórico de 08/07.
const rows = [
  { time: new Date('2026-07-07T23:59:55.097Z'), ph: '7.14', temperatura: '85',   turbidez: '39.54' },
  { time: new Date('2026-07-08T00:00:00.116Z'), ph: '7.14', temperatura: '21.75', turbidez: '36.9' },
  { time: new Date('2026-07-17T06:16:47.140Z'), ph: '7.31', temperatura: '26.9', turbidez: '42.7' },
];

describe('buildCsv (formato pt-BR para Excel)', () => {
  const csv = buildCsv(rows, 'SM-01');
  const lines = csv.split('\r\n');

  it('cabeçalho na ordem que o documento pede', () => {
    expect(lines[0]).toBe('timestamp;boia_id;temperatura;ph;turbidez');
  });

  it('usa ; como separador e , como decimal', () => {
    expect(lines[1]).toContain(';SM-01;');
    expect(lines[1]).toContain('85;7,14;39,54');
    expect(lines[3]).toContain('26,9;7,31;42,7');
    expect(lines[1]).not.toMatch(/\d\.\d/); // nenhum decimal com ponto
  });

  it('data em pt-BR (Excel reconhece como data/hora)', () => {
    expect(lines[3]).toMatch(/^17\/07\/2026 \d{2}:16:47;/);
  });

  it('preenche boia_id mesmo em linhas antigas (tag não existia)', () => {
    for (const l of lines.slice(1)) expect(l.split(';')[1]).toBe('SM-01');
  });

  it('respeita a ordem das colunas independente da ordem do Influx', () => {
    // Influx devolve alfabético (ph, temperatura, turbidez)
    const [, , temp, ph, turb] = lines[3].split(';');
    expect(temp).toBe('26,9');
    expect(ph).toBe('7,31');
    expect(turb).toBe('42,7');
  });

  it('campo vazio quando a leitura falta', () => {
    const out = buildCsv([{ time: new Date('2026-07-17T06:00:00Z'), ph: '', temperatura: '20', turbidez: null }], 'SM-01');
    expect(out.split('\r\n')[1]).toMatch(/;20;;$/);
  });
});
