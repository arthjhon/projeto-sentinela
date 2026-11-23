import { describe, it, expect } from 'vitest';
import {
  LIMITE_POR_FONTE, TIPOS, ROTULO_TIPO, ACOES_CADASTRO,
  paraFonte, fonteInicial, nomeDoSensor,
  itensManutencao, itensCalibracao, itensFirmware, itensSaude, itensCadastro,
  montarLinhaDoTempo, linhasSensores, resolverFicha, hrefFicha,
  manutencaoAbertaDaFonte, ultimoDeploySucessoDaFonte, linhaDoTempoVazia,
} from './fichaBoia';
import { formatDataHora } from './format';
import { AUDIT } from '../services/auditLog';

const AGORA = Date.parse('2026-11-23T12:00:00Z');

describe('constantes', () => {
  it('expõe limite, tipos, rótulos e ações de cadastro', () => {
    expect(LIMITE_POR_FONTE).toBe(100);
    expect(TIPOS).toEqual(['manutencao', 'calibracao', 'firmware', 'saude', 'cadastro']);
    expect(ROTULO_TIPO.saude).toBe('Saúde');
    expect(ACOES_CADASTRO).toEqual([AUDIT.BOIA_CRIAR, AUDIT.BOIA_EDITAR]);
  });
});

describe('fontes', () => {
  it('fonteInicial: cadastro sem perfil de auditoria é sem-acesso', () => {
    expect(fonteInicial('cadastro', 'visualizador')).toEqual({ estado: 'sem-acesso' });
    expect(fonteInicial('cadastro', 'operador')).toEqual({ estado: 'carregando' });
    expect(fonteInicial('firmware', 'visualizador')).toEqual({ estado: 'carregando' });
  });
  it('paraFonte nunca rejeita', async () => {
    expect(await paraFonte(Promise.reject(new Error('x')))).toEqual({ estado: 'erro', erro: 'x' });
    expect(await paraFonte(Promise.resolve([1]))).toEqual({ estado: 'ok', linhas: [1] });
  });
});

describe('nomeDoSensor', () => {
  it('chave ou nome vira nome; desconhecido volta igual', () => {
    expect(nomeDoSensor('ph')).toBe('Sensor de pH');
    expect(nomeDoSensor('Turbidez')).toBe('Turbidez');
    expect(nomeDoSensor('xyz')).toBe('xyz');
  });
});

describe('itensManutencao', () => {
  const base = { id: 1, timestamp_inicio: '2026-11-01T12:00:00Z', operador_nome: 'Ana' };
  it('fechada', () => {
    const [i] = itensManutencao([{ ...base, motivo: 'Troca de pH\n— Conclusão: ok', timestamp_fim: '2026-11-01T14:05:00Z' }]);
    expect(i).toMatchObject({
      tipo: 'manutencao', frase: 'Manutenção concluída em 2 h 5 min: Troca de pH',
      detalhe: '— Conclusão: ok', autor: 'Ana', tom: 'ok', emMs: Date.parse(base.timestamp_inicio),
    });
    expect(typeof i.id).toBe('string');
  });
  it('aberta', () => {
    const [i] = itensManutencao([{ ...base, motivo: 'Limpeza', timestamp_fim: null }]);
    expect(i).toMatchObject({ frase: 'Manutenção em andamento: Limpeza', tom: 'warn', detalhe: null });
  });
  it('cancelada', () => {
    const [i] = itensManutencao([{ ...base, motivo: 'Limpeza\n— Manutenção cancelada', timestamp_fim: '2026-11-01T12:30:00Z' }]);
    expect(i).toMatchObject({ frase: 'Manutenção cancelada após 30 min: Limpeza', tom: 'neutral' });
  });
});

