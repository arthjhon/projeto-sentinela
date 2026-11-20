import { describe, it, expect, vi, afterEach } from 'vitest';
import { carregarContexto } from '../services/contextoAmbiental';

// O repo não tem DOM nem @testing-library: o hook é uma casca fina sobre
// carregarContexto (estado + AbortController), que é onde está a lógica.
afterEach(() => vi.unstubAllGlobals());

const ok = (series) => ({ ok: true, status: 200, json: async () => ({ results: [{ statement_id: 0, series }] }) });
const entrada = { deviceIds: ['esp_a'], estacao: '39770000', inicio: '2026-11-13', duracao: '7d' };

function coletor() {
  const estado = { turbidez: { data: [], loading: false, error: null }, ana: { data: {}, loading: false, error: null } };
  return { estado, emit: (k, p) => { estado[k] = { ...estado[k], ...p }; } };
}

describe('carregarContexto', () => {
  it('hook keeps turbidity when ana fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => url.includes('/q/ana')
      ? { ok: false, status: 502, json: async () => ({}) }
      : ok([{ columns: ['time', 'mean'], values: [[1000, 5]] }])));
    const { estado, emit } = coletor();
    await carregarContexto(entrada, new AbortController().signal, emit);
    expect(estado.turbidez).toEqual({ data: [{ time: new Date(1000), value: 5 }], loading: false, error: null });
    expect(estado.ana.error).toBe('Influx 502');
    expect(estado.ana.loading).toBe(false);
  });

  it('keeps ana when turbidity fails; runs sequentially', async () => {
    const ordem = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      ordem.push(url.includes('/q/ana') ? 'ana' : 'turbidez');
      return url.includes('/q/ana')
        ? ok([{ columns: ['time', 'chuva', 'vazao', 'nivel'], values: [[1000, 0, 1, 2]] }])
        : { ok: false, status: 500, json: async () => ({}) };
    }));
    const { estado, emit } = coletor();
    await carregarContexto(entrada, new AbortController().signal, emit);
    expect(ordem).toEqual(['turbidez', 'ana']);
    expect(estado.turbidez.error).toBe('Influx 500');
    expect(estado.ana.data.chuva).toEqual([{ time: new Date(1000), value: 0 }]);
  });

  it('hook aborts previous request on input change (abort is not an error)', async () => {
    let sinal;
    vi.stubGlobal('fetch', vi.fn((url, { signal }) => {
      sinal = signal;
      return new Promise((_, reject) => signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }));
    }));
    const c = new AbortController();
    const { estado, emit } = coletor();
    const p = carregarContexto(entrada, c.signal, emit);
    await vi.waitFor(() => expect(sinal).toBeDefined());
    c.abort();
    await p;
    expect(sinal.aborted).toBe(true);
    expect(estado.turbidez.error).toBeNull();
    expect(estado.ana.loading).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1); // ANA nem começa
  });
});
