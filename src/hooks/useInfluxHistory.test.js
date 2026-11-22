import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  PERIODS, mapHistorySeries, mapUltimasSeries, fetchUltimasLeituras,
  mergeHistorySeries, fetchHistory, mergeUltimas, fetchStatusHistory, chaveHistorico,
} from './useInfluxHistory';
import { EVERY, ULTIMAS_LIMIT } from '../services/influxQueries';

afterEach(() => vi.unstubAllGlobals());

describe('PERIODS', () => {
  it('deriva as janelas de influxQueries (sem divergir)', () => {
    expect(Object.keys(PERIODS)).toEqual(Object.keys(EVERY));
    for (const [k, cfg] of Object.entries(PERIODS)) {
      expect(cfg).toEqual({ label: k, every: EVERY[k] });
    }
  });
});

describe('mapHistorySeries', () => {
  it('mapeia [time, mean] para {time: Date, value}, pulando nulos', () => {
    const series = [{ name: 'sensores', columns: ['time', 'mean'],
      values: [[1000, 7.1], [2000, null], [3000, 7.3]] }];
    expect(mapHistorySeries(series)).toEqual([
      { time: new Date(1000), value: 7.1 },
      { time: new Date(3000), value: 7.3 },
    ]);
  });
  it('vazio = []', () => {
    expect(mapHistorySeries([])).toEqual([]);
  });
});

describe('mapUltimasSeries / fetchUltimasLeituras', () => {
  const body = { results: [{ statement_id: 0, series: [{
    name: 'sensores', columns: ['time', 'turbidez', 'ph', 'temperatura'],
    values: [[2000, 13, 7.2, null], [1000, 12, 7.1, 27.5]],
  }] }] };

  it('mapeia colunas, null vira undefined, mais recente primeiro', () => {
    const series = body.results[0].series;
    expect(mapUltimasSeries(series)).toEqual([
      { time: new Date(2000), ph: 7.2, temperatura: undefined, turbidez: 13 },
      { time: new Date(1000), ph: 7.1, temperatura: 27.5, turbidez: 12 },
    ]);
  });

  it('chama a consulta nomeada ultimas', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    vi.stubGlobal('fetch', f);
    const rows = await fetchUltimasLeituras('esp_sururu', { periodo: '30d' });
    expect(f.mock.calls[0][0]).toBe('/influx/q/ultimas?periodo=30d&device=esp_sururu');
    expect(rows).toHaveLength(2);
  });
});

const v1 = (columns, values) => ({ ok: true, status: 200, json: async () => ({
  results: [{ statement_id: 0, series: values.length ? [{ name: 'sensores', columns, values }] : undefined }],
}) });

describe('mergeHistorySeries (união dos seriais)', () => {
  const p = (t, value) => ({ time: new Date(t), value });
  it('concatena e ordena por tempo', () => {
    expect(mergeHistorySeries([[p(1000, 1), p(5000, 5)], [p(2000, 2), p(4000, 4)]]))
      .toEqual([p(1000, 1), p(2000, 2), p(4000, 4), p(5000, 5)]);
  });
  it('mesma janela em dois seriais (troca de placa) vira a média', () => {
    expect(mergeHistorySeries([[p(1000, 7), p(2000, 7)], [p(2000, 7.5), p(3000, 7.6)]]))
      .toEqual([p(1000, 7), p(2000, 7.25), p(3000, 7.6)]);
  });
  it('lista vazia ou sem pontos = []', () => {
    expect(mergeHistorySeries([])).toEqual([]);
    expect(mergeHistorySeries([[], []])).toEqual([]);
  });
});

describe('fetchHistory', () => {
  it('null = frota: uma chamada sem device', async () => {
    const f = vi.fn().mockResolvedValue(v1(['time', 'mean'], [[1000, 7.1]]));
    vi.stubGlobal('fetch', f);
    const data = await fetchHistory('ph', '24h', null);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe('/influx/q/history?campo=ph&periodo=24h');
    expect(data).toEqual([{ time: new Date(1000), value: 7.1 }]);
  });

  it('bóia com dois seriais: uma chamada por id, resultado unido', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(v1(['time', 'mean'], [[3000, 7.5], [2000, 7.5]]))
      .mockResolvedValueOnce(v1(['time', 'mean'], [[1000, 7.0], [2000, 7.0]]));
    vi.stubGlobal('fetch', f);
    const data = await fetchHistory('ph', '1h', ['snt-0001', 'esp_sururu']);
    expect(f.mock.calls.map(c => c[0])).toEqual([
      '/influx/q/history?campo=ph&periodo=1h&device=snt-0001',
      '/influx/q/history?campo=ph&periodo=1h&device=esp_sururu',
    ]);
    expect(data.map(d => [d.time.getTime(), d.value])).toEqual([[1000, 7.0], [2000, 7.25], [3000, 7.5]]);
  });

  it('bóia sem id válido falha fechado: [] sem chamada (nunca a frota)', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    for (const ids of [[], ['a"b'], ['a b', '']]) {
      expect(await fetchHistory('ph', '1h', ids)).toEqual([]);
    }
    expect(f).not.toHaveBeenCalled();
  });
});