describe('itensCalibracao', () => {
  it('nome e chave viram o nome do sensor', () => {
    const [a, b] = itensCalibracao([
      { id: 1, sensor_key: 'Turbidez', observacao: 'padrão 100 NTU', operador_nome: 'Bia', calibrated_at: '2026-11-02T10:00:00Z' },
      { id: 2, sensor_key: 'ph', observacao: null, operador_nome: null, calibrated_at: '2026-11-03T10:00:00Z' },
    ]);
    expect(a).toMatchObject({ tipo: 'calibracao', frase: 'Calibração registrada: Turbidez', detalhe: 'padrão 100 NTU', autor: 'Bia' });
    expect(b.frase).toBe('Calibração registrada: Sensor de pH');
    expect(b.detalhe).toBeNull();
  });
});

describe('itensFirmware', () => {
  it('pendente antigo vira sem resposta; sucesso é ok', () => {
    const [a, b] = itensFirmware([
      { id: 1, versao: '5.2.0', status: 'pendente', operador_nome: 'Ana', data_deploy: new Date(AGORA - 20 * 60_000).toISOString() },
      { id: 2, versao: '5.2.0', status: 'sucesso', operador_nome: 'Ana', data_deploy: '2026-11-01T10:00:00Z' },
    ], AGORA);
    expect(a).toMatchObject({ frase: 'Firmware v5.2.0: sem resposta', tom: 'warn' });
    expect(b).toMatchObject({ frase: 'Firmware v5.2.0: sucesso', tom: 'ok' });
  });
});

describe('itensSaude', () => {
  const row = { id: 1, device_id: 'snt-0001', sensor: 'ph', estado: 'falha', motivo: null, inicio: '2026-11-10T10:00:00Z', fim: null };
  it('em andamento no serial atual', () => {
    const [i] = itensSaude([row], { serialAtual: 'snt-0001', modo: 'campo' });
    expect(i).toMatchObject({ tipo: 'saude', frase: 'Sensor de pH: Falha (em andamento)', tom: 'bad' });
    expect(i.detalhe).toBeNull();
  });
  it('serial anterior', () => {
    const [i] = itensSaude([{ ...row, device_id: 'snt-0000' }], { serialAtual: 'snt-0001', modo: 'campo' });
    expect(i.detalhe.startsWith('serial anterior snt-0000')).toBe(true);
  });
  it('com fim; bancada é neutra', () => {
    const fim = '2026-11-10T12:00:00Z';
    const [i] = itensSaude([{ ...row, fim }], { serialAtual: 'snt-0001', modo: 'bancada' });
    expect(i.frase).toBe(`Sensor de pH: Falha até ${formatDataHora(fim)}`);
    expect(i.tom).toBe('neutral');
  });
});

describe('itensCadastro', () => {
  const mk = (id, acao, d, t) => ({ id, acao, detalhes: d, operador_nome: 'Ana', created_at: t });
  it('compara eventos consecutivos', () => {
    const rows = [
      mk(3, AUDIT.BOIA_EDITAR, { nome: 'A', deviceId: 'snt-2', modo: 'campo' }, '2026-11-03T10:00:00Z'),
      mk(2, AUDIT.BOIA_EDITAR, { nome: 'A', deviceId: 'snt-2', modo: 'campo' }, '2026-11-02T10:00:00Z'),
      mk(1, AUDIT.BOIA_CRIAR, { nome: 'A', deviceId: 'snt-1', modo: 'bancada' }, '2026-11-01T10:00:00Z'),
    ];
    // (o brief ilustra: criar -> editar(snt-2,campo) -> editar igual)
    const frases = itensCadastro(rows).map((i) => i.frase).reverse();
    expect(frases).toEqual([
      'Cadastrada (A, serial snt-1, bancada)',
      'Cadastro editado: modo bancada → campo; serial snt-1 → snt-2',
      'Cadastro editado (sem mudança de nome, serial ou modo)',
    ]);
  });
  it('primeiro editar sem predecessor e deviceId nulo', () => {
    const [i] = itensCadastro([mk(1, AUDIT.BOIA_EDITAR, { nome: 'A', deviceId: 'snt-2', modo: 'campo' }, '2026-11-01T10:00:00Z')]);
    expect(i.frase).toBe('Cadastro editado (valores: A, serial snt-2, campo)');
    const [j] = itensCadastro([mk(2, AUDIT.BOIA_CRIAR, { nome: 'A', deviceId: null, modo: 'campo' }, '2026-11-01T10:00:00Z')]);
    expect(j.frase).toBe('Cadastrada (A, sem serial, campo)');
    expect(j).toMatchObject({ tipo: 'cadastro', autor: 'Ana' });
  });
});

