import { describe, it, expect, vi, beforeEach } from 'vitest';

const chain = vi.hoisted(() => {
  const calls = [];
  const result = { data: null, error: null };
  const q = new Proxy({}, {
    get: (_, name) => {
      if (name === 'then') return undefined;
      return (...args) => {
        calls.push([name, ...args]);
        return name === 'maybeSingle' ? Promise.resolve(result) : q;
      };
    },
  });
  return { calls, result, q };
});
vi.mock('../lib/supabase', () => ({ supabase: { from: () => chain.q } }));

import { manutencaoAberta } from './maintenance';

beforeEach(() => { chain.calls.length = 0; chain.result.data = null; chain.result.error = null; });

describe('manutencaoAberta', () => {
  it('com dois registros abertos pega o mais recente (order + limit 1), em vez de lançar', async () => {
    chain.result.data = { id: 2, motivo: 'x' };
    expect(await manutencaoAberta('SM-01')).toEqual({ id: 2, motivo: 'x' });
    const nomes = chain.calls.map((c) => c[0]);
    expect(nomes).toContain('limit');
    expect(chain.calls.find((c) => c[0] === 'limit')[1]).toBe(1);
    expect(chain.calls.find((c) => c[0] === 'order')).toEqual(['order', 'timestamp_inicio', { ascending: false }]);
    expect(nomes.indexOf('order')).toBeLessThan(nomes.indexOf('maybeSingle'));
  });
  it('erro de leitura continua lançando (a UI mostra indisponível)', async () => {
    chain.result.error = { message: 'boom' };
    await expect(manutencaoAberta('SM-01')).rejects.toThrow('boom');
  });
});
