import { describe, it, expect } from 'vitest';
import { checkDelete, isUuid } from './rules';

const CALLER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('isUuid', () => {
  it('accepts uuids and rejects everything else', () => {
    expect(isUuid(OTHER)).toBe(true);
    expect(isUuid('nope')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});

describe('checkDelete', () => {
  it('refuses self-deletion', () => {
    const r = checkDelete({ callerId: CALLER, targetId: CALLER, targetRole: 'admin', adminCount: 3 });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it('refuses deleting the last admin', () => {
    const r = checkDelete({ callerId: CALLER, targetId: OTHER, targetRole: 'admin', adminCount: 1 });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });

  it('allows deleting an admin when another admin remains', () => {
    expect(checkDelete({ callerId: CALLER, targetId: OTHER, targetRole: 'admin', adminCount: 2 })).toEqual({ ok: true });
  });

  it('allows deleting non-admin operators regardless of admin count', () => {
    for (const targetRole of ['operador', 'visualizador']) {
      expect(checkDelete({ callerId: CALLER, targetId: OTHER, targetRole, adminCount: 1 })).toEqual({ ok: true });
    }
  });

  it('allows cleaning up an auth user that has no profile (orphan)', () => {
    expect(checkDelete({ callerId: CALLER, targetId: OTHER, targetRole: null, adminCount: 1 })).toEqual({ ok: true });
  });
});
