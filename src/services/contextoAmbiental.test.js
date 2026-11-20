import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ESTACOES_LABEL, ESTACOES_COM_DADOS, ESTACAO_PADRAO,
  janelaAtalho, janelaIntervalo, dominio, mapAnaSeries, fetchAna, fetchTurbidezJanela,
} from './contextoAmbiental';

afterEach(() => vi.unstubAllGlobals());

const ok = (series) => ({ ok: true, status: 200, json: async () => ({
  results: [{ statement_id: 0, series }],
}) });

describe('constantes', () => {
  it('estações com dados são as quatro primeiras; padrão é Fazenda Boa Fortuna', () => {
    expect(ESTACOES_COM_DADOS).toEqual(['39770000', '39760000', '39740000', '39700000']);
    expect(ESTACOES_COM_DADOS).not.toContain('39800100');
    expect(ESTACAO_PADRAO).toBe('39770000');
  });
});

describe('janelaAtalho', () => {
  it('7 days at 2026-11-20T01:00Z gives inicio 2026-11-13 (Maceió ainda é 19/11)', () => {
    expect(janelaAtalho(7, new Date('2026-11-20T01:00:00Z'))).toEqual({ inicio: '2026-11-13', duracao: '7d' });
  });
  it('30 at 2026-11-20T15:00Z gives 2026-10-22/30d', () => {
    expect(janelaAtalho(30, new Date('2026-11-20T15:00:00Z'))).toEqual({ inicio: '2026-10-22', duracao: '30d' });
  });
});

describe('janelaIntervalo / dominio', () => {
  it('t0 = inicio 03:00Z, t1 = t0 + duracao', () => {
    const { t0, t1 } = janelaIntervalo('2026-11-13', '7d');
    expect(t0.toISOString()).toBe('2026-11-13T03:00:00.000Z');
    expect(t1.toISOString()).toBe('2026-11-20T03:00:00.000Z');
  });
  it('dominio crops to now', () => {
    const agora = new Date('2026-11-15T12:00:00Z');
    expect(dominio('2026-11-13', '7d', agora)).toEqual([Date.parse('2026-11-13T03:00:00Z'), agora.getTime()]);
    const depois = new Date('2026-12-30T00:00:00Z');
    expect(dominio('2026-11-13', '7d', depois)[1]).toBe(Date.parse('2026-11-20T03:00:00Z'));
  });
});

describe('mapAnaSeries', () => {
  it('keeps null chuva as gap (never 0)', () => {
    const out = mapAnaSeries([{ columns: ['time', 'chuva', 'vazao', 'nivel'], values: [[1000, null, 2, 3]] }]);
    expect(out.chuva).toEqual([{ time: new Date(1000), value: null }]);
    expect(out.vazao[0].value).toBe(2);
  });
  it('converts epoch ms and sorts', () => {
    const out = mapAnaSeries([{ columns: ['time', 'chuva', 'vazao', 'nivel'],
      values: [[2000, 1, 'x', 5], [1000, 0, 4, null]] }]);
    expect(out.chuva).toEqual([{ time: new Date(1000), value: 0 }, { time: new Date(2000), value: 1 }]);
    expect(out.vazao).toEqual([{ time: new Date(1000), value: 4 }, { time: new Date(2000), value: null }]);
    expect(out.nivel.map(p => p.value)).toEqual([null, 5]);
  });
  it('série vazia = três listas vazias', () => {
    expect(mapAnaSeries([])).toEqual({ chuva: [], vazao: [], nivel: [] });
  });
});

describe('fetchAna', () => {
  it('calls /influx/q/ana with estacao, inicio, duracao', async () => {
    const f = vi.fn().mockResolvedValue(ok([{ columns: ['time', 'chuva', 'vazao', 'nivel'], values: [[1000, 1, 2, 3]] }]));
    vi.stubGlobal('fetch', f);
    const out = await fetchAna('39770000', '2026-11-13', '7d');
    expect(f.mock.calls[0][0]).toBe('/influx/q/ana?estacao=39770000&inicio=2026-11-13&duracao=7d');
    expect(out.nivel).toEqual([{ time: new Date(1000), value: 3 }]);
  });
  it('estação sem dados (sem series) = vazio, não erro', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(undefined)));
    expect(await fetchAna('39800100', '2026-11-13', '7d')).toEqual({ chuva: [], vazao: [], nivel: [] });
  });
  it('fetchAna rejects on Influx error body (HTTP 200)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
      results: [{ statement_id: 0, error: 'invalid time' }] }) }));
    await expect(fetchAna('39770000', '2026-02-31', '7d')).rejects.toThrow('invalid time');
  });
  it('fetchAna rejects on non-2xx with error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'bad' }) }));
    await expect(fetchAna('39770000', '2026-02-31', '7d')).rejects.toThrow('Influx 400: bad');
  });
});

describe('fetchTurbidezJanela', () => {
  it('with no valid ids makes no call', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await fetchTurbidezJanela([], '2026-11-13', '7d')).toEqual([]);
    expect(await fetchTurbidezJanela(['bad id!'], '2026-11-13', '7d')).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
  it('merges two serials, one call each with device', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(ok([{ columns: ['time', 'mean'], values: [[1000, 10], [2000, null]] }]))
      .mockResolvedValueOnce(ok([{ columns: ['time', 'mean'], values: [[2000, 20], [3000, 30]] }]));
    vi.stubGlobal('fetch', f);
    const out = await fetchTurbidezJanela(['esp_a', 'esp_b'], '2026-11-13', '7d');
    expect(f.mock.calls.map(c => c[0])).toEqual([
      '/influx/q/turbidez-janela?inicio=2026-11-13&duracao=7d&device=esp_a',
      '/influx/q/turbidez-janela?inicio=2026-11-13&duracao=7d&device=esp_b',
    ]);
    expect(out).toEqual([
      { time: new Date(1000), value: 10 },
      { time: new Date(2000), value: 20 },
      { time: new Date(3000), value: 30 },
    ]);
  });
  it('rejects on Influx error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }));
    await expect(fetchTurbidezJanela(['esp_a'], '2026-11-13', '7d')).rejects.toThrow('Influx 502');
  });
});