describe('itensCadastro com linhas legadas', () => {
  const mk = (id, acao, d, t) => ({ id, acao, detalhes: d, operador_nome: 'Ana', created_at: t });
  const frases = (rows) => itensCadastro(rows).map((i) => i.frase);
  it('sem modo: omite o campo', () => {
    expect(frases([mk(1, AUDIT.BOIA_CRIAR, { nome: 'Boia Teste Plano', deviceId: 'esp_teste_plano' }, '2026-11-01T10:00:00Z')]))
      .toEqual(['Cadastrada (Boia Teste Plano, serial esp_teste_plano)']);
  });
  it('serial vazio vira sem serial; chaves extras são ignoradas', () => {
    expect(frases([mk(1, AUDIT.BOIA_CRIAR, { nome: 'X', deviceId: '' }, '2026-11-01T10:00:00Z')])).toEqual(['Cadastrada (X, sem serial)']);
    expect(frases([mk(1, AUDIT.BOIA_CRIAR, { nome: 'X', status: 'online', deviceId: 'esp' }, '2026-11-01T10:00:00Z')]))
      .toEqual(['Cadastrada (X, serial esp)']);
  });
  it('compara só campos presentes nos dois eventos', () => {
    const rows = [
      mk(2, AUDIT.BOIA_EDITAR, { nome: 'A', status: 'online', deviceId: 'esp', modo: 'campo' }, '2026-11-02T10:00:00Z'),
      mk(1, AUDIT.BOIA_CRIAR, { nome: 'A', deviceId: 'esp' }, '2026-11-01T10:00:00Z'),
    ];
    expect(frases(rows)[0]).toBe('Cadastro editado (sem mudança de nome, serial ou modo)');
    const rows2 = [
      mk(2, AUDIT.BOIA_EDITAR, { nome: 'A', deviceId: 'esp' }, '2026-11-02T10:00:00Z'),
      mk(1, AUDIT.BOIA_CRIAR, { nome: 'A', deviceId: '' }, '2026-11-01T10:00:00Z'),
    ];
    expect(frases(rows2)[0]).toBe('Cadastro editado: serial sem serial → esp');
    const rows3 = [
      mk(2, AUDIT.BOIA_EDITAR, { nome: 'A' }, '2026-11-02T10:00:00Z'),
      mk(1, AUDIT.BOIA_CRIAR, { nome: 'B', deviceId: 'esp' }, '2026-11-01T10:00:00Z'),
    ];
    expect(frases(rows3)[0]).toBe('Cadastro editado: nome B → A');
  });
});

