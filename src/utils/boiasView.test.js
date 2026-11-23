import { describe, it, expect } from 'vitest';
import {
  rotuloCalibracao, divergeFirmware,
  rotuloManutencaoAberta, permissaoAcao, hrefHistorico, montarLinhaBoia,
} from './boiasView';
import { resumoBoia } from './dashboardView';
import { SEM_LEITURA_MS } from './buoyConnection';

const AGORA = Date.parse('2026-11-23T12:00:00Z');
const DIA = 86_400_000;

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
    expect('historyIds' in l).toBe(false);
  });

  describe('mesma entrada, mesmo estado que a Visão geral', () => {
    const casos = [
      ['sem nada', {}, []],
      ['só gravada recente (Influx)', {}, [{ time: new Date(AGORA - 20_000), ph: 7, turbidez: 1, temperatura: 27 }]],
      ['só gravada velha', {}, [{ time: new Date(AGORA - 3 * DIA), ph: 7, turbidez: 1, temperatura: 27 }]],
      ['LWT online + gravada recente', { 'snt-0001/availability': 'online' }, [{ time: new Date(AGORA - 5_000), ph: 7 }]],
      ['LWT offline + gravada recente', { 'snt-0001/availability': 'offline' }, [{ time: new Date(AGORA - 5_000), ph: 7 }]],
    ];
    for (const [nome, mensagens, ultimas] of casos) {
      for (const modo of ['campo', 'bancada']) {
        for (const broker of [true, false]) {
          it(`${nome} / ${modo} / broker ${broker}`, () => {
            const reg = { ...registro, modo };
            const linha = montarLinhaBoia({ registro: reg, mensagens, chegadas: {}, ultimas, agoraMs: AGORA, brokerConectado: broker });
            const ref = resumoBoia({
              buoy: reg, mqtt: { lwt: mensagens['snt-0001/availability'], sensores: null }, ultimas, healthRows: [], agoraMs: AGORA, brokerConectado: broker,
            });
            expect(linha.conexao).toBe(ref.conexao);
            expect(linha.ultimaLeituraMs).toBe(ref.ultimaMs);
          });
        }
      }
    }
    it('leitura gravada recente acende online logo após o carregamento (sem MQTT)', () => {
      const l = montarLinhaBoia(base({ ultimas: [{ time: new Date(AGORA - 20_000), ph: 7.1, turbidez: 2, temperatura: 28 }] }));
      expect(l.conexao).toBe('online');
      expect(l.idadeLeitura).toBe(20_000);
    });
    it('sensores usam o mesmo limiar da conexão: 45 s com a bóia online = ok; passou de 60 s = sem leitura', () => {
      const chegadas = (idade) => ({ 'snt-0001/sensores': { at: AGORA - idade, prevAt: null, retained: false } });
      const msg = { 'snt-0001/sensores': { ph: 7, turbidez: 1, temperatura: 27 }, 'snt-0001/availability': 'online' };
      const a = montarLinhaBoia(base({ mensagens: msg, chegadas: chegadas(45_000) }));
      expect(a.conexao).toBe('online');
      expect(a.sensores.every((x) => x.diag === 'ok')).toBe(true);
      const b = montarLinhaBoia(base({ mensagens: msg, chegadas: chegadas(SEM_LEITURA_MS + 1) }));
      expect(b.conexao).toBe('sem-leitura');
      expect(b.sensores.every((x) => x.diag === 'sem-leitura')).toBe(true);
    });
    it('valor do sensor cai na leitura gravada quando não há MQTT', () => {
      const l = montarLinhaBoia(base({ ultimas: [{ time: new Date(AGORA - 20_000), ph: 7.1, turbidez: 12.34, temperatura: 28 }] }));
      expect(l.sensores.find((x) => x.key === 'turbidez').valor).toBe('12,3 NTU');
    });
  });
});
