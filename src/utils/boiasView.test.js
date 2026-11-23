import { describe, it, expect } from 'vitest';
import {
  MIN_OBSERVACAO, validarObservacaoCalibracao, rotuloCalibracao, divergeFirmware,
  rotuloManutencaoAberta, permissaoAcao, hrefHistorico, montarLinhaBoia, valorSensor,
} from './boiasView';

const AGORA = Date.parse('2026-11-23T12:00:00Z');
const DIA = 86_400_000;

describe('validarObservacaoCalibracao', () => {
  it('exige pelo menos 10 caracteres depois do trim', () => {
    expect(MIN_OBSERVACAO).toBe(10);
    expect(validarObservacaoCalibracao('').ok).toBe(false);
    expect(validarObservacaoCalibracao('   curto   ').ok).toBe(false);
    expect(validarObservacaoCalibracao(undefined).ok).toBe(false);
    expect(validarObservacaoCalibracao('pH 4,00 e 7,00').ok).toBe(true);
    expect(validarObservacaoCalibracao('1234567890').ok).toBe(true);
    expect(validarObservacaoCalibracao('123456789 ').ok).toBe(false);
  });
  it('devolve o texto limpo e uma mensagem quando recusa', () => {
    expect(validarObservacaoCalibracao('  solução 4,00  ').texto).toBe('solução 4,00');
    expect(validarObservacaoCalibracao('x').erro).toMatch(/10 caracteres/);
  });
});

describe('rotuloCalibracao', () => {
  it('registrada por X em DD/MM/AAAA (Maceió)', () => {
    expect(rotuloCalibracao({ operador_nome: 'Ana Lima', calibrated_at: '2026-11-20T15:00:00Z' }))
      .toBe('registrada por Ana Lima em 20/11/2026');
  });
  it('sem registro: nunca registrada; sem nome: não inventa', () => {
    expect(rotuloCalibracao(undefined)).toBe('nunca registrada');
    expect(rotuloCalibracao({ calibrated_at: '2026-11-20T15:00:00Z' })).toBe('registrada em 20/11/2026');
  });
});

describe('divergeFirmware', () => {
  it('só quando o firmware informa calibrated === false', () => {
    expect(divergeFirmware({ calibrated: false })).toBe(true);
    expect(divergeFirmware({ calibrated: true })).toBe(false);
    expect(divergeFirmware({})).toBe(false);
    expect(divergeFirmware(null)).toBe(false);
  });
});

describe('rotuloManutencaoAberta', () => {
  const inicio = (d) => new Date(AGORA - d * DIA).toISOString();
  it('sem manutenção = null; erro de leitura nunca some', () => {
    expect(rotuloManutencaoAberta(null, AGORA)).toBeNull();
    expect(rotuloManutencaoAberta(undefined, AGORA)).toBeNull();
    expect(rotuloManutencaoAberta('erro', AGORA)).toBe('manutenção: indisponível');
  });
  it('dias decorridos desde a abertura', () => {
    expect(rotuloManutencaoAberta({ timestamp_inicio: inicio(3.4) }, AGORA)).toBe('em manutenção há 3 d');
    expect(rotuloManutencaoAberta({ timestamp_inicio: inicio(1) }, AGORA)).toBe('em manutenção há 1 d');
    expect(rotuloManutencaoAberta({ timestamp_inicio: inicio(0.2) }, AGORA)).toBe('em manutenção desde hoje');
  });
  it('data inválida não vira número falso', () => {
    expect(rotuloManutencaoAberta({ timestamp_inicio: 'x' }, AGORA)).toBe('em manutenção');
  });
});

describe('permissaoAcao', () => {
  it('admin pode tudo', () => {
    for (const a of ['cadastro', 'manutencao', 'calibracao']) expect(permissaoAcao('admin', a).permitido).toBe(true);
  });
  it('operador: manutenção e calibração sim, cadastro não (com explicação)', () => {
    expect(permissaoAcao('operador', 'manutencao').permitido).toBe(true);
    const c = permissaoAcao('operador', 'cadastro');
    expect(c.permitido).toBe(false);
    expect(c.motivo).toMatch(/administrador/i);
  });
  it('demo: nada, com explicação de demonstração', () => {
    for (const a of ['cadastro', 'manutencao', 'calibracao']) {
      const p = permissaoAcao('visualizador', a);
      expect(p.permitido).toBe(false);
      expect(p.motivo).toMatch(/demonstra/i);
    }
  });
  it('perfil desconhecido ou ausente: bloqueado', () => {
    expect(permissaoAcao(undefined, 'manutencao').permitido).toBe(false);
    expect(permissaoAcao('x', 'cadastro').permitido).toBe(false);
  });
});

