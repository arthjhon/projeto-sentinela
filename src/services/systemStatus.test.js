import { describe, it, expect } from 'vitest';
import {
  worstState, applyStaleness, classifySupabaseHealth, jobsToStatus, buoyStatus, badgeState,
} from './systemStatus';

const NOW = new Date('2026-11-18T12:00:00Z');
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();

describe('worstState', () => {
  it('ranks falha > degradado > desconhecido > ok and ignores nao_monitorado', () => {
    expect(worstState(['ok', 'desconhecido'])).toBe('desconhecido');
    expect(worstState(['ok', 'desconhecido', 'degradado'])).toBe('degradado');
    expect(worstState(['degradado', 'falha', 'ok'])).toBe('falha');
    expect(worstState(['ok', 'nao_monitorado'])).toBe('ok');
    expect(worstState(['nao_monitorado'])).toBe('desconhecido');
    expect(worstState([])).toBe('desconhecido');
  });
});

describe('applyStaleness', () => {
  it('test_stale_rows_become_desconhecido: row verified 4 min ago', () => {
    const rows = [
      { componente: 'worker', estado: 'ok', detalhe: null, verificado_em: ago(4 * 60_000) },
      { componente: 'influxdb', estado: 'ok', detalhe: null, verificado_em: ago(60_000) },
    ];
    const out = applyStaleness(rows, NOW);
    expect(out[0].estado).toBe('desconhecido');
    expect(out[0].detalhe).toBe('status desatualizado — worker parado?');
    expect(out[1].estado).toBe('ok');
  });
  it('treats a missing/invalid timestamp as stale', () => {
    expect(applyStaleness([{ componente: 'x', estado: 'ok', verificado_em: null }], NOW)[0].estado)
      .toBe('desconhecido');
  });
});

describe('classifySupabaseHealth', () => {
  it('200 fast is ok, 200 slow (>2000 ms) is degradado, error/timeout is falha', () => {
    expect(classifySupabaseHealth({ ok: true, status: 200, elapsedMs: 120 }).estado).toBe('ok');
    expect(classifySupabaseHealth({ ok: true, status: 200, elapsedMs: 2500 }).estado).toBe('degradado');
    expect(classifySupabaseHealth({ ok: false, status: 0, elapsedMs: 5000, error: 'timeout' }).estado).toBe('falha');
    expect(classifySupabaseHealth({ ok: false, status: 503, elapsedMs: 50 }).estado).toBe('falha');
  });
});

describe('jobsToStatus', () => {
  it('late detector is falha; ANA ok with partial erro is ok with "Parcial" detail', () => {
    const out = jobsToStatus([
      { job: 'detector', ok: true, erro: null, ultimo_sucesso: ago(3600_000) },
      { job: 'ana', ok: true, erro: 'estação X fora', ultimo_sucesso: ago(60_000) },
    ], NOW);
    const det = out.find((j) => j.componente.includes('detector'));
    const ana = out.find((j) => j.componente.includes('ana'));
    expect(det.estado).toBe('falha');
    expect(ana.estado).toBe('ok');
    expect(ana.detalhe).toMatch(/Parcial/);
  });
  it('ok=false is falha', () => {
    const out = jobsToStatus([{ job: 'ana', ok: false, erro: 'boom', ultimo_sucesso: ago(1000) }], NOW);
    expect(out[0].estado).toBe('falha');
  });
});

describe('buoyStatus', () => {
  it('bancada offline is desconhecido, never falha', () => {
    for (const args of [
      { availability: 'offline', lastMessageAt: ago(1000) },
      { availability: 'online', lastMessageAt: ago(3600_000) },
      { availability: undefined, lastMessageAt: null },
    ]) {
      const r = buoyStatus({ modo: 'bancada', deviceId: 'esp_a', now: NOW, ...args });
      expect(r.estado).toBe('desconhecido');
      expect(r.detalhe).toMatch(/bancada/);
    }
  });
  it('campo: offline falha; 3 min degradado; 30 s ok; no deviceId desconhecido "sem hardware"', () => {
    const base = { modo: 'campo', deviceId: 'esp_a', now: NOW };
    expect(buoyStatus({ ...base, availability: 'offline', lastMessageAt: ago(1000) }).estado).toBe('falha');
    expect(buoyStatus({ ...base, availability: 'online', lastMessageAt: ago(6 * 60_000) }).estado).toBe('falha');
    expect(buoyStatus({ ...base, availability: 'online', lastMessageAt: null }).estado).toBe('falha');
    expect(buoyStatus({ ...base, availability: 'online', lastMessageAt: ago(3 * 60_000) }).estado).toBe('degradado');
    expect(buoyStatus({ ...base, availability: 'online', lastMessageAt: ago(30_000) }).estado).toBe('ok');
    const nohw = buoyStatus({ modo: 'campo', deviceId: null, now: NOW });
    expect(nohw.estado).toBe('desconhecido');
    expect(nohw.detalhe).toBe('sem hardware');
  });
});

describe('badgeState', () => {
  const ok = { estado: 'ok' };
  it('before first poll is verificando', () => {
    expect(badgeState({ supabase: null, rows: null, jobs: null })).toBe('verificando');
  });
  it('is the worst of supabase/rows/jobs', () => {
    expect(badgeState({ supabase: ok, rows: [ok], jobs: [ok] })).toBe('ok');
    expect(badgeState({ supabase: ok, rows: [{ estado: 'degradado' }], jobs: [ok] })).toBe('degradado');
    expect(badgeState({ supabase: ok, rows: [ok], jobs: [{ estado: 'falha' }] })).toBe('falha');
    expect(badgeState({ supabase: { estado: 'falha' }, rows: null, jobs: null })).toBe('falha');
  });
  it('stale (desconhecido) rows never show green', () => {
    expect(badgeState({ supabase: ok, rows: [{ estado: 'desconhecido' }], jobs: [ok] })).not.toBe('ok');
  });
  it('ignores nao_monitorado', () => {
    expect(badgeState({ supabase: ok, rows: [{ estado: 'nao_monitorado' }], jobs: [] })).toBe('ok');
  });
});