describe('montarLinhaDoTempo', () => {
  const man = (id, t) => ({ id, motivo: 'm', timestamp_inicio: t, timestamp_fim: null, operador_nome: 'A' });
  const cal = (id, t) => ({ id, sensor_key: 'ph', observacao: null, operador_nome: 'A', calibrated_at: t });
  const fontes = (over = {}) => ({
    manutencao: { estado: 'ok', linhas: [man(1, '2026-11-01T10:00:00Z')] },
    calibracao: { estado: 'ok', linhas: [cal(1, '2026-11-03T10:00:00Z')] },
    firmware: { estado: 'ok', linhas: [{ id: 1, versao: '1', status: 'sucesso', operador_nome: 'A', data_deploy: '2026-11-02T10:00:00Z' }] },
    saude: { estado: 'ok', linhas: [] },
    cadastro: { estado: 'ok', linhas: [] },
    ...over,
  });
  const args = { filtro: 'tudo', agoraMs: AGORA, serialAtual: null, modo: 'campo' };

  it('fonte em erro vira aviso; demais ordenadas desc', () => {
    const r = montarLinhaDoTempo({ ...args, fontes: fontes({ firmware: { estado: 'erro', erro: 'boom' } }) });
    expect(r.itens.map((i) => i.tipo)).toEqual(['calibracao', 'manutencao']);
    expect(r.avisos).toEqual([{ tipo: 'firmware', estado: 'erro', erro: 'boom' }]);
    expect(r.limitesAtingidos).toEqual([]);
  });
  it('filtro cadastro sem acesso', () => {
    const r = montarLinhaDoTempo({ ...args, filtro: 'cadastro', fontes: fontes({ cadastro: { estado: 'sem-acesso' } }) });
    expect(r.itens).toEqual([]);
    expect(r.avisos).toEqual([{ tipo: 'cadastro', estado: 'sem-acesso' }]);
  });
  it('limite atingido', () => {
    const linhas = Array.from({ length: 100 }, (_, i) => man(i, '2026-11-01T10:00:00Z'));
    const r = montarLinhaDoTempo({ ...args, fontes: fontes({ manutencao: { estado: 'ok', linhas } }) });
    expect(r.limitesAtingidos).toEqual(['manutencao']);
  });
  it('data inválida por último', () => {
    const r = montarLinhaDoTempo({ ...args, fontes: fontes({ manutencao: { estado: 'ok', linhas: [man(1, 'lixo')] } }) });
    expect(r.itens.at(-1).tipo).toBe('manutencao');
    expect(Number.isNaN(r.itens.at(-1).emMs)).toBe(true);
  });
});

describe('linhasSensores', () => {
  const ok = (linhas) => ({ estado: 'ok', linhas });
  const base = { saudeAtual: ok([]), calibracoes: ok([]), serial: 'snt-0001', modo: 'campo', firmwareCalibrado: undefined };
  it('sem serial', () => {
    const l = linhasSensores({ ...base, serial: null });
    expect(l).toHaveLength(3);
    expect(l.every((x) => x.saude.tipo === 'sem-serial')).toBe(true);
  });
  it('erro não vira sem-avaliacao', () => {
    const l = linhasSensores({ ...base, saudeAtual: { estado: 'erro', erro: 'x' } });
    expect(l.every((x) => x.saude.tipo === 'erro')).toBe(true);
    expect(linhasSensores(base).every((x) => x.saude.tipo === 'sem-avaliacao')).toBe(true);
    expect(linhasSensores({ ...base, saudeAtual: { estado: 'carregando' } })[0].saude.tipo).toBe('carregando');
  });
  it('saúde com valor', () => {
    const l = linhasSensores({ ...base, saudeAtual: ok([{ device_id: 'snt-0001', sensor: 'ph', estado: 'suspeito', motivo: 'm', desde: 'd' }]) });
    expect(l.find((x) => x.key === 'ph').saude).toMatchObject({ tipo: 'valor', estado: 'suspeito', label: 'Suspeito', tom: 'warn', motivo: 'm', desde: 'd' });
  });
  it('calibração por nome ou chave', () => {
    const reg = { id: 1, sensor_key: 'Turbidez', calibrated_at: '2026-11-01T00:00:00Z' };
    const l = linhasSensores({ ...base, calibracoes: ok([reg]) });
    expect(l.find((x) => x.key === 'turbidez').calibracao).toEqual({ tipo: 'valor', registro: reg });
    expect(l.find((x) => x.key === 'ph').calibracao.tipo).toBe('nenhuma');
    expect(linhasSensores({ ...base, calibracoes: { estado: 'erro', erro: 'x' } })[0].calibracao.tipo).toBe('erro');
    expect(linhasSensores({ ...base, calibracoes: { estado: 'carregando' } })[0].calibracao.tipo).toBe('carregando');
  });
  it('aviso de firmware', () => {
    expect(linhasSensores({ ...base, firmwareCalibrado: false }).every((x) => x.avisoFirmware)).toBe(true);
    expect(linhasSensores({ ...base, firmwareCalibrado: true }).some((x) => x.avisoFirmware)).toBe(false);
  });
});

