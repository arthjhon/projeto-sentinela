import { describe, it, expect, vi, beforeEach } from 'vitest';

const chain = vi.hoisted(() => {
  const calls = [];
  const res = { data: null, error: null };
  const q = new Proxy({}, {
    get: (_, name) => {
      if (name === 'then') return (ok) => ok({ data: res.data, error: res.error });
      return (...args) => { calls.push([name, ...args]); return q; };
    },
  });
  return { calls, res, q };
});
vi.mock('../lib/supabase', () => ({ supabase: { from: () => chain.q } }));

import { montarRegistro, listarAuditoriaDaEntidade, AUDIT } from './auditLog.js';

describe('montarRegistro', () => {
  it('never carries operador_nome (the server derives it from profiles)', () => {
    const r = montarRegistro({ id: 'u1', email: 'x@y' }, AUDIT.BOIA_EDITAR, 'SM-01', { a: 1 });
    expect(r).toEqual({
      operador_id: 'u1',
      acao: 'boia.editar',
      entidade_afetada: 'SM-01',
      detalhes: { a: 1 },
    });
    expect(r).not.toHaveProperty('operador_nome');
  });

  it('normalizes a missing target and details', () => {
    const r = montarRegistro({ id: 'u1' }, AUDIT.CONFIG_ALTERAR, undefined, undefined);
    expect(r.entidade_afetada).toBeNull();
    expect(r.detalhes).toEqual({});
  });

  it('returns null without a session user (RLS would refuse it anyway)', () => {
    expect(montarRegistro(null, AUDIT.CONFIG_ALTERAR, 'x', {})).toBeNull();
  });
});

describe('listarAuditoriaDaEntidade', () => {
  beforeEach(() => { chain.calls.length = 0; chain.res.data = null; chain.res.error = null; });
  it('filters by entity and actions, newest first, with limit', async () => {
    chain.res.data = [{ id: 1 }];
    expect(await listarAuditoriaDaEntidade('SM-01', [AUDIT.BOIA_CRIAR, AUDIT.BOIA_EDITAR], 100)).toEqual([{ id: 1 }]);
    expect(chain.calls).toContainEqual(['eq', 'entidade_afetada', 'SM-01']);
    expect(chain.calls).toContainEqual(['in', 'acao', ['boia.criar', 'boia.editar']]);
    expect(chain.calls).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(chain.calls).toContainEqual(['limit', 100]);
  });
  it('returns [] on null data and throws on error', async () => {
    expect(await listarAuditoriaDaEntidade('SM-01', ['x'], 5)).toEqual([]);
    chain.res.error = { message: 'rls' };
    await expect(listarAuditoriaDaEntidade('SM-01', ['x'], 5)).rejects.toThrow('rls');
  });
});
