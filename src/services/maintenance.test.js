import { describe, it, expect, vi, beforeEach } from 'vitest';

const chain = vi.hoisted(() => {
  const calls = [];
  const result = { data: null, error: null };
  const lista = { listResult: null, listError: null };
  const q = new Proxy({}, {
    get: (_, name) => {
      if (name === 'then') {
        // consulta de lista (sem single/maybeSingle): resolve só quando o teste definiu listResult/listError
        if (lista.listResult === null && lista.listError === null) return undefined;
        return (res) => res({ data: lista.listResult, error: lista.listError });
      }
      return (...args) => {
        calls.push([name, ...args]);
        return name === 'maybeSingle' || name === 'single' ? Promise.resolve(result) : q;
      };
    },
  });
  return { calls, result, q, lista };
});
vi.mock('../lib/supabase', () => ({
  supabase: { from: () => chain.q, auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } },
}));
vi.mock('./auditLog', () => ({ logAcao: vi.fn(), AUDIT: { MANUTENCAO_FIM: 'm.fim', MANUTENCAO_CANCELAR: 'm.cancel', MANUTENCAO_INICIO: 'm.ini', SENSOR_CALIBRAR: 's.cal' } }));

import { logAcao } from './auditLog';
import {
  manutencaoAberta, nomeDoOperador, montarCancelamento, cancelarManutencao, registrarCalibracao,
  manutencoesAbertas, listarManutencoes, listarCalibracoes, ultimaCalibracaoPorSensor, ultimasCalibracoes, SEM_MANUTENCAO_ABERTA, MIN_OBSERVACAO, validarObservacaoCalibracao,
} from './maintenance';

beforeEach(() => { chain.calls.length = 0; chain.result.data = null; chain.result.error = null; chain.lista.listResult = null; chain.lista.listError = null; vi.clearAllMocks(); });

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

describe('montarCancelamento com notas', () => {
  it('anexa as notas digitadas ao registro cancelado', () => {
    const p = montarCancelamento({ motivo: 'troca do pH' }, '2026-11-23T12:00:00.000Z', '  limpei o sensor  ');
    expect(p.motivo).toBe('troca do pH\n— Manutenção cancelada\n— Notas: limpei o sensor');
  });
  it('notas vazias não aparecem', () => {
    expect(montarCancelamento({ motivo: 'x' }, 'f', '   ').motivo).toBe('x\n— Manutenção cancelada');
    expect(montarCancelamento({ motivo: 'x' }, 'f').motivo).toBe('x\n— Manutenção cancelada');
  });
});

describe('validarObservacaoCalibracao', () => {
  it('exige pelo menos 10 caracteres depois do trim', () => {
    expect(MIN_OBSERVACAO).toBe(10);
    expect(validarObservacaoCalibracao('').ok).toBe(false);
    expect(validarObservacaoCalibracao('   curto   ').ok).toBe(false);
    expect(validarObservacaoCalibracao(undefined).ok).toBe(false);
    expect(validarObservacaoCalibracao('pH 4,00 e 7,00').ok).toBe(true);
    expect(validarObservacaoCalibracao('123456789 ').ok).toBe(false);
  });
  it('devolve o texto limpo e uma mensagem quando recusa', () => {
    expect(validarObservacaoCalibracao('  solução 4,00  ').texto).toBe('solução 4,00');
    expect(validarObservacaoCalibracao('x').erro).toMatch(/10 caracteres/);
  });
});

