import { describe, it, expect } from 'vitest';
import {
  SEM_LEITURA_MS, ESTADOS_CONEXAO, ROTULO_CONEXAO, TOM_CONEXAO, estadoConexao, leituraMsDaChegada,
} from './buoyConnection';

const agoraMs = 1_000_000;
const recente = agoraMs - 5000;
const velha = agoraMs - SEM_LEITURA_MS - 1000;

describe('SEM_LEITURA_MS', () => {
  it('is a single 60 s threshold', () => expect(SEM_LEITURA_MS).toBe(60000));
  it('boundary: exactly 60 s is still recent, 60.001 s is not', () => {
    expect(estadoConexao({ lwt: 'online', ultimaLeituraMs: agoraMs - 60000, agoraMs })).toBe('online');
    expect(estadoConexao({ lwt: 'online', ultimaLeituraMs: agoraMs - 60001, agoraMs })).toBe('sem-leitura');
  });
});

describe('estadoConexao — campo', () => {
  it('lwt online + recent reading = online', () => {
    expect(estadoConexao({ lwt: 'online', ultimaLeituraMs: recente, agoraMs })).toBe('online');
  });
  it('lwt online without a recent reading = sem-leitura (stale or missing)', () => {
    expect(estadoConexao({ lwt: 'online', ultimaLeituraMs: velha, agoraMs })).toBe('sem-leitura');
    expect(estadoConexao({ lwt: 'online', agoraMs })).toBe('sem-leitura');
    expect(estadoConexao({ lwt: 'online', ultimaLeituraMs: null, agoraMs })).toBe('sem-leitura');
  });
  it('lwt offline wins over a fresh reading', () => {
    expect(estadoConexao({ lwt: 'offline', ultimaLeituraMs: recente, agoraMs })).toBe('offline');
  });
  it('no lwt: recent reading = online, else desconhecido', () => {
    expect(estadoConexao({ lwt: undefined, ultimaLeituraMs: recente, agoraMs })).toBe('online');
    expect(estadoConexao({ lwt: undefined, agoraMs })).toBe('desconhecido');
    expect(estadoConexao({ lwt: undefined, ultimaLeituraMs: velha, agoraMs })).toBe('desconhecido');
  });
  it('a reading from the future (clock skew) counts as recent', () => {
    expect(estadoConexao({ lwt: 'online', ultimaLeituraMs: agoraMs + 3000, agoraMs })).toBe('online');
  });
  it('modo campo explicit behaves like the default', () => {
    expect(estadoConexao({ modo: 'campo', lwt: 'offline', agoraMs })).toBe('offline');
  });
});

describe('estadoConexao — sem hardware e sem broker', () => {
  it('without hardware nothing else matters', () => {
    expect(estadoConexao({ temHardware: false, lwt: 'online', ultimaLeituraMs: recente, agoraMs })).toBe('sem-hardware');
    expect(estadoConexao({ temHardware: false, brokerConectado: false, modo: 'bancada', agoraMs })).toBe('sem-hardware');
  });
  it('panel disconnected from the broker: sem-broker, never online/offline', () => {
    for (const lwt of ['online', 'offline', undefined]) {
      expect(estadoConexao({ lwt, ultimaLeituraMs: recente, agoraMs, brokerConectado: false })).toBe('sem-broker');
    }
  });
  it('brokerConectado omitted counts as connected', () => {
    expect(estadoConexao({ lwt: 'offline', agoraMs })).toBe('offline');
  });
  it('brokerConectado === true is the normal path', () => {
    expect(estadoConexao({ lwt: 'online', ultimaLeituraMs: recente, agoraMs, brokerConectado: true })).toBe('online');
  });
});

