import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseInfluxQLResponse, fetchNamed, fetchNamedPerDevice, rowsOf } from './influxql';

const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

afterEach(() => vi.unstubAllGlobals());

describe('parseInfluxQLResponse', () => {
  it('achata as séries', () => {
    const json = { results: [{ statement_id: 0, series: [
      { name: 'sensores', columns: ['time', 'mean'], values: [[1000, 7.1], [2000, 7.2]] },
      { name: 'x', tags: { a: '1' }, columns: ['time', 'v'], values: [[1, 2]] },
    ] }] };
    expect(parseInfluxQLResponse(json)).toEqual([
      { name: 'sensores', columns: ['time', 'mean'], values: [[1000, 7.1], [2000, 7.2]] },
      { name: 'x', tags: { a: '1' }, columns: ['time', 'v'], values: [[1, 2]] },
    ]);
  });
  it('resultado vazio = []', () => {
    expect(parseInfluxQLResponse({ results: [{ statement_id: 0 }] })).toEqual([]);
    expect(parseInfluxQLResponse({ results: [] })).toEqual([]);
    expect(parseInfluxQLResponse({})).toEqual([]);
  });
  it('erro dentro de HTTP 200 lança com a mensagem', () => {
    expect(() => parseInfluxQLResponse({ results: [{ statement_id: 0, error: 'boom' }] })).toThrow('boom');
  });
  it('erro de topo lança com a mensagem', () => {
    expect(() => parseInfluxQLResponse({ error: 'unauthorized' })).toThrow('unauthorized');
  });
});

describe('fetchNamed', () => {
  it('monta a URL omitindo undefined e vazio', async () => {
    const f = vi.fn().mockResolvedValue(ok({ results: [] }));
    vi.stubGlobal('fetch', f);
    const ctrl = new AbortController();
    await fetchNamed('history', { campo: 'ph', periodo: '1h', device: undefined, x: '' }, { signal: ctrl.signal });
    expect(f).toHaveBeenCalledWith('/influx/q/history?campo=ph&periodo=1h', { signal: ctrl.signal });
  });
  it('sem parâmetros, sem "?"', async () => {
    const f = vi.fn().mockResolvedValue(ok({ results: [] }));
    vi.stubGlobal('fetch', f);
    await fetchNamed('primeira');
    expect(f.mock.calls[0][0]).toBe('/influx/q/primeira');
  });
  it('rejeita nome e device inválidos sem chamar fetch', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(fetchNamed('query', {})).rejects.toThrow(/desconhecida/);
    await expect(fetchNamed('ultimas', { device: "a'b", periodo: '24h' })).rejects.toThrow(/device/);
    await expect(fetchNamed('ultimas', { device: 'a'.repeat(41), periodo: '24h' })).rejects.toThrow(/device/);
    expect(f).not.toHaveBeenCalled();
  });
  it('4xx lança com status e mensagem do corpo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ error: 'parâmetro inválido: campo' }, 400)));
    await expect(fetchNamed('history', {})).rejects.toThrow('Influx 400: parâmetro inválido: campo');
  });
  it('5xx com corpo não-JSON lança com status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('x'); } }));
    await expect(fetchNamed('primeira')).rejects.toThrow('Influx 502');
  });
  it('erro 200 com results[i].error lança', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ results: [{ error: 'db not found' }] })));
    await expect(fetchNamed('primeira')).rejects.toThrow('db not found');
  });
});

describe('rowsOf', () => {
  it('converte colunas/valores em objetos', () => {
    expect(rowsOf([{ columns: ['time', 'ph'], values: [[1, 7], [2, null]] }]))
      .toEqual([{ time: 1, ph: 7 }, { time: 2, ph: null }]);
  });
});

describe('fetchNamedPerDevice (união de seriais, falha fechado)', () => {
  const series = (tag) => ({ results: [{ statement_id: 0, series: [
    { name: 'sensores', columns: ['time', 'mean'], values: [[1000, tag]] },
  ] }] });

  it('null/undefined = frota: UMA chamada, sem device (mesmo se params trouxer um)', async () => {
    for (const ids of [null, undefined]) {
      const f = vi.fn().mockResolvedValue(ok(series(1)));
      vi.stubGlobal('fetch', f);
      const out = await fetchNamedPerDevice('history', { campo: 'ph', periodo: '1h', device: 'x' }, ids);
      expect(f).toHaveBeenCalledTimes(1);
      expect(f.mock.calls[0][0]).toBe('/influx/q/history?campo=ph&periodo=1h');
      expect(out).toHaveLength(1);
    }
  });

  it('[] ou só ids inválidos = nenhuma chamada, resultado vazio', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    for (const ids of [[], '', ['a b'], ['x"y', "a'b", 'a'.repeat(41), null]]) {
      expect(await fetchNamedPerDevice('history', { campo: 'ph', periodo: '1h' }, ids)).toEqual([]);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('uma chamada por id válido, em ordem, só com ids validados e codificados na URL', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(ok(series(1)))
      .mockResolvedValueOnce(ok(series(2)));
    vi.stubGlobal('fetch', f);
    const out = await fetchNamedPerDevice(
      'ultimas', { periodo: '30d' },
      ['snt-0001', 'x&device=y', 'a b', 'esp_sururu', 'snt-0001', "q' OR 1=1"],
    );
    expect(f.mock.calls.map(c => c[0])).toEqual([
      '/influx/q/ultimas?periodo=30d&device=snt-0001',
      '/influx/q/ultimas?periodo=30d&device=esp_sururu',
    ]);
    for (const [url] of f.mock.calls) {
      const device = new URL(url, 'http://x').searchParams.getAll('device');
      expect(device).toHaveLength(1);
      expect(url).toContain(`device=${encodeURIComponent(device[0])}`);
    }
    expect(out.map(s => s[0].values[0][1])).toEqual([1, 2]);
  });

  it('chamadas em sequência (o nginx limita conexões simultâneas)', async () => {
    let inFlight = 0, max = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      inFlight++; max = Math.max(max, inFlight);
      await new Promise(r => setTimeout(r, 1));
      inFlight--;
      return ok(series(1));
    }));
    await fetchNamedPerDevice('export', { periodo: '1h' }, ['a', 'b', 'c']);
    expect(max).toBe(1);
  });

  it('falha de um serial rejeita o todo (sem histórico parcial)', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(ok(series(1)))
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) }));
    await expect(fetchNamedPerDevice('history', { campo: 'ph', periodo: '1h' }, ['a', 'b']))
      .rejects.toThrow('Influx 429');
  });

  it('repassa o signal a cada chamada', async () => {
    const f = vi.fn().mockResolvedValue(ok(series(1)));
    vi.stubGlobal('fetch', f);
    const ctrl = new AbortController();
    await fetchNamedPerDevice('history', { campo: 'ph', periodo: '1h' }, ['a', 'b'], { signal: ctrl.signal });
    expect(f.mock.calls.every(c => c[1].signal === ctrl.signal)).toBe(true);
  });
});