describe('mergeUltimas / fetchUltimasLeituras com vários seriais', () => {
  const r = (t) => ({ time: new Date(t), ph: t });

  it('mantém as N mais recentes entre todos os ids, mais recente primeiro', () => {
    const a = [r(9), r(7), r(5), r(3)];
    const b = [r(8), r(6), r(2)];
    expect(mergeUltimas([a, b], 4)).toEqual([r(9), r(8), r(7), r(6)]);
    expect(mergeUltimas([[], b], 4)).toEqual(b);
  });

  it(`limite padrão = ${ULTIMAS_LIMIT}`, () => {
    const a = Array.from({ length: ULTIMAS_LIMIT }, (_, i) => r(2 * i));
    const b = Array.from({ length: ULTIMAS_LIMIT }, (_, i) => r(2 * i + 1));
    const out = mergeUltimas([a, b]);
    expect(out).toHaveLength(ULTIMAS_LIMIT);
    expect(out[0].time.getTime()).toBe(2 * ULTIMAS_LIMIT - 1);
    expect(out.at(-1).time.getTime()).toBe(ULTIMAS_LIMIT);
  });

  it('uma consulta ultimas por id, unidas', async () => {
    const cols = ['time', 'turbidez', 'ph', 'temperatura'];
    const f = vi.fn()
      .mockResolvedValueOnce(v1(cols, [[4000, 1, 7.4, 20], [2000, 1, 7.2, 20]]))
      .mockResolvedValueOnce(v1(cols, [[3000, 1, 7.3, 20], [1000, 1, 7.1, 20]]));
    vi.stubGlobal('fetch', f);
    const rows = await fetchUltimasLeituras(['snt-0001', 'esp_sururu'], { periodo: '30d' });
    expect(f.mock.calls.map(c => c[0])).toEqual([
      '/influx/q/ultimas?periodo=30d&device=snt-0001',
      '/influx/q/ultimas?periodo=30d&device=esp_sururu',
    ]);
    expect(rows.map(x => x.ph)).toEqual([7.4, 7.3, 7.2, 7.1]);
  });

  it('null, [] ou só ids inválidos = [] sem consulta (não há ultimas da frota)', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    for (const ids of [null, undefined, [], ['a b']]) {
      expect(await fetchUltimasLeituras(ids, { periodo: '30d' })).toEqual([]);
    }
    expect(f).not.toHaveBeenCalled();
  });
});

describe('fetchStatusHistory', () => {
  const cols = ['time', 'rssi', 'mqtt_latency', 'free_heap'];

  it('uma bóia: uma chamada com device e período, linhas numéricas', async () => {
    const f = vi.fn().mockResolvedValue(v1(cols, [[1000, -55, 40, 150000], [2000, null, null, 140000]]));
    vi.stubGlobal('fetch', f);
    const data = await fetchStatusHistory('esp_sururu', '24h');
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe('/influx/q/status?periodo=24h&device=esp_sururu');
    expect(data).toEqual([
      { time: 1000, rssi: -55, mqtt_latency: 40, free_heap: 150000 },
      { time: 2000, rssi: null, mqtt_latency: null, free_heap: 140000 },
    ]);
  });

  it('dois seriais: junta por tempo (média de rssi/latência, mínimo de heap), em ordem', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(v1(cols, [[2000, -60, 30, 100], [3000, -70, 50, 90]]))
      .mockResolvedValueOnce(v1(cols, [[1000, -50, 20, 200], [2000, -80, null, 80]]));
    vi.stubGlobal('fetch', f);
    const data = await fetchStatusHistory(['snt-0001', 'esp_sururu'], '1h');
    expect(f.mock.calls.map(c => c[0])).toEqual([
      '/influx/q/status?periodo=1h&device=snt-0001',
      '/influx/q/status?periodo=1h&device=esp_sururu',
    ]);
    expect(data).toEqual([
      { time: 1000, rssi: -50, mqtt_latency: 20, free_heap: 200 },
      { time: 2000, rssi: -70, mqtt_latency: 30, free_heap: 80 },
      { time: 3000, rssi: -70, mqtt_latency: 50, free_heap: 90 },
    ]);
  });

  it('sem id válido (ou frota): [] sem chamada', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    for (const ids of [null, [], ['a"b'], ['a b', '']]) {
      expect(await fetchStatusHistory(ids, '1h')).toEqual([]);
    }
    expect(f).not.toHaveBeenCalled();
  });
});

describe('chaveHistorico', () => {
  it('identifica campo, período e seriais do que foi buscado', () => {
    expect(chaveHistorico('ph', '24h', ['a'])).toBe(chaveHistorico('ph', '24h', ['a']));
    expect(chaveHistorico('ph', '24h', ['a'])).not.toBe(chaveHistorico('ph', '7d', ['a']));
    expect(chaveHistorico('ph', '24h', ['a'])).not.toBe(chaveHistorico('temperatura', '24h', ['a']));
    expect(chaveHistorico('ph', '24h', ['a'])).not.toBe(chaveHistorico('ph', '24h', ['b']));
    expect(chaveHistorico('ph', '24h', null)).toBe(chaveHistorico('ph', '24h', undefined));
  });
});