describe('estadoConexao — bancada', () => {
  const b = { modo: 'bancada', agoraMs };
  it('online when LWT online and reading recent', () => {
    expect(estadoConexao({ ...b, lwt: 'online', ultimaLeituraMs: recente })).toBe('online');
  });
  it('recent reading without LWT is online too (same rule as campo)', () => {
    expect(estadoConexao({ ...b, ultimaLeituraMs: recente })).toBe('online');
  });
  it('offline is normal: LWT offline, or no LWT and no recent reading, is bancada-offline', () => {
    expect(estadoConexao({ ...b, lwt: 'offline', ultimaLeituraMs: recente })).toBe('bancada-offline');
    expect(estadoConexao({ ...b, lwt: 'offline' })).toBe('bancada-offline');
    expect(estadoConexao({ ...b, lwt: undefined, ultimaLeituraMs: velha })).toBe('bancada-offline');
    expect(estadoConexao({ ...b })).toBe('bancada-offline');
  });
  it('LWT says online but the board is quiet: bancada-sem-leitura, never "offline é normal"', () => {
    expect(estadoConexao({ ...b, lwt: 'online', ultimaLeituraMs: velha })).toBe('bancada-sem-leitura');
    expect(estadoConexao({ ...b, lwt: 'online' })).toBe('bancada-sem-leitura');
    expect(estadoConexao({ ...b, lwt: 'online', ultimaLeituraMs: null })).toBe('bancada-sem-leitura');
  });
  it('bench x LWT x reading matrix', () => {
    const esperado = {
      'online|recente': 'online', 'online|quieta': 'bancada-sem-leitura',
      'offline|recente': 'bancada-offline', 'offline|quieta': 'bancada-offline',
      'undefined|recente': 'online', 'undefined|quieta': 'bancada-offline',
    };
    for (const lwt of ['online', 'offline', undefined]) {
      for (const [nome, ultimaLeituraMs] of [['recente', recente], ['quieta', velha]]) {
        expect(estadoConexao({ ...b, lwt, ultimaLeituraMs })).toBe(esperado[`${lwt}|${nome}`]);
      }
    }
  });
  it('panel without broker still wins over bancada', () => {
    expect(estadoConexao({ ...b, lwt: 'offline', brokerConectado: false })).toBe('sem-broker');
  });
});

describe('estadoConexao — mesma bóia, mesmo estado (matriz completa)', () => {
  it('is a pure function of its inputs and always returns a known state', () => {
    for (const modo of [undefined, 'campo', 'bancada']) {
      for (const lwt of [undefined, 'online', 'offline']) {
        for (const ultimaLeituraMs of [undefined, null, recente, velha]) {
          for (const brokerConectado of [undefined, true, false]) {
            for (const temHardware of [undefined, true, false]) {
              const a = estadoConexao({ modo, lwt, ultimaLeituraMs, agoraMs, brokerConectado, temHardware });
              const c = estadoConexao({ modo, lwt, ultimaLeituraMs, agoraMs, brokerConectado, temHardware });
              expect(a).toBe(c);
              expect(ESTADOS_CONEXAO).toContain(a);
            }
          }
        }
      }
    }
  });
  it('garbage lwt values are treated as unknown, never as online', () => {
    expect(estadoConexao({ lwt: 'ONLINE', agoraMs })).toBe('desconhecido');
    expect(estadoConexao({ lwt: '', agoraMs })).toBe('desconhecido');
  });
});

describe('leituraMsDaChegada (mensagem retida não conta)', () => {
  it('returns the arrival time of a live message', () => {
    expect(leituraMsDaChegada({ at: 123, retained: false })).toBe(123);
    expect(leituraMsDaChegada({ at: 123 })).toBe(123);
  });
  it('retained, missing or invalid arrival = null', () => {
    expect(leituraMsDaChegada({ at: 123, retained: true })).toBeNull();
    expect(leituraMsDaChegada(undefined)).toBeNull();
    expect(leituraMsDaChegada(null)).toBeNull();
    expect(leituraMsDaChegada({ at: NaN })).toBeNull();
  });
});

describe('rótulos e tons', () => {
  it('every state has a label and a tone', () => {
    for (const e of ESTADOS_CONEXAO) {
      expect(typeof ROTULO_CONEXAO[e]).toBe('string');
      expect(['ok', 'warn', 'bad', 'neutral']).toContain(TOM_CONEXAO[e]);
    }
  });
  it('keeps the wording the overview already shows', () => {
    expect(ROTULO_CONEXAO.online).toBe('online');
    expect(ROTULO_CONEXAO.offline).toBe('offline');
    expect(ROTULO_CONEXAO['sem-leitura']).toBe('online, sem leitura');
    expect(ROTULO_CONEXAO.desconhecido).toBe('sem sinal');
    expect(ROTULO_CONEXAO['sem-hardware']).toBe('sem hardware');
    expect(ROTULO_CONEXAO['sem-broker']).toBe('painel sem conexão com o broker');
    expect(ROTULO_CONEXAO['bancada-offline']).toBe('bancada, offline é normal');
    expect(ROTULO_CONEXAO['bancada-sem-leitura']).toBe('bancada, online, sem leitura');
  });
  it('tones: offline is the only bad one; bancada-offline is neutral', () => {
    expect(TOM_CONEXAO.online).toBe('ok');
    expect(TOM_CONEXAO.offline).toBe('bad');
    expect(TOM_CONEXAO['sem-leitura']).toBe('warn');
    expect(TOM_CONEXAO['bancada-offline']).toBe('neutral');
    expect(TOM_CONEXAO['bancada-sem-leitura']).toBe('neutral');
    expect(TOM_CONEXAO['sem-broker']).toBe('neutral');
  });
});
