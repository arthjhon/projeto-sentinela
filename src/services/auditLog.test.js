import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));

import { montarRegistro, AUDIT } from './auditLog.js';

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
