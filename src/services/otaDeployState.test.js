import { describe, it, expect } from 'vitest';
import {
  initialState, otaReducer, WAIT_TIMEOUT_MS, PENDENTE_STALE_MS,
  isBinFile, createRequestToken, statusEfetivo, rotuloStatusDeploy, podeResetar,
} from './otaDeployState';

const run = (actions, s = initialState) => actions.reduce(otaReducer, s);

describe('otaReducer', () => {
  it('walks the happy path idle -> uploading -> sending -> waiting -> success', () => {
    let s = run([{ type: 'start', deviceId: 'dev1' }]);
    expect(s.phase).toBe('uploading');
    expect(s.deviceId).toBe('dev1');
    s = run([{ type: 'deploy_created', deployId: 'd1' }], s);
    expect(s.phase).toBe('sending');
    expect(s.deployId).toBe('d1');
    s = run([{ type: 'command_sent' }], s);
    expect(s.phase).toBe('waiting');
    s = run([{ type: 'device_status', status: 'success' }], s);
    expect(s.phase).toBe('success');
  });

  it('ignores device_status when no deploy is active', () => {
    expect(run([{ type: 'device_status', status: 'success' }]).phase).toBe('idle');
  });

  it('command_sent keeps an already-closed phase (fast refusal before the HTTP reply)', () => {
    const s = run([
      { type: 'start', deviceId: 'd' }, { type: 'deploy_created', deployId: 'x' },
      { type: 'device_status', status: 'error' }, { type: 'command_sent' },
    ]);
    expect(s.phase).toBe('error');
  });

  it('downloading/flashing keep waiting; unknown status is ignored', () => {
    let s = run([{ type: 'start', deviceId: 'd' }, { type: 'deploy_created', deployId: 'x' }, { type: 'command_sent' }]);
    s = otaReducer(s, { type: 'device_status', status: 'downloading' });
    expect(s.phase).toBe('waiting');
    s = otaReducer(s, { type: 'device_status', status: 'whatever' });
    expect(s.phase).toBe('waiting');
  });

  it('timeout only applies while waiting', () => {
    expect(otaReducer(initialState, { type: 'timeout' }).phase).toBe('idle');
    const w = run([{ type: 'start', deviceId: 'd' }, { type: 'deploy_created', deployId: 'x' }, { type: 'command_sent' }]);
    const t = otaReducer(w, { type: 'timeout' });
    expect(t.phase).toBe('timeout');
    expect(t.log.at(-1)).toMatch(/sem resposta/i);
    const ok = otaReducer({ ...w, phase: 'success' }, { type: 'timeout' });
    expect(ok.phase).toBe('success');
  });

  it('fail moves to error and logs the message', () => {
    const s = run([{ type: 'start', deviceId: 'd' }, { type: 'fail', message: 'boom' }]);
    expect(s.phase).toBe('error');
    expect(s.log.at(-1)).toMatch(/ERRO: boom/);
  });

  it('reset returns to the initial state from sending, waiting, timeout and error', () => {
    const base = run([{ type: 'start', deviceId: 'd' }, { type: 'deploy_created', deployId: 'x' }]);
    for (const phase of ['sending', 'waiting', 'timeout', 'error', 'success']) {
      const s = otaReducer({ ...base, phase }, { type: 'reset' });
      expect(s).toEqual(initialState);
    }
  });

  it('podeResetar: true in sending/waiting/timeout/error/success, false in idle/uploading', () => {
    expect(['idle', 'uploading', 'sending', 'waiting', 'timeout', 'error', 'success'].map(podeResetar))
      .toEqual([false, false, true, true, true, true, true]);
  });

  it('timeout constants: 120 s wait, 15 min stale', () => {
    expect(WAIT_TIMEOUT_MS).toBe(120_000);
    expect(PENDENTE_STALE_MS).toBe(15 * 60_000);
  });
});

describe('isBinFile', () => {
  it('is case-insensitive and requires the extension', () => {
    expect(isBinFile('fw.bin')).toBe(true);
    expect(isBinFile('FW.BIN')).toBe(true);
    expect(isBinFile('fw.Bin')).toBe(true);
    expect(isBinFile('fw.bin.txt')).toBe(false);
    expect(isBinFile('bin')).toBe(false);
    expect(isBinFile(undefined)).toBe(false);
  });
});

describe('createRequestToken', () => {
  it('only the latest token is current; invalidate kills all', () => {
    const t = createRequestToken();
    const a = t.next();
    const b = t.next();
    expect(t.isLatest(a)).toBe(false);
    expect(t.isLatest(b)).toBe(true);
    t.invalidate();
    expect(t.isLatest(b)).toBe(false);
  });
});

describe('statusEfetivo', () => {
  const now = Date.parse('2026-11-23T12:00:00Z');
  const row = (status, minAgo) => ({ status, data_deploy: new Date(now - minAgo * 60_000).toISOString() });
  it('pendente older than 15 min shows as sem_resposta', () => {
    expect(statusEfetivo(row('pendente', 16), now)).toBe('sem_resposta');
  });
  it('pendente within 15 min (or exactly 15) stays pendente', () => {
    expect(statusEfetivo(row('pendente', 14), now)).toBe('pendente');
    expect(statusEfetivo(row('pendente', 15), now)).toBe('pendente');
  });
  it('closed statuses are untouched, however old', () => {
    for (const s of ['sucesso', 'falha', 'revertido']) expect(statusEfetivo(row(s, 999), now)).toBe(s);
  });
  it('invalid date on pendente stays pendente (no invented verdict)', () => {
    expect(statusEfetivo({ status: 'pendente', data_deploy: 'x' }, now)).toBe('pendente');
  });
  it('labels', () => {
    expect(rotuloStatusDeploy('sem_resposta')).toEqual({ texto: 'sem resposta', tom: 'warn' });
    expect(rotuloStatusDeploy('sucesso').tom).toBe('ok');
    expect(rotuloStatusDeploy('falha').tom).toBe('bad');
    expect(rotuloStatusDeploy('xyz').texto).toBe('xyz');
  });
});
