import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ESTACOES_LABEL, ESTACOES_COM_DADOS, ESTACAO_PADRAO,
  janelaAtalho, janelaIntervalo, dominio, mapAnaSeries, comLacunas, PASSO_MS, fetchAna, fetchTurbidezJanela,
  hojeMaceio, inicioValido, rotuloPasso, indiceMaisProximo, intervalosSemLeitura,
} from './contextoAmbiental';
import { ESTACOES_ANA, T0_UTC } from './influxQueries';

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
  it('ESTACOES_LABEL nomeia exatamente as estações aceitas pelo proxy', () => {
    expect(new Set(Object.keys(ESTACOES_LABEL))).toEqual(new Set(ESTACOES_ANA));
  });
  it('T0_UTC é a meia-noite de Maceió (UTC-3) usada no literal da janela', () => {
    expect(T0_UTC).toBe('T03:00:00Z');
  });
});

describe('hojeMaceio / inicioValido', () => {
  it('hoje em Maceió: 01:00Z ainda é o dia anterior', () => {
    expect(hojeMaceio(new Date('2026-11-20T01:00:00Z'))).toBe('2026-11-19');
    expect(hojeMaceio(new Date('2026-11-20T03:00:00Z'))).toBe('2026-11-20');
  });
  it('aceita data real no formato do proxy', () => {
    expect(inicioValido('2026-05-01')).toBe(true);
    expect(inicioValido('2028-02-29')).toBe(true);
  });
  it('recusa data impossível (2026-02-31, 2026-02-29) e os passos de digitação do ano', () => {
    for (const v of ['2026-02-31', '2026-02-29', '2026-04-31', '0002-05-01', '0020-05-01', '0202-05-01', '', null, '2026-5-1']) {
      expect(inicioValido(v)).toBe(false);
    }
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
  it('dominio of a window starting after now is [t0, t1], never reversed', () => {
    const agora = new Date('2026-11-20T12:00:00Z');
    expect(dominio('2026-12-01', '7d', agora)).toEqual([Date.parse('2026-12-01T03:00:00Z'), Date.parse('2026-12-08T03:00:00Z')]);
  });
  it('dominio follows the agora it is given (a later shortcut reaches the later now)', () => {
    const cedo = new Date('2026-11-20T12:00:00Z');
    const tarde = new Date('2026-11-20T18:00:00Z');
    expect(dominio('2026-11-14', '7d', cedo)[1]).toBe(cedo.getTime());
    expect(dominio('2026-11-14', '7d', tarde)[1]).toBe(tarde.getTime());
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

describe('comLacunas', () => {
  const pt = (ms, value = 1) => ({ time: new Date(ms), value });
  const H = 3600000;

  it('comLacunas inserts a null break between points more than one bucket apart', () => {
    const out = comLacunas([pt(5 * H), pt(0), pt(H)], H);
    expect(out.map(p => [p.time.getTime(), p.value])).toEqual([[0, 1], [H, 1], [2 * H, null], [5 * H, 1]]);
  });

  it('comLacunas leaves contiguous buckets untouched', () => {
    const pts = [pt(0), pt(H), pt(2 * H)];
    expect(comLacunas(pts, H)).toEqual(pts);
    expect(comLacunas([], H)).toEqual([]);
  });

  it('bucket ms per duracao', () => {
    expect(PASSO_MS).toEqual({ '7d': 900000, '30d': 3600000, '90d': 10800000, '180d': 21600000 });
  });
});

describe('rotuloPasso', () => {
  it('derives the rain bucket label from PASSO_MS', () => {
    expect(Object.fromEntries(Object.entries(PASSO_MS).map(([d, ms]) => [d, rotuloPasso(ms)])))
      .toEqual({ '7d': '15 min', '30d': '1 h', '90d': '3 h', '180d': '6 h' });
  });
});

describe('indiceMaisProximo (cursor compartilhado)', () => {
  const H = 3600000;
  const rows = [{ t: 0, v: 1 }, { t: H, v: 2 }, { t: 2 * H, v: null }, { t: 5 * H, v: 3 }];

  it('picks the row at the same time', () => {
    expect(indiceMaisProximo(rows, H, H)).toBe(1);
  });
  it('picks the nearest row within one bucket', () => {
    expect(indiceMaisProximo(rows, 0.4 * H, H)).toBe(0);
    expect(indiceMaisProximo(rows, 0.6 * H, H)).toBe(1);
    expect(indiceMaisProximo(rows, 4.2 * H, H)).toBe(3);
  });
  it('never picks a null (synthetic gap) row', () => {
    expect(indiceMaisProximo(rows, 2 * H, H)).toBe(1);
  });
  it('-1 when nothing is within one bucket, or the label is missing', () => {
    expect(indiceMaisProximo(rows, 3.5 * H, H)).toBe(-1);
    expect(indiceMaisProximo(rows, undefined, H)).toBe(-1);
    expect(indiceMaisProximo([], H, H)).toBe(-1);
  });
});

describe('intervalosSemLeitura (faixas cinza da chuva)', () => {
  const H = 3600000;
  const pt = (ms, value = 0) => ({ time: new Date(ms), value });

  it('contiguous buckets (dry included) leave no band', () => {
    expect(intervalosSemLeitura([pt(0), pt(H, 1.2), pt(2 * H)], H, [0, 3 * H])).toEqual([]);
  });
  it('rows more than one bucket apart -> band between them', () => {
    expect(intervalosSemLeitura([pt(0), pt(4 * H)], H, [0, 5 * H])).toEqual([[H, 4 * H]]);
  });
  it('a row with null chuva is a band, merged with neighbouring gaps', () => {
    expect(intervalosSemLeitura([pt(0), pt(H, null), pt(3 * H), pt(4 * H)], H, [0, 5 * H])).toEqual([[H, 3 * H]]);
  });
  it('start and end of the window without rows are bands', () => {
    expect(intervalosSemLeitura([pt(2 * H)], H, [0, 6 * H])).toEqual([[0, 2 * H], [3 * H, 6 * H]]);
  });
  it('clips to the visible domain (zoom)', () => {
    expect(intervalosSemLeitura([pt(0), pt(10 * H)], H, [3 * H, 5 * H])).toEqual([[3 * H, 5 * H]]);
    expect(intervalosSemLeitura([pt(0), pt(H), pt(2 * H)], H, [0.5 * H, 1.5 * H])).toEqual([]);
  });
  it('no rows -> whole domain; invalid domain -> none', () => {
    expect(intervalosSemLeitura([], H, [0, H])).toEqual([[0, H]]);
    expect(intervalosSemLeitura([pt(0)], H, [H, H])).toEqual([]);
    expect(intervalosSemLeitura([pt(0)], H, [NaN, H])).toEqual([]);
  });
});
