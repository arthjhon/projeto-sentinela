import { describe, it, expect } from 'vitest';
import { conexaoDoRegistro, saudeDoStatus, frotaDoOta } from './conexaoFrota';
import { montarLinhaBoia } from './boiasView';
import { resumoBoia, mensagemDaSessao } from './dashboardView';

const AGORA = Date.parse('2026-11-23T12:00:00Z');
const campo = { codigo: 'SM-01', nome: 'Mundaú', deviceId: 'snt-0001', modo: 'campo', lagoa: 'mundau' };
const semSerial = { codigo: 'SM-02', nome: 'Sul', deviceId: null, modo: 'campo', lagoa: 'mundau' };
const gravada = (msAtras) => [{ time: AGORA - msAtras }];

describe('conexaoDoRegistro (mesma entrada da Visão geral)', () => {
  it('recém-aberta, sem MQTT, com leitura gravada há 10 s: online (não "sem leitura")', () => {
    const r = conexaoDoRegistro({ registro: campo, mensagens: {}, chegadas: {}, ultimas: gravada(10_000), agoraMs: AGORA });
    expect(r.estado).toBe('online');
    expect(r.ultimaMs).toBe(AGORA - 10_000);
  });
  it('LWT online e só leitura gravada velha: sem-leitura', () => {
    const r = conexaoDoRegistro({
      registro: campo, mensagens: { 'snt-0001/availability': 'online' }, chegadas: {}, ultimas: gravada(5 * 60_000), agoraMs: AGORA,
    });
    expect(r.estado).toBe('sem-leitura');
  });
  it('sem serial válido: sem-hardware; broker caído: sem-broker', () => {
    expect(conexaoDoRegistro({ registro: semSerial, mensagens: {}, chegadas: {}, agoraMs: AGORA }).estado).toBe('sem-hardware');
    expect(conexaoDoRegistro({ registro: campo, mensagens: {}, chegadas: {}, agoraMs: AGORA, brokerConectado: false }).estado).toBe('sem-broker');
  });
  it('paridade: igual a resumoBoia (Visão geral) e a montarLinhaBoia (Bóias) em toda a matriz', () => {
    const chegadaViva = { at: AGORA - 5_000, retained: false };
    const cenarios = [];
    for (const lwt of [undefined, 'online', 'offline']) {
      for (const ult of [[], gravada(10_000), gravada(10 * 60_000)]) {
        for (const cheg of [undefined, chegadaViva, { at: AGORA - 1000, retained: true }]) {
          for (const reg of [campo, { ...campo, modo: 'bancada' }, semSerial]) {
            for (const broker of [true, false]) cenarios.push({ lwt, ult, cheg, reg, broker });
          }
        }
      }
    }
    for (const { lwt, ult, cheg, reg, broker } of cenarios) {
      const mensagens = { 'snt-0001/availability': lwt, 'snt-0001/sensores': { temperatura: 27 } };
      const chegadas = cheg ? { 'snt-0001/sensores': cheg } : {};
      const got = conexaoDoRegistro({ registro: reg, mensagens, chegadas, ultimas: ult, agoraMs: AGORA, brokerConectado: broker });
      const overview = resumoBoia({
        buoy: reg,
        // a Visão geral só monta o mqtt da bóia com serial válido
        mqtt: reg.deviceId ? { lwt, sensores: mensagemDaSessao(mensagens['snt-0001/sensores'], cheg) } : {},
        ultimas: ult, healthRows: [], agoraMs: AGORA, brokerConectado: broker,
      });
      const bois = montarLinhaBoia({ registro: reg, mensagens, chegadas, ultimas: ult, agoraMs: AGORA, brokerConectado: broker });
      expect(got.estado).toBe(overview.conexao);
      expect(got.estado).toBe(bois.conexao);
      expect(got.ultimaMs).toBe(overview.ultimaMs);
    }
  });
});

describe('saudeDoStatus (idade de firmware/RSSI/uptime)', () => {
  const status = { firmware: 'v5.1', rssi: -65, uptime: 7200 };
  it('mensagem viva: valores formatados e idade da chegada', () => {
    const s = saudeDoStatus({ status, chegada: { at: AGORA - 30_000, retained: false }, agoraMs: AGORA });
    expect(s).toMatchObject({ firmware: 'v5.1', rssi: '-65 dBm (bom)', uptime: '2 h 0 min', idade: 'há 30 s', retida: false });
  });
  it('retida: sem idade (a chegada é do subscribe, não da bóia) e marcada', () => {
    const s = saudeDoStatus({ status, chegada: { at: AGORA - 30_000, retained: true }, agoraMs: AGORA });
    expect(s.idade).toBeNull();
    expect(s.retida).toBe(true);
  });
  it('sem /status: tudo nulo, nada inventado', () => {
    expect(saudeDoStatus({ status: undefined, chegada: undefined, agoraMs: AGORA }))
      .toEqual({ firmware: null, rssi: null, uptime: null, idade: null, retida: false });
  });
  it('payload que não é objeto é ignorado', () => {
    expect(saudeDoStatus({ status: 'x', chegada: { at: AGORA, retained: false }, agoraMs: AGORA }).firmware).toBeNull();
  });
});

describe('frotaDoOta', () => {
  const fleet = [{ id: 'SM-01', deviceId: 'snt-0001', name: 'semente', location: 'Lagoa' }];
  const registro = [{ codigo: 'SM-01', nome: 'Real', deviceId: 'snt-0009', modo: 'campo' }];
  it('carregando e sem lista: vazio (não mostra a semente como se fosse a frota)', () => {
    expect(frotaDoOta({ registro: [], carregando: true, fleet })).toEqual([]);
  });
  it('carregado: identidade do cadastro, metadados da semente por código', () => {
    const [b] = frotaDoOta({ registro, carregando: false, fleet });
    expect(b).toMatchObject({ id: 'SM-01', name: 'Real', deviceId: 'snt-0009', modo: 'campo', location: 'Lagoa' });
  });
  it('deviceId fora do formato vira null (serialValido), nunca vai ao broker', () => {
    const [b] = frotaDoOta({ registro: [{ ...registro[0], deviceId: 'esp; drop' }], carregando: false, fleet });
    expect(b.deviceId).toBeNull();
  });
  it('carregado e vazio: nenhuma bóia', () => {
    expect(frotaDoOta({ registro: [], carregando: false, fleet })).toEqual([]);
  });
});
