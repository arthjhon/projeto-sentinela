import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildCsv, mapExportSeries, mergeExportRows, fetchHistoryCsv } from './exportHistoryCsv';
import { EXPORT_LIMIT } from '../services/influxQueries';

afterEach(() => vi.unstubAllGlobals());

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

const mockInflux = (values) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true, status: 200,
  json: async () => ({ results: [{ statement_id: 0, series: [
    { name: 'sensores', columns: ['time', 'temperatura', 'ph', 'turbidez'], values },
  ] }] }),
}));

describe('mapExportSeries', () => {
  it('mapeia linhas v1 para {time: Date, ...}, nulos viram vazio', () => {
    const series = [{ columns: ['time', 'temperatura', 'ph', 'turbidez'],
      values: [[1000, 27.5, 7.1, 12], [2000, null, 7.2, 13]] }];
    expect(mapExportSeries(series)).toEqual([
      { time: new Date(1000), temperatura: 27.5, ph: 7.1, turbidez: 12 },
      { time: new Date(2000), temperatura: '', ph: 7.2, turbidez: 13 },
    ]);
  });
});

describe('fetchHistoryCsv', () => {
  it('chama export e gera o CSV, sem truncar', async () => {
    mockInflux([[1000, 27.5, 7.1, 12]]);
    const out = await fetchHistoryCsv('24h', 'esp_sururu', 'SM-01');
    expect(fetch.mock.calls[0][0]).toBe('/influx/q/export?periodo=24h&device=esp_sururu');
    expect(out.rows).toBe(1);
    expect(out.truncated).toBe(false);
    expect(out.csv.split('\r\n')[1]).toContain(';SM-01;27,5;7,1;12');
  });

  it('reverte as linhas do servidor (mais novo primeiro) para ordem cronológica', async () => {
    mockInflux([[3000, 1, 2, 3], [2000, 1, 2, 3], [1000, 1, 2, 3]]);
    const out = await fetchHistoryCsv('24h', 'esp_sururu', 'SM-01');
    const lines = out.csv.split('\r\n').slice(1);
    const ts = lines.map(l => l.split(';')[0]);
    expect(ts).toEqual([...ts].sort((a, b) => a.localeCompare(b)));
    expect(new Set(ts).size).toBe(3);
  });

  it('marca truncated quando atinge EXPORT_LIMIT', async () => {
    mockInflux(Array.from({ length: EXPORT_LIMIT }, (_, i) => [i * 1000, 1, 2, 3]));
    const out = await fetchHistoryCsv('30d', 'esp_sururu', 'SM-01');
    expect(out.rows).toBe(EXPORT_LIMIT);
    expect(out.truncated).toBe(true);
  });

  it('exige bóia e período válidos, sem chamar fetch', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(fetchHistoryCsv('24h', undefined, 'SM-01')).rejects.toThrow(/bóia/);
    await expect(fetchHistoryCsv('9d', 'esp_sururu', 'SM-01')).rejects.toThrow(/Período/);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('export com vários seriais (união)', () => {
  const cols = ['time', 'temperatura', 'ph', 'turbidez'];
  const resp = (values) => ({ ok: true, status: 200, json: async () => ({
    results: [{ statement_id: 0, series: values.length ? [{ name: 'sensores', columns: cols, values }] : undefined }],
  }) });

  it('mergeExportRows: listas DESC por serial -> uma lista em ordem cronológica', () => {
    const r = (t) => ({ time: new Date(t) });
    expect(mergeExportRows([[r(5), r(3), r(1)], [r(4), r(2)]]).map(x => x.time.getTime()))
      .toEqual([1, 2, 3, 4, 5]);
    expect(mergeExportRows([])).toEqual([]);
  });

  it('uma consulta export por id válido, linhas unidas em ordem crescente', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp([[4000, 4, 7.4, 1], [2000, 2, 7.2, 1]]))
      .mockResolvedValueOnce(resp([[3000, 3, 7.3, 1], [1000, 1, 7.1, 1]]));
    vi.stubGlobal('fetch', f);
    const out = await fetchHistoryCsv('24h', ['snt-0001', 'a b', 'esp_sururu'], 'SM-01');
    expect(f.mock.calls.map(c => c[0])).toEqual([
      '/influx/q/export?periodo=24h&device=snt-0001',
      '/influx/q/export?periodo=24h&device=esp_sururu',
    ]);
    expect(out.rows).toBe(4);
    expect(out.truncated).toBe(false);
    const temps = out.csv.split('\r\n').slice(1).map(l => l.split(';')[2]);
    expect(temps).toEqual(['1', '2', '3', '4']);
  });

  it('truncated se QUALQUER serial atingiu EXPORT_LIMIT', async () => {
    const full = Array.from({ length: EXPORT_LIMIT }, (_, i) => [(EXPORT_LIMIT - i) * 1000, 1, 2, 3]);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(resp([[1, 1, 2, 3]]))
      .mockResolvedValueOnce(resp(full)));
    const out = await fetchHistoryCsv('30d', ['snt-0001', 'esp_sururu'], 'SM-01');
    expect(out.rows).toBe(EXPORT_LIMIT + 1);
    expect(out.truncated).toBe(true);
  });

  it('bóia sem serial válido falha fechado: 0 linhas, sem consulta (nunca a frota)', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    for (const ids of [[], '', ['a"b']]) {
      const out = await fetchHistoryCsv('24h', ids, 'SM-01');
      expect(out).toMatchObject({ rows: 0, truncated: false });
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('null (sem bóia) é erro: não há export da frota', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(fetchHistoryCsv('24h', null, 'SM-01')).rejects.toThrow(/bóia/);
    expect(f).not.toHaveBeenCalled();
  });
});
