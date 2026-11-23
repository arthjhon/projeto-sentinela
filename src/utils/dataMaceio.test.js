import { describe, it, expect } from 'vitest';
import { hojeMaceio } from './dataMaceio';

describe('hojeMaceio', () => {
  it('uses the calendar day in Maceió (UTC-3), not the browser zone', () => {
    expect(hojeMaceio(new Date('2026-11-20T01:30:00Z'))).toBe('2026-11-19');
    expect(hojeMaceio(new Date('2026-11-20T03:00:00Z'))).toBe('2026-11-20');
    expect(hojeMaceio(new Date('2026-11-20T23:59:00Z'))).toBe('2026-11-20');
  });
});
