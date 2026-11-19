import { describe, it, expect } from 'vitest';
import { buildOtaCommand, findDeviceId, OtaCommandError } from './command';

const BASE = 'https://supabase.arthlabs.dev';
const SHA = 'a'.repeat(64);
const ok = {
  status: 'pendente',
  versao: '5.1.0',
  sha256: SHA,
  arquivo_path: 'sentinela-5.1.0.bin',
  device_id: 'esp_sururu',
};

function codeOf(deploy: Parameters<typeof buildOtaCommand>[0]): string | null {
  try {
    buildOtaCommand(deploy, BASE);
    return null;
  } catch (e) {
    return e instanceof OtaCommandError ? e.code : 'other';
  }
}

describe('buildOtaCommand', () => {
  it('builds topic and payload for a pending deploy', () => {
    const { topic, payload } = buildOtaCommand(ok, BASE);
    expect(topic).toBe('esp_sururu/ota/command');
    const p = JSON.parse(payload);
    expect(p.url).toBe(`${BASE}/storage/v1/object/public/firmware/sentinela-5.1.0.bin`);
    expect(p.url.startsWith('https://supabase.arthlabs.dev/storage/v1/object/public/firmware/')).toBe(true);
    expect(p.version).toBe('5.1.0');
    expect(p.sha256).toBe(SHA);
    expect(Object.keys(p).sort()).toEqual(['sha256', 'url', 'version']);
  });

  it('refuses non-pending deploys', () => {
    for (const status of ['sucesso', 'falha', 'revertido']) {
      expect(codeOf({ ...ok, status })).toBe('not_pending');
    }
  });

  it('refuses a buoy without device id', () => {
    expect(codeOf({ ...ok, device_id: null })).toBe('no_device');
    expect(codeOf({ ...ok, device_id: '' })).toBe('no_device');
  });

  it('refuses a malformed device id', () => {
    for (const device_id of ['a/b', 'a#', 'a+', 'x'.repeat(41), 'a b']) {
      expect(codeOf({ ...ok, device_id })).toBe('bad_device');
    }
  });

  it('refuses paths that are not a plain .bin name', () => {
    for (const arquivo_path of ['../x.bin', 'a/b.bin', 'x.bin?y', 'x.exe', '', null, '.bin ']) {
      expect(codeOf({ ...ok, arquivo_path })).toBe('bad_path');
    }
  });

  it('refuses a bad sha256', () => {
    for (const sha256 of ['a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), '', 'A'.repeat(63) + '!']) {
      expect(codeOf({ ...ok, sha256 })).toBe('bad_sha');
    }
  });

  it('refuses a missing version', () => {
    expect(codeOf({ ...ok, versao: '' })).toBe('no_version');
    expect(codeOf({ ...ok, versao: '   ' })).toBe('no_version');
  });

  it('checks status before everything else', () => {
    expect(codeOf({ ...ok, status: 'sucesso', device_id: null })).toBe('not_pending');
  });
});

describe('findDeviceId', () => {
  it('finds the device id by codigo', () => {
    const reg = [{ codigo: 'SM-01', deviceId: 'esp_sururu' }, { codigo: 'SM-02', deviceId: null }];
    expect(findDeviceId(reg, 'SM-01')).toBe('esp_sururu');
    expect(findDeviceId(reg, 'SM-02')).toBeNull();
    expect(findDeviceId(reg, 'XX')).toBeNull();
  });

  it('tolerates a malformed registry', () => {
    expect(findDeviceId(null, 'SM-01')).toBeNull();
    expect(findDeviceId({}, 'SM-01')).toBeNull();
    expect(findDeviceId([null, 3, 'x', { codigo: 'SM-01', deviceId: 7 }], 'SM-01')).toBeNull();
    expect(findDeviceId([null, { codigo: 'SM-01', deviceId: 'esp_a' }], 'SM-01')).toBe('esp_a');
  });
});
