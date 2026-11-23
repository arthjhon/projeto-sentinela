import { describe, it, expect, vi, beforeEach } from 'vitest';

const chain = vi.hoisted(() => {
  const calls = [];
  const result = { data: null, error: null };
  const q = new Proxy({}, {
    get: (_, name) => {
      if (name === 'then') return undefined;
      return (...args) => {
        calls.push([name, ...args]);
        return name === 'maybeSingle' || name === 'single' ? Promise.resolve(result) : q;
      };
    },
  });
  return { calls, result, q };
});
vi.mock('../lib/supabase', () => ({
  supabase: { from: () => chain.q, auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } },
}));
vi.mock('./auditLog', () => ({ logAcao: vi.fn(), AUDIT: { MANUTENCAO_FIM: 'm.fim', MANUTENCAO_INICIO: 'm.ini', SENSOR_CALIBRAR: 's.cal' } }));

import { manutencaoAberta, nomeDoOperador, montarCancelamento, cancelarManutencao, registrarCalibracao } from './maintenance';

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

describe('nomeDoOperador', () => {
  it('usa o nome de exibição, nunca o username nem o e-mail (a demo lê estas tabelas)', () => {
    expect(nomeDoOperador({ name: 'Ana Lima', username: 'ana' }, { email: 'ana@sentinela.app' })).toBe('Ana Lima');
    expect(nomeDoOperador(null, { email: 'ana@sentinela.app' })).toBe('desconhecido');
    expect(nomeDoOperador(undefined, undefined)).toBe('desconhecido');
  });
});

describe('montarCancelamento', () => {
  it('fecha o registro com timestamp_fim e marca "cancelada" sem exigir notas', () => {
    const p = montarCancelamento({ motivo: 'troca do pH' }, '2026-11-23T12:00:00.000Z');
    expect(p.timestamp_fim).toBe('2026-11-23T12:00:00.000Z');
    expect(p.motivo).toBe('troca do pH\n— Manutenção cancelada');
  });
});

describe('cancelarManutencao', () => {
  it('sem manutenção aberta lança erro e não escreve', async () => {
    chain.result.data = null;
    await expect(cancelarManutencao('SM-01')).rejects.toThrow(/Não há manutenção aberta/);
    expect(chain.calls.some((c) => c[0] === 'update')).toBe(false);
  });
  it('com manutenção aberta faz update de timestamp_fim por id', async () => {
    chain.result.data = { id: 7, motivo: 'x' };
    await cancelarManutencao('SM-01');
    const up = chain.calls.find((c) => c[0] === 'update');
    expect(up[1].timestamp_fim).toBeTruthy();
    expect(up[1].motivo).toMatch(/cancelada/);
    expect(chain.calls.find((c) => c[0] === 'eq' && c[1] === 'id')[2]).toBe(7);
  });
});

describe('registrarCalibracao', () => {
  it('recusa observação curta antes de tocar no banco', async () => {
    await expect(registrarCalibracao('SM-01', 'Sensor de pH', 'curto')).rejects.toThrow(/10 caracteres/);
    await expect(registrarCalibracao('SM-01', 'Sensor de pH', null)).rejects.toThrow(/10 caracteres/);
    expect(chain.calls.length).toBe(0);
  });
  it('com observação válida insere (e o nome vem do perfil, não do e-mail)', async () => {
    chain.result.data = { name: 'Ana' };
    await registrarCalibracao('SM-01', 'Sensor de pH', 'padrão pH 4,00 e 7,00');
    const ins = chain.calls.find((c) => c[0] === 'insert');
    expect(ins[1].observacao).toBe('padrão pH 4,00 e 7,00');
    expect(ins[1].sensor_key).toBe('Sensor de pH');
  });
});
