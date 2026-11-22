import { describe, it, expect } from 'vitest';
import { formatUptime, formatBytes, formatMemoria, escolherFirmware, formatRssi } from './buoyDetails';

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