describe('manutencoesAbertas', () => {
  it('uma consulta só (timestamp_fim nulo) e devolve codigo -> registro mais recente', async () => {
    chain.lista.listResult = [
      { id: 1, boia_id: 'SM-01', timestamp_inicio: '2026-11-20T00:00:00Z' },
      { id: 2, boia_id: 'SM-01', timestamp_inicio: '2026-11-22T00:00:00Z' },
      { id: 3, boia_id: 'SM-02', timestamp_inicio: '2026-11-21T00:00:00Z' },
    ];
    const m = await manutencoesAbertas(['SM-01', 'SM-02', 'SM-03']);
    expect(m['SM-01'].id).toBe(2);
    expect(m['SM-02'].id).toBe(3);
    expect(m['SM-03']).toBeNull();
    expect(chain.calls.filter((c) => c[0] === 'is')).toEqual([['is', 'timestamp_fim', null]]);
    expect(chain.calls.filter((c) => c[0] === 'select').length).toBe(1);
  });
  it('erro de leitura lança', async () => {
    chain.lista.listError = { message: 'boom' };
    await expect(manutencoesAbertas(['SM-01'])).rejects.toThrow('boom');
  });
});

describe('cancelarManutencao', () => {
  it('sem manutenção aberta lança erro com código estável', async () => {
    chain.result.data = null;
    await expect(cancelarManutencao('SM-01')).rejects.toMatchObject({ code: SEM_MANUTENCAO_ABERTA });
  });
  it('grava as notas e registra a ação própria "cancelar"', async () => {
    chain.result.data = { id: 7, motivo: 'x' };
    await cancelarManutencao('SM-01', 'limpei o sensor');
    expect(chain.calls.find((c) => c[0] === 'update')[1].motivo).toMatch(/Notas: limpei o sensor/);
    expect(logAcao).toHaveBeenCalledWith('m.cancel', 'SM-01', expect.objectContaining({ cancelada: true }));
  });
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

describe('leituras por bóia com limite', () => {
  it('listarManutencoes aplica .limit', async () => {
    chain.lista.listResult = [{ id: 1 }];
    expect(await listarManutencoes('SM-01', 100)).toEqual([{ id: 1 }]);
    expect(chain.calls).toContainEqual(['eq', 'boia_id', 'SM-01']);
    expect(chain.calls).toContainEqual(['order', 'timestamp_inicio', { ascending: false }]);
    expect(chain.calls).toContainEqual(['limit', 100]);
  });
  it('listarManutencoes lança em erro e devolve [] com data nula', async () => {
    chain.lista.listError = { message: 'boom' };
    await expect(listarManutencoes('SM-01', 100)).rejects.toThrow('boom');
    chain.lista.listError = null;
    chain.lista.listResult = [];
    expect(await listarManutencoes('SM-01', 100)).toEqual([]);
  });
  it('listarCalibracoes encadeia eq/order/limit e lança em erro', async () => {
    chain.lista.listResult = [{ id: 3 }];
    expect(await listarCalibracoes('SM-01', 50)).toEqual([{ id: 3 }]);
    expect(chain.calls).toContainEqual(['eq', 'boia_id', 'SM-01']);
    expect(chain.calls).toContainEqual(['order', 'calibrated_at', { ascending: false }]);
    expect(chain.calls).toContainEqual(['limit', 50]);
    chain.lista.listResult = null;
    chain.lista.listError = { message: 'rls' };
    await expect(listarCalibracoes('SM-01', 50)).rejects.toThrow('rls');
  });
  it('ultimaCalibracaoPorSensor fica com a primeira ocorrência por sensor_key', () => {
    const r = ultimaCalibracaoPorSensor([
      { sensor_key: 'Turbidez', id: 2 }, { sensor_key: 'Turbidez', id: 1 }, { sensor_key: 'Termômetro', id: 3 },
    ]);
    expect(r).toEqual({ Turbidez: { sensor_key: 'Turbidez', id: 2 }, 'Termômetro': { sensor_key: 'Termômetro', id: 3 } });
    expect(ultimaCalibracaoPorSensor([])).toEqual({});
  });
  it('ultimasCalibracoes segue devolvendo o último por sensor', async () => {
    chain.lista.listResult = [{ sensor_key: 'pH', id: 9 }, { sensor_key: 'pH', id: 8 }];
    expect(await ultimasCalibracoes('SM-01')).toEqual({ pH: { sensor_key: 'pH', id: 9 } });
  });
});
