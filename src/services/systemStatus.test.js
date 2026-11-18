import { describe, it, expect, vi } from 'vitest';
import {
  worstState, applyStaleness, withTimeout, buildSnapshot, createPollGuard, classifySupabaseHealth, jobsToStatus, buoyStatus, badgeState, mqttBrokerStatus, buildErrorSnapshot, inMqttGrace, fetchRest,
} from './systemStatus';
import { supabase } from '../lib/supabase';

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }));

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
  it('test_stale_rows_become_desconhecido: row verified 7 min ago (limit 360 s)', () => {
    const rows = [
      { componente: 'worker', estado: 'ok', detalhe: null, verificado_em: ago(7 * 60_000) },
      { componente: 'influxdb', estado: 'ok', detalhe: null, verificado_em: ago(60_000) },
    ];
    const out = applyStaleness(rows, NOW);
    expect(out[0].estado).toBe('desconhecido');
    expect(out[0].detalhe).toBe('status atrasado — worker parado ou lento?');
    expect(out[1].estado).toBe('ok');
  });
  it('a 5 min old row is still fresh (scheduler is sequential, ANA can take ~150 s)', () => {
    const rows = [{ componente: 'worker', estado: 'ok', detalhe: null, verificado_em: ago(5 * 60_000) }];
    expect(applyStaleness(rows, NOW)[0].estado).toBe('ok');
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

describe('jobsToStatus status job', () => {
  it('status job uses a 60 s interval: 4 min without success is falha', () => {
    const out = jobsToStatus([{ job: 'status', ok: true, erro: null, ultimo_sucesso: ago(4 * 60_000) }], NOW);
    expect(out[0]).toMatchObject({ componente: 'job_status', estado: 'falha' });
    const fresh = jobsToStatus([{ job: 'status', ok: true, erro: null, ultimo_sucesso: ago(90_000) }], NOW);
    expect(fresh[0].estado).toBe('ok');
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

describe('applyStaleness nao_monitorado', () => {
  it('does not stale nao_monitorado rows', () => {
    const r = { componente: 'x', estado: 'nao_monitorado', verificado_em: null };
    expect(applyStaleness([r], NOW)[0].estado).toBe('nao_monitorado');
  });
});

describe('REST timeout', () => {
  it('withTimeout rejects a never-resolving call, and the snapshot is REST falha', async () => {
    vi.useFakeTimers();
    try {
      const p = withTimeout(new Promise(() => {}), 5000).catch((error) => ({ error }));
      await vi.advanceTimersByTimeAsync(5001);
      const rest = await p;
      expect(rest.error.message).toBe('timeout');
      const snap = buildSnapshot({ auth: { ok: true, status: 200, elapsedMs: 50 }, rest, now: NOW });
      expect(snap.supabase.rest.estado).toBe('falha');
      expect(snap.supabase.estado).toBe('falha');
      expect(badgeState({ supabase: snap.supabase, rows: snap.rows, jobs: snap.jobs })).toBe('falha');
    } finally { vi.useRealTimers(); }
  });
});

describe('createPollGuard', () => {
  it('skips while in flight and only the latest poll wins', () => {
    const g = createPollGuard();
    const a = g.start();
    expect(g.start()).toBeNull();
    expect(g.isLatest(a)).toBe(true);
    g.finish(a);
    const b = g.start();
    expect(g.isLatest(a)).toBe(false);
    expect(g.isLatest(b)).toBe(true);
  });
});

describe('empty worker tables', () => {
  it('zero rows and zero jobs gives desconhecido entries for every expected component', () => {
    const snap = buildSnapshot({
      auth: { ok: true, status: 200, elapsedMs: 50 }, rest: { rows: [], jobs: [] }, now: NOW,
    });
    expect(snap.rows.map((r) => r.componente)).toEqual(['influxdb', 'telegraf_ingestao', 'worker']);
    for (const r of snap.rows) {
      expect(r.estado).toBe('desconhecido');
      expect(r.detalhe).toBe('sem dados do worker');
    }
    expect(badgeState({ supabase: snap.supabase, rows: snap.rows, jobs: snap.jobs })).toBe('degradado');
  });
  it('an expected component missing from system_status is desconhecido', () => {
    const rows = [
      { componente: 'influxdb', estado: 'ok', detalhe: null, verificado_em: NOW.toISOString() },
      { componente: 'worker', estado: 'ok', detalhe: null, verificado_em: NOW.toISOString() },
    ];
    const snap = buildSnapshot({ auth: { ok: true, status: 200, elapsedMs: 50 }, rest: { rows, jobs: [] }, now: NOW });
    const ing = snap.rows.find((r) => r.componente === 'telegraf_ingestao');
    expect(ing).toMatchObject({ estado: 'desconhecido', detalhe: 'sem dados do worker' });
    expect(snap.rows.find((r) => r.componente === 'influxdb').estado).toBe('ok');
  });
});

describe('fetchRest with a missing system_status table', () => {
  const mockTables = (statusErr, jobsRes) => {
    supabase.from.mockImplementation((t) => ({
      select: () => ({
        abortSignal: () => Promise.resolve(t === 'system_status'
          ? (statusErr ? { data: null, error: statusErr } : { data: [], error: null })
          : jobsRes),
      }),
    }));
  };
  const okAuth = { ok: true, status: 200, elapsedMs: 50 };

  it('PGRST205 is desconhecido "migration pendente", REST stays ok', async () => {
    mockTables({ code: 'PGRST205', message: "Could not find the table 'public.system_status' in the schema cache" },
      { data: [], error: null });
    const rest = await fetchRest();
    expect(rest.rowsMissing).toBe(true);
    const snap = buildSnapshot({ auth: okAuth, rest, now: NOW });
    expect(snap.supabase.rest.estado).toBe('ok');
    expect(snap.rows[0]).toMatchObject({
      estado: 'desconhecido', detalhe: 'tabela system_status ausente — migration pendente?' });
  });
  it('Postgres 42P01 is treated the same', async () => {
    mockTables({ code: '42P01', message: 'relation "system_status" does not exist' }, { data: [], error: null });
    expect((await fetchRest()).rowsMissing).toBe(true);
  });
  it('other system_status errors are REST falha', async () => {
    mockTables({ code: '500', message: 'boom' }, { data: [], error: null });
    const snap = buildSnapshot({ auth: okAuth, rest: await fetchRest(), now: NOW });
    expect(snap.supabase.rest.estado).toBe('falha');
  });
  it('worker_jobs failing is REST falha', async () => {
    mockTables(null, { data: null, error: { message: 'down' } });
    const snap = buildSnapshot({ auth: okAuth, rest: await fetchRest(), now: NOW });
    expect(snap.supabase.rest).toMatchObject({ estado: 'falha', detalhe: 'down' });
  });
});

describe('mqttBrokerStatus', () => {
  const now = NOW.getTime();
  it('connected is ok', () => {
    expect(mqttBrokerStatus(true, null, now).estado).toBe('ok');
  });
  it('disconnected up to 10 s (initial connecting) is desconhecido, not degradado', () => {
    expect(mqttBrokerStatus(false, now - 5_000, now).estado).toBe('desconhecido');
    expect(mqttBrokerStatus(false, now - 10_000, now).estado).toBe('desconhecido');
  });
  it('disconnected 10-30 s is degradado', () => {
    expect(mqttBrokerStatus(false, now - 11_000, now).estado).toBe('degradado');
    expect(mqttBrokerStatus(false, now - 30_000, now).estado).toBe('degradado');
  });
  it('disconnected over 30 s is falha', () => {
    expect(mqttBrokerStatus(false, now - 31_000, now).estado).toBe('falha');
  });
  it('disconnected with unknown start (never connected) does not crash', () => {
    expect(mqttBrokerStatus(false, null, now).estado).toBe('desconhecido');
  });
});

describe('buildErrorSnapshot', () => {
  it('has auth and rest entries so the page never dereferences undefined', () => {
    const snap = buildErrorSnapshot(new Error('boom'), 1);
    expect(snap.supabase.estado).toBe('falha');
    expect(snap.supabase.auth.detalhe).toBe('boom');
    expect(snap.supabase.rest.estado).toBe('falha');
    expect(snap.rows).toBeNull();
  });
});

describe('jobsToStatus verificado_em', () => {
  it('carries ultima_execucao', () => {
    const out = jobsToStatus([{ job: 'ana', ok: true, ultimo_sucesso: ago(1000), ultima_execucao: ago(500) }], NOW);
    expect(out[0].verificado_em).toBe(ago(500));
  });
});

describe('inMqttGrace', () => {
  const now = NOW.getTime();
  it('true while disconnected or never connected', () => {
    expect(inMqttGrace(false, null, now)).toBe(true);
    expect(inMqttGrace(true, null, now)).toBe(true);
  });
  it('true for first 15 s after connect, false after', () => {
    expect(inMqttGrace(true, now - 14_000, now)).toBe(true);
    expect(inMqttGrace(true, now - 15_000, now)).toBe(false);
  });
});
