import { describe, it, expect } from 'vitest';
import { formatIdade, formatUptime, formatData, formatDataHora, formatRssi } from './format';

describe('formatIdade', () => {
  it('seconds, minutes, hours, days', () => {
    expect(formatIdade(4000)).toBe('há 4 s');
    expect(formatIdade(4900)).toBe('há 4 s'); // floor, never rounds up
    expect(formatIdade(3 * 60_000 + 5_000)).toBe('há 3 min');
    expect(formatIdade(2 * 3_600_000)).toBe('há 2 h');
    expect(formatIdade(47 * 3_600_000)).toBe('há 47 h');
    expect(formatIdade(72 * 3_600_000)).toBe('há 3 d');
  });
  it('negative = agora (clock skew)', () => {
    expect(formatIdade(-1)).toBe('agora');
    expect(formatIdade(-5000)).toBe('agora');
  });
  it('missing or invalid = null (caller picks the text)', () => {
    expect(formatIdade(null)).toBeNull();
    expect(formatIdade(undefined)).toBeNull();
    expect(formatIdade(NaN)).toBeNull();
    expect(formatIdade(Infinity)).toBeNull();
  });
});

describe('formatUptime (seconds)', () => {
  it('days+hours, hours+minutes, minutes, under a minute', () => {
    expect(formatUptime(3 * 86400 + 4 * 3600 + 120)).toBe('3 d 4 h');
    expect(formatUptime(2 * 3600 + 5 * 60)).toBe('2 h 5 min');
    expect(formatUptime(300)).toBe('5 min');
    expect(formatUptime(20)).toBe('menos de 1 min');
  });
  it('3 days is never "4320 min"', () => expect(formatUptime(3 * 86400)).toBe('3 d 0 h'));
  it('missing, negative or non-numeric = null', () => {
    for (const v of [undefined, null, -1, 'abc', NaN]) expect(formatUptime(v)).toBeNull();
  });
});

describe('formatData / formatDataHora (America/Maceio, UTC-3)', () => {
  it('formats an ISO instant in Maceió time, not the browser zone', () => {
    // 02:30Z = 23:30 of the previous day in Maceió
    expect(formatDataHora('2026-11-23T02:30:00Z')).toBe('22/11/2026 23:30');
    expect(formatData('2026-11-23T02:30:00Z')).toBe('22/11/2026');
    expect(formatDataHora('2026-11-23T15:05:00Z')).toBe('23/11/2026 12:05');
  });
  it('accepts Date and epoch ms', () => {
    expect(formatDataHora(new Date('2026-11-23T15:05:00Z'))).toBe('23/11/2026 12:05');
    expect(formatDataHora(Date.parse('2026-11-23T15:05:00Z'))).toBe('23/11/2026 12:05');
  });
  it('a date-only string (YYYY-MM-DD) is a calendar day, not shifted by zone', () => {
    expect(formatData('2026-11-23')).toBe('23/11/2026');
    expect(formatDataHora('2026-11-23')).toBe('23/11/2026');
  });
  it('missing or invalid = em dash', () => {
    for (const v of [null, undefined, '', 'lixo', NaN]) {
      expect(formatData(v)).toBe('—');
      expect(formatDataHora(v)).toBe('—');
    }
  });
});

describe('formatRssi', () => {
  it('appends dBm and quality', () => {
    expect(formatRssi(-65)).toBe('-65 dBm (bom)');
    expect(formatRssi(-55.4)).toBe('-55 dBm (ótimo)');
    expect(formatRssi(-85)).toBe('-85 dBm (muito fraco)');
  });
  it('missing = null', () => {
    expect(formatRssi(undefined)).toBeNull();
    expect(formatRssi(null)).toBeNull();
    expect(formatRssi('x')).toBeNull();
  });
});
