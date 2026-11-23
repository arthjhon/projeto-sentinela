import { describe, it, expect } from 'vitest';
import { carregarConfiguracoes } from './settingsLoad';

const ok = (map) => async (key, fallback) => (key in map ? map[key] : fallback);
const KEYS = { metaKey: 'funding_goal', raioKey: 'map_collection_radius' };

describe('carregarConfiguracoes', () => {
  it('loads both settings and normalizes the radius', async () => {
    const r = await carregarConfiguracoes(ok({ funding_goal: { meta: 100, arrecadado: 5 }, map_collection_radius: { raio_m: 400 } }), KEYS);
    expect(r.meta).toEqual({ ok: true, valor: { meta: 100, arrecadado: 5 } });
    expect(r.raio).toEqual({ ok: true, valor: 400 });
  });
  it('nothing saved yet is a legitimate default (ok)', async () => {
    const r = await carregarConfiguracoes(ok({}), KEYS);
    expect(r.meta).toEqual({ ok: true, valor: { meta: 0, arrecadado: 0 } });
    expect(r.raio.ok).toBe(true);
  });
  it('failed read is ok:false with NO value, so the form is not filled with a default and cannot overwrite', async () => {
    const get = async (key) => { if (key === 'funding_goal') throw new Error('boom'); return { raio_m: 300 }; };
    const r = await carregarConfiguracoes(get, KEYS);
    expect(r.meta).toEqual({ ok: false, erro: 'boom' });
    expect(r.meta.valor).toBeUndefined();
    expect(r.raio.ok).toBe(true);
  });
  it('both failing reports both', async () => {
    const r = await carregarConfiguracoes(async () => { throw new Error('rede'); }, KEYS);
    expect(r.meta.ok).toBe(false);
    expect(r.raio).toEqual({ ok: false, erro: 'rede' });
  });
});
