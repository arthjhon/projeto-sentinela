import { describe, it, expect } from 'vitest';
import {
  formatUptime, formatBytes, formatMemoria, escolherFirmware, formatRssi,
  blocosDetalhes, estadoFirmware, estadoManutencao, rotuloRecebido,
} from './buoyDetails';

describe('formatUptime', () => {
  it('formats days and hours', () => expect(formatUptime(3 * 86400 + 4 * 3600 + 120)).toBe('3 d 4 h'));
  it('formats hours and minutes', () => expect(formatUptime(2 * 3600 + 5 * 60)).toBe('2 h 5 min'));
  it('formats minutes and sub-minute', () => {
    expect(formatUptime(300)).toBe('5 min');
    expect(formatUptime(20)).toBe('menos de 1 min');
  });
  it('returns null for missing or invalid values', () => {
    expect(formatUptime(undefined)).toBeNull();
    expect(formatUptime(null)).toBeNull();
    expect(formatUptime(-1)).toBeNull();
    expect(formatUptime('abc')).toBeNull();
  });
});

describe('formatBytes', () => {
  it('formats KB and MB', () => {
    expect(formatBytes(126976)).toBe('124 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2,0 MB');
  });
  it('formats small values in bytes', () => expect(formatBytes(512)).toBe('512 B'));
  it('returns null for missing', () => {
    expect(formatBytes(null)).toBeNull();
    expect(formatBytes(undefined)).toBeNull();
  });
  it('keeps zero as a real value', () => expect(formatBytes(0)).toBe('0 B'));
});

describe('formatMemoria', () => {
  it('shows free and total', () => expect(formatMemoria(102400, 307200)).toBe('100 KB livres de 300 KB'));
  it('shows only free when total is missing', () => expect(formatMemoria(102400, null)).toBe('100 KB livres'));
  it('returns null without free heap', () => expect(formatMemoria(null, 307200)).toBeNull());
});

describe('formatRssi', () => {
  it('appends dBm and quality', () => expect(formatRssi(-65)).toBe('-65 dBm (bom)'));
  it('returns null for missing', () => expect(formatRssi(undefined)).toBeNull());
});

describe('escolherFirmware', () => {
  it('prefers the device status message', () => {
    expect(escolherFirmware({ firmware: 'v5.2' }, { versao: 'v5.1' }))
      .toEqual({ texto: 'v5.2', fonte: 'status' });
  });
  it('falls back to the last deploy, labelled as such', () => {
    expect(escolherFirmware(undefined, { versao: 'v5.1' }))
      .toEqual({ texto: 'v5.1', fonte: 'deploy' });
  });
  it('falls back to deploy when status has no firmware field', () => {
    expect(escolherFirmware({ rssi: -60 }, { versao: 'v5.1' }).fonte).toBe('deploy');
  });
  it('returns null when neither exists', () => {
    expect(escolherFirmware(undefined, null)).toBeNull();
  });
});

const ok = (value) => ({ status: 'fulfilled', value });
const falha = (msg) => ({ status: 'rejected', reason: new Error(msg) });

describe('blocosDetalhes', () => {
  const manut = [1, 2, 3, 4].map((id) => ({ id }));
  const calibs = {
    ph: { sensor_key: 'ph', calibrated_at: '2026-09-01T00:00:00Z' },
    turbidez: { sensor_key: 'turbidez', calibrated_at: '2026-09-25T00:00:00Z' },
    temperatura: { sensor_key: 'temperatura', calibrated_at: '2026-08-01T00:00:00Z' },
    extra: { sensor_key: 'extra', calibrated_at: '2026-07-01T00:00:00Z' },
  };
  it('tudo lido: 3 manutenções, calibrações da mais recente, manutenção aberta e deploy', () => {
    const b = blocosDetalhes([ok(manut), ok(null), ok(calibs), ok({ versao: '5.1.0' })]);
    expect(b.manutencoes).toEqual({ ok: true, valor: manut.slice(0, 3) });
    expect(b.aberta).toEqual({ ok: true, valor: null });
    expect(b.calibracoes.ok).toBe(true);
    expect(b.calibracoes.valor.map((c) => c.sensor_key)).toEqual(['turbidez', 'ph', 'temperatura']);
    expect(b.deploy).toEqual({ ok: true, valor: { versao: '5.1.0' } });
  });
  it('uma leitura falha: só aquele bloco fica em erro, com a mensagem', () => {
    const b = blocosDetalhes([ok([]), ok(null), falha('permission denied'), ok(null)]);
    expect(b.calibracoes).toEqual({ ok: false, erro: 'permission denied' });
    expect(b.manutencoes).toEqual({ ok: true, valor: [] });
    expect(b.deploy).toEqual({ ok: true, valor: null });
  });
  it('rejeição sem Error vira texto', () => {
    expect(blocosDetalhes([falha('x'), falha('y'), ok({}), { status: 'rejected', reason: 'boom' }]).deploy)
      .toEqual({ ok: false, erro: 'boom' });
  });
});

describe('estadoFirmware', () => {
  it('status da sessão vence, mesmo com a leitura do deploy falhando ou carregando', () => {
    expect(estadoFirmware({ firmware: '5.2.0' }, { ok: false, erro: 'x' })).toEqual({ tipo: 'valor', texto: '5.2.0', fonte: 'status' });
    expect(estadoFirmware({ firmware: '5.2.0' }, undefined)).toEqual({ tipo: 'valor', texto: '5.2.0', fonte: 'status' });
  });
  it('sem status: carregando, falha do deploy, deploy ou ausente', () => {
    expect(estadoFirmware(undefined, undefined)).toEqual({ tipo: 'carregando' });
    expect(estadoFirmware(undefined, { ok: false, erro: 'x' })).toEqual({ tipo: 'falha' });
    expect(estadoFirmware(null, { ok: true, valor: { versao: '5.1.0' } })).toEqual({ tipo: 'valor', texto: '5.1.0', fonte: 'deploy' });
    expect(estadoFirmware(undefined, { ok: true, valor: null })).toEqual({ tipo: 'ausente' });
  });
});

describe('estadoManutencao', () => {
  it('carregando, falha, sem manutenção aberta e aberta', () => {
    expect(estadoManutencao(undefined)).toEqual({ tipo: 'carregando' });
    expect(estadoManutencao({ ok: false, erro: 'x' })).toEqual({ tipo: 'falha' });
    expect(estadoManutencao({ ok: true, valor: null })).toEqual({ tipo: 'nao' });
    const reg = { motivo: 'limpeza', timestamp_inicio: '2026-11-20T10:00:00Z' };
    expect(estadoManutencao({ ok: true, valor: reg })).toEqual({ tipo: 'aberta', registro: reg });
  });
});

describe('rotuloRecebido (idade do valor de status)', () => {
  const agoraMs = 10_000_000;
  it('recebido há X a partir de _recebidoEm', () => {
    expect(rotuloRecebido(agoraMs - 4000, agoraMs)).toBe('recebido há 4 s');
    expect(rotuloRecebido(agoraMs - 3 * 3600e3, agoraMs)).toBe('recebido há 3 h');
  });
  it('sem hora de chegada = null (não inventa idade)', () => {
    expect(rotuloRecebido(undefined, agoraMs)).toBeNull();
    expect(rotuloRecebido(null, agoraMs)).toBeNull();
    expect(rotuloRecebido(NaN, agoraMs)).toBeNull();
  });
});
