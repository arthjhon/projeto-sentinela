import { describe, it, expect } from 'vitest';
import {
  SEM_LEITURA_MS, estadoConexao, valorAtual, disponibilidade,
  qualidadeSinal, resolverSelecao, piorSaude,
} from './dashboard';

const pontos = (n) => Array.from({ length: n }, (_, i) => ({ time: i, value: 1 }));

describe('estadoConexao', () => {
  const agoraMs = 1_000_000;
  it('online com leitura recente', () => {
    expect(estadoConexao({ lwt: 'online', ultimaLeituraMs: agoraMs - 5000, agoraMs })).toBe('online');
  });
  it('online com leitura há mais de 60 s vira sem-leitura', () => {
    expect(SEM_LEITURA_MS).toBe(60000);
    expect(estadoConexao({ lwt: 'online', ultimaLeituraMs: agoraMs - 61000, agoraMs })).toBe('sem-leitura');
  });
  it('online sem leitura vira sem-leitura', () => {
    expect(estadoConexao({ lwt: 'online', agoraMs })).toBe('sem-leitura');
  });
  it('offline prevalece sobre leitura recente', () => {
    expect(estadoConexao({ lwt: 'offline', ultimaLeituraMs: agoraMs - 1000, agoraMs })).toBe('offline');
  });
  it('sem LWT: leitura recente = online; sem leitura = desconhecido', () => {
    expect(estadoConexao({ lwt: undefined, ultimaLeituraMs: agoraMs - 5000, agoraMs })).toBe('online');
    expect(estadoConexao({ lwt: undefined, agoraMs })).toBe('desconhecido');
  });
  it('sem LWT e leitura antiga = desconhecido', () => {
    expect(estadoConexao({ lwt: undefined, ultimaLeituraMs: agoraMs - 120000, agoraMs })).toBe('desconhecido');
  });
});

describe('valorAtual', () => {
  it('prefere MQTT', () => {
    expect(valorAtual({ mqtt: { ph: 7.1, _recebidoEm: 5 }, ultimas: [{ time: 1, ph: 6 }] }, 'ph'))
      .toEqual({ valor: 7.1, fonte: 'ao-vivo', em: 5 });
  });
  it('cai para gravada (time em ms ou Date)', () => {
    expect(valorAtual({ ultimas: [{ time: 9, ph: 6.9 }] }, 'ph')).toEqual({ valor: 6.9, fonte: 'gravada', em: 9 });
    expect(valorAtual({ ultimas: [{ time: new Date(9), ph: 6.9 }] }, 'ph').em).toBe(9);
  });
  it('MQTT sem o campo usa ultimas', () => {
    expect(valorAtual({ mqtt: { temperatura: 20, _recebidoEm: 5 }, ultimas: [{ time: 3, ph: 6.5 }] }, 'ph'))
      .toEqual({ valor: 6.5, fonte: 'gravada', em: 3 });
  });
  it('pula linhas mais recentes sem o campo', () => {
    expect(valorAtual({ ultimas: [{ time: 9, ph: undefined }, { time: 8, ph: 7 }] }, 'ph'))
      .toEqual({ valor: 7, fonte: 'gravada', em: 8 });
  });
  it('nada vira null', () => {
    const vazio = { valor: null, fonte: null, em: null };
    expect(valorAtual({ mqtt: undefined, ultimas: [] }, 'ph')).toEqual(vazio);
    expect(valorAtual({}, 'ph')).toEqual(vazio);
  });
  it('zero real é mantido', () => {
    expect(valorAtual({ mqtt: { turbidez: 0, _recebidoEm: 5 } }, 'turbidez')).toEqual({ valor: 0, fonte: 'ao-vivo', em: 5 });
    expect(valorAtual({ ultimas: [{ time: 2, turbidez: 0 }] }, 'turbidez').valor).toBe(0);
  });
});

describe('disponibilidade', () => {
  it('janelas com valor / janelas do período', () => {
    expect(disponibilidade(pontos(144), '24h')).toBe(1);
    expect(disponibilidade(pontos(72), '24h')).toBe(0.5);
    expect(disponibilidade([], '24h')).toBe(0);
    expect(disponibilidade(pontos(120), '1h')).toBe(1);
    expect(disponibilidade(pontos(84), '7d')).toBe(0.5);
  });
  it('período desconhecido = null', () => {
    expect(disponibilidade(pontos(3), 'xx')).toBeNull();
  });
  it('limitada a 1', () => {
    expect(disponibilidade(pontos(200), '24h')).toBe(1);
  });
  it('série ausente = 0', () => {
    expect(disponibilidade(undefined, '24h')).toBe(0);
  });
});

describe('qualidadeSinal', () => {
  it.each([[-55, 'ótimo'], [-60, 'ótimo'], [-65, 'bom'], [-70, 'bom'], [-75, 'fraco'], [-80, 'fraco'], [-85, 'muito fraco'], [null, 'sem leitura'], [undefined, 'sem leitura']])(
    '%s -> %s', (rssi, q) => expect(qualidadeSinal(rssi)).toBe(q));
});

describe('resolverSelecao', () => {
  const buoys = [{ codigo: 'SM-01' }, { codigo: 'SM-02' }];
  it('código válido', () => expect(resolverSelecao(buoys, 'SM-02')).toEqual({ codigo: 'SM-02', corrigir: false }));
  it('ausente ou inexistente cai na primeira e corrige', () => {
    expect(resolverSelecao(buoys, null)).toEqual({ codigo: 'SM-01', corrigir: true });
    expect(resolverSelecao(buoys, 'XX')).toEqual({ codigo: 'SM-01', corrigir: true });
    expect(resolverSelecao(buoys, '')).toEqual({ codigo: 'SM-01', corrigir: true });
  });
  it('cadastro vazio', () => {
    expect(resolverSelecao([], 'SM-01')).toEqual({ codigo: null, corrigir: false });
    expect(resolverSelecao(undefined, null)).toEqual({ codigo: null, corrigir: false });
  });
});

describe('piorSaude', () => {
  it('vazio = null', () => {
    expect(piorSaude([])).toBeNull();
    expect(piorSaude(undefined)).toBeNull();
  });
  it('o mais grave segundo ESTADO_META', () => {
    expect(piorSaude([{ estado: 'ok' }, { estado: 'suspeito' }])).toBe('suspeito');
    expect(piorSaude([{ estado: 'suspeito' }, { estado: 'falha' }, { estado: 'ok' }])).toBe('falha');
    expect(piorSaude([{ estado: 'ok' }, { estado: 'manutencao' }])).toBe('manutencao');
    expect(piorSaude([{ estado: 'ok' }])).toBe('ok');
  });
});
