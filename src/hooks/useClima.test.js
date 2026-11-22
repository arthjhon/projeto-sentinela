import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchPrevisao, fetchAnaRecente } from './useClima';

afterEach(() => vi.unstubAllGlobals());

const resp = (results) => ({ ok: true, status: 200, json: async () => ({ results }) });
const serie = (columns, values) => ({ series: values.length ? [{ name: 'x', columns, values }] : undefined });

describe('fetchPrevisao', () => {
  const cols = ['time', 'precipitation', 'precipitation_probability', 'temperature_2m', 'wind_speed_10m', 'cloud_cover'];

  it('chama /influx/q/previsao?ponto= e mapeia colunas, null para ausente', async () => {
    const f = vi.fn().mockResolvedValue(resp([serie(cols, [[1000, 0.4, 60, 27.1, 12, 80], [2000, null, null, 26, null, null]])]));
    vi.stubGlobal('fetch', f);
    const data = await fetchPrevisao('celmm');
    expect(f.mock.calls[0][0]).toBe('/influx/q/previsao?ponto=celmm');
    expect(data).toEqual([
      { time: 1000, precipitation: 0.4, precipitation_probability: 60, temperature_2m: 27.1, wind_speed_10m: 12, cloud_cover: 80 },
      { time: 2000, precipitation: null, precipitation_probability: null, temperature_2m: 26, wind_speed_10m: null, cloud_cover: null },
    ]);
  });

  it('série vazia -> []', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp([serie(cols, [])])));
    expect(await fetchPrevisao('bacia_mundau')).toEqual([]);
  });

  it('ponto inválido: lança sem chamar a rede', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(fetchPrevisao('x')).rejects.toThrow();
    await expect(fetchPrevisao('')).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });

  it('propaga o signal e erro HTTP', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    vi.stubGlobal('fetch', f);
    const ac = new AbortController();
    await expect(fetchPrevisao('celmm', { signal: ac.signal })).rejects.toThrow('Influx 429');
    expect(f.mock.calls[0][1].signal).toBe(ac.signal);
  });
});

describe('fetchAnaRecente', () => {
  it('uma chamada, duas instruções: separa chuva e vazão pelas colunas', async () => {
    const f = vi.fn().mockResolvedValue(resp([
      serie(['time', 'chuva'], [[1000, 0.5], [2000, null]]),
      serie(['time', 'vazao'], [[1000, 12.5], [2000, null]]),
    ]));
    vi.stubGlobal('fetch', f);
    const data = await fetchAnaRecente();
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe('/influx/q/ana-recente');
    expect(data).toEqual({
      chuva: [{ time: 1000, chuva: 0.5 }, { time: 2000, chuva: null }],
      vazao: [{ time: 1000, vazao: 12.5 }, { time: 2000, vazao: null }],
    });
  });

  it('só uma das séries presente: a outra é []', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp([serie(['time', 'chuva'], [[1000, 1]]), serie(['time', 'vazao'], [])])));
    expect(await fetchAnaRecente()).toEqual({ chuva: [{ time: 1000, chuva: 1 }], vazao: [] });
  });

  it('tudo vazio -> { chuva: [], vazao: [] }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp([{}, {}])));
    expect(await fetchAnaRecente()).toEqual({ chuva: [], vazao: [] });
  });
});
