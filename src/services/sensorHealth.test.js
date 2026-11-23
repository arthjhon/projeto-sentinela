import { describe, it, expect, vi, beforeEach } from 'vitest';

const chain = vi.hoisted(() => {
  const calls = [];
  const res = { data: null, error: null };
  const q = new Proxy({}, {
    get: (_, name) => {
      if (name === 'then') return (ok) => ok({ data: res.data, error: res.error });
      return (...args) => { calls.push([name, ...args]); return q; };
    },
  });
  return { calls, res, q };
});
vi.mock('../lib/supabase', () => ({ supabase: { from: () => chain.q } }));

import { ESTADO_META, healthForDevice, jobStaleness, jobTitle, eventTone, estadoMeta, fmtDate, fetchHealthEventsDosSeriais } from './sensorHealth';

beforeEach(() => { chain.calls.length = 0; chain.res.data = null; chain.res.error = null; });

const row = (sensor, estado, device_id = 'esp_a') => ({
  device_id, sensor, estado, motivo: null, desde: '2026-11-17T10:00:00Z',
});

describe('healthForDevice', () => {
  it('picks the worst state: bad > warn > info > neutral > ok', () => {
    const rows = [row('ph', 'ok'), row('temp', 'suspeito'), row('turb', 'falha'), row('x', 'ok', 'outro')];
    const h = healthForDevice(rows, 'esp_a');
    expect(h.pior).toBe('falha');
    expect(h.sensores).toHaveLength(3);
    expect(healthForDevice([row('a', 'ok'), row('b', 'manutencao')], 'esp_a').pior).toBe('manutencao');
    expect(healthForDevice([row('a', 'ok'), row('b', 'suspeito')], 'esp_a').pior).toBe('suspeito');
    expect(healthForDevice([row('a', 'ok'), row('b', 'dados_insuficientes')], 'esp_a').pior).toBe('dados_insuficientes');
  });

  it('returns ok/empty for an unknown device', () => {
    expect(healthForDevice([], 'nada')).toEqual({ sensores: [], pior: 'ok' });
  });

  it('never escalates a bench buoy, even with stale bad rows', () => {
    const h = healthForDevice([row('ph', 'falha'), row('temp', 'suspeito')], 'esp_a', 'bancada');
    expect(h.pior).toBe('bancada');
    for (const s of h.sensores) expect(ESTADO_META[s.estado].tone).toBe('neutral');
  });
});

describe('jobStaleness', () => {
  const now = new Date('2026-11-17T12:00:00Z');
  const ago = (s) => new Date(now.getTime() - s * 1000).toISOString();

  it('flags late exactly beyond 3x the interval', () => {
    const r = jobStaleness([
      { job: 'detector', ultimo_sucesso: ago(900) },
      { job: 'ana', ultimo_sucesso: ago(2700) },
      { job: 'openmeteo', ultimo_sucesso: ago(10801) },
    ], now);
    expect(r.map((j) => j.atrasado)).toEqual([false, false, true]);
  });

  it('is late when ultimo_sucesso is missing', () => {
    expect(jobStaleness([{ job: 'ana', ultimo_sucesso: null }], now)[0].atrasado).toBe(true);
  });

  it('carries the erro for failed jobs', () => {
    const r = jobStaleness([{ job: 'ana', ok: false, erro: 'boom', ultimo_sucesso: ago(10) }], now);
    expect(r[0].erro).toBe('boom');
  });
});

describe('jobTitle', () => {
  it('shows the error of a failed job, lateness, or the partial-failure note of an ok job', () => {
    expect(jobTitle({ ok: false, erro: 'boom', atrasado: false })).toBe('boom');
    expect(jobTitle({ ok: true, erro: null, atrasado: true })).toBe('Sem execução bem-sucedida recente');
    expect(jobTitle({ ok: true, erro: 'estacoes secundarias com falha: 39760000', atrasado: false }))
      .toBe('Parcial: estacoes secundarias com falha: 39760000');
    expect(jobTitle({ ok: true, erro: null, atrasado: false })).toBeUndefined();
    expect(jobTitle({ ok: false, erro: 'x'.repeat(300), atrasado: false })).toHaveLength(200);
  });
});

describe('eventTone / estadoMeta / fmtDate / bancada motivo', () => {
  it('bancada is neutral for every estado; campo keeps the tone', () => {
    for (const e of Object.keys(ESTADO_META)) expect(eventTone(e, 'bancada')).toBe('neutral');
    expect(eventTone('falha', 'campo')).toBe('bad');
    expect(eventTone('qualquer', 'campo')).toBe('neutral');
  });
  it('unknown estado shows the raw value, neutral', () => {
    expect(estadoMeta('xyz')).toEqual({ label: 'xyz', tone: 'neutral' });
  });
  it('fmtDate renders a dash for missing/invalid dates', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate('lixo')).toBe('—');
    expect(fmtDate('2026-11-17T10:00:00Z')).not.toBe('—');
  });
  it('bancada clears motivo', () => {
    const h = healthForDevice([{ device_id: 'd', sensor: 'ph', estado: 'falha', motivo: 'faixa', desde: null }], 'd', 'bancada');
    expect(h.sensores[0].motivo).toBeNull();
  });
});

describe('fetchHealthEventsDosSeriais', () => {
  it('uma consulta .in com order e limit', async () => {
    chain.res.data = [{ id: 1 }];
    expect(await fetchHealthEventsDosSeriais(['a', 'b'], 100)).toEqual([{ id: 1 }]);
    expect(chain.calls).toContainEqual(['in', 'device_id', ['a', 'b']]);
    expect(chain.calls).toContainEqual(['order', 'inicio', { ascending: false }]);
    expect(chain.calls).toContainEqual(['limit', 100]);
  });
  it('lista vazia resolve [] sem consultar o supabase', async () => {
    expect(await fetchHealthEventsDosSeriais([], 100)).toEqual([]);
    expect(chain.calls).toHaveLength(0);
  });
  it('lança em erro e devolve [] com data nula', async () => {
    chain.res.error = { message: 'rls' };
    await expect(fetchHealthEventsDosSeriais(['a'], 100)).rejects.toThrow('rls');
    chain.res.error = null;
    expect(await fetchHealthEventsDosSeriais(['a'], 100)).toEqual([]);
  });
});