describe('hrefHistorico', () => {
  it('leva ao painel com a bóia selecionada', () => {
    expect(hrefHistorico('SM-01')).toBe('/admin/dashboard?boia=SM-01');
    expect(hrefHistorico('A B&c')).toBe('/admin/dashboard?boia=A%20B%26c');
  });
});

describe('valorSensor', () => {
  it('usa as casas de WATER_PARAMS e vírgula pt-BR', () => {
    expect(valorSensor(12.34, 'turbidez')).toBe('12,3 NTU');
    expect(valorSensor(7.2, 'ph')).toBe('7,20');
    expect(valorSensor(27.55, 'temperatura')).toMatch(/^27,[56] °C$/);
    expect(valorSensor(undefined, 'ph')).toBe('sem leitura');
  });
});

describe('montarLinhaBoia', () => {
  const registro = { codigo: 'SM-01', nome: 'Canal', deviceId: 'snt-0001', modo: 'campo', lagoa: 'mundau', lat: -9.6, lng: -35.7 };
  const base = (extra = {}) => ({
    registro, mensagens: {}, chegadas: {}, agoraMs: AGORA, brokerConectado: true, ...extra,
  });

  it('leitura retida não conta: bóia fica sem leitura, sensores sem leitura', () => {
    const l = montarLinhaBoia(base({
      mensagens: { 'snt-0001/sensores': { ph: 7, turbidez: 1, temperatura: 27 }, 'snt-0001/availability': 'online' },
      chegadas: { 'snt-0001/sensores': { at: AGORA - 1000, prevAt: null, retained: true } },
    }));
    expect(l.ultimaLeituraMs).toBeNull();
    expect(l.idadeLeitura).toBeNull();
    expect(l.conexao).toBe('sem-leitura');
    expect(l.sensores.every((s) => s.diag === 'sem-leitura')).toBe(true);
  });

  it('leitura viva: online, idade e valores formatados', () => {
    const l = montarLinhaBoia(base({
      mensagens: { 'snt-0001/sensores': { ph: 7.21, turbidez: 12.34, temperatura: 27.5 }, 'snt-0001/availability': 'online' },
      chegadas: { 'snt-0001/sensores': { at: AGORA - 2000, prevAt: AGORA - 7000, retained: false } },
    }));
    expect(l.conexao).toBe('online');
    expect(l.idadeLeitura).toBe(2000);
    expect(l.intervaloMs).toBe(5000);
    const t = l.sensores.find((s) => s.key === 'turbidez');
    expect(t.valor).toBe('12,3 NTU');
    expect(t.diag).toBe('ok');
  });

  it('status retido é descartado; status vivo traz a idade', () => {
    const retido = montarLinhaBoia(base({
      mensagens: { 'snt-0001/status': { rssi: -60, uptime: 100 } },
      chegadas: { 'snt-0001/status': { at: AGORA - 500, retained: true } },
    }));
    expect(retido.saude).toEqual({});
    expect(retido.statusIdadeMs).toBeNull();
    const vivo = montarLinhaBoia(base({
      mensagens: { 'snt-0001/status': { rssi: -60, uptime: 100 } },
      chegadas: { 'snt-0001/status': { at: AGORA - 4000, retained: false } },
    }));
    expect(vivo.saude.rssi).toBe(-60);
    expect(vivo.statusIdadeMs).toBe(4000);
  });

  it('sem serial: sem hardware; broker fora: sem-broker (nunca afirma online)', () => {
    expect(montarLinhaBoia(base({ registro: { ...registro, deviceId: null } })).conexao).toBe('sem-hardware');
    expect(montarLinhaBoia(base({ brokerConectado: false })).conexao).toBe('sem-broker');
  });

  it('bancada sem leitura recente não vira offline vermelho', () => {
    const l = montarLinhaBoia(base({ registro: { ...registro, modo: 'bancada' } }));
    expect(l.conexao).toBe('bancada-offline');
    expect(l.tom).toBe('neutral');
  });

  it('identidade e localização do registro', () => {
    const l = montarLinhaBoia(base());
    expect(l.id).toBe('SM-01');
    expect(l.nome).toBe('Canal');
    expect(l.modo).toBe('campo');
    expect(l.local).toBe('Lagoa Mundaú');
    expect(l.historyIds).toEqual(['snt-0001']);
  });
});