describe('resolverFicha', () => {
  const outra = { codigo: 'X' };
  it('estados', () => {
    expect(resolverFicha({ codigo: 'A', loading: true, buoys: [] })).toEqual({ tipo: 'carregando' });
    expect(resolverFicha({ codigo: 'A', loading: true, buoys: [outra] })).toEqual({ tipo: 'carregando' });
    expect(resolverFicha({ codigo: 'A', loading: false, buoys: [outra] })).toEqual({ tipo: 'nao-encontrada' });
    expect(resolverFicha({ codigo: 'A', loading: false, isFallback: true, buoys: [outra] })).toEqual({ tipo: 'indisponivel' });
    const a = { codigo: 'A' };
    expect(resolverFicha({ codigo: 'A', loading: false, isFallback: true, buoys: [a] })).toEqual({ tipo: 'encontrada', buoy: a });
  });
});

describe('hrefFicha', () => {
  it('codifica o código', () => {
    expect(hrefFicha('SM 01#á?')).toBe('/admin/boias/SM%2001%23%C3%A1%3F');
  });
});

describe('manutencaoAbertaDaFonte', () => {
  const aberta = { id: 2, timestamp_fim: null };
  it('quatro estados', () => {
    expect(manutencaoAbertaDaFonte({ estado: 'carregando' })).toBeUndefined();
    expect(manutencaoAbertaDaFonte({ estado: 'erro', erro: 'x' })).toBe('erro');
    expect(manutencaoAbertaDaFonte({ estado: 'ok', linhas: [{ id: 1, timestamp_fim: 'f' }] })).toBeNull();
    expect(manutencaoAbertaDaFonte({ estado: 'ok', linhas: [{ id: 3, timestamp_fim: 'f' }, aberta] })).toBe(aberta);
  });
});

describe('ultimoDeploySucessoDaFonte', () => {
  it('estados', () => {
    expect(ultimoDeploySucessoDaFonte({ estado: 'carregando' })).toBeUndefined();
    expect(ultimoDeploySucessoDaFonte({ estado: 'erro', erro: 'x' })).toEqual({ ok: false, erro: 'x' });
    expect(ultimoDeploySucessoDaFonte({ estado: 'ok', linhas: [{ status: 'erro' }] })).toEqual({ ok: true, valor: null });
    const ok = { id: 2, status: 'sucesso' };
    expect(ultimoDeploySucessoDaFonte({ estado: 'ok', linhas: [{ status: 'pendente' }, ok, { status: 'sucesso', id: 1 }] })).toEqual({ ok: true, valor: ok });
  });
});

describe('linhaDoTempoVazia', () => {
  it('vazia sem avisos', () => {
    expect(linhaDoTempoVazia({ itens: [], avisos: [] })).toBe(true);
  });
  it('vazia quando todos os avisos são sem-acesso', () => {
    expect(linhaDoTempoVazia({ itens: [], avisos: [{ tipo: 'cadastro', estado: 'sem-acesso' }] })).toBe(true);
  });
  it('não vazia com aviso de erro ou carregando', () => {
    expect(linhaDoTempoVazia({ itens: [], avisos: [{ tipo: 'saude', estado: 'erro' }] })).toBe(false);
    expect(linhaDoTempoVazia({ itens: [], avisos: [{ tipo: 'saude', estado: 'carregando' }] })).toBe(false);
    expect(linhaDoTempoVazia({ itens: [], avisos: [{ tipo: 'cadastro', estado: 'sem-acesso' }, { tipo: 'saude', estado: 'erro' }] })).toBe(false);
  });
  it('não vazia com qualquer item', () => {
    expect(linhaDoTempoVazia({ itens: [{ id: 'x' }], avisos: [] })).toBe(false);
  });
});
