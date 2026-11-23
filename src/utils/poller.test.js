import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPollGuard } from './pollGuard';
import { createPoller } from './poller';

describe('createPollGuard', () => {
  it('lets one round run at a time and only the latest result counts', () => {
    const g = createPollGuard();
    const t1 = g.start();
    expect(t1).toBe(1);
    expect(g.start()).toBeNull(); // overlap refused
    expect(g.isLatest(t1)).toBe(true);
    g.finish();
    const t2 = g.start();
    expect(t2).toBe(2);
    expect(g.isLatest(t1)).toBe(false);
  });
});

// Ambiente injetável: visibilidade e listener controlados pelo teste.
function fakeEnv() {
  let visible = true;
  let listener = null;
  return {
    isVisible: () => visible,
    onVisibility: (fn) => { listener = fn; return () => { listener = null; }; },
    setVisible(v) { visible = v; listener?.(); },
    hasListener: () => listener !== null,
  };
}

describe('createPoller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs immediately and then every ms', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const p = createPoller(fn, 1000, fakeEnv());
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fn).toHaveBeenCalledTimes(4);
    p.stop();
  });

  it('skips ticks while the tab is hidden and refreshes when it becomes visible', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const env = fakeEnv();
    const p = createPoller(fn, 1000, env);
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    env.setVisible(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenCalledTimes(1);
    env.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it('does not start a round while the previous one is still in flight', async () => {
    let resolve;
    const fn = vi.fn(() => new Promise((r) => { resolve = r; }));
    const p = createPoller(fn, 1000, fakeEnv());
    p.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenCalledTimes(1);
    resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it('a failing round does not kill the loop nor leave the guard stuck', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const p = createPoller(fn, 1000, fakeEnv());
    p.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(3);
    err.mockRestore();
    p.stop();
  });

  it('isCurrent() turns false after stop, so a late response is discarded', async () => {
    let ctx;
    let resolve;
    const fn = vi.fn((c) => { ctx = c; return new Promise((r) => { resolve = r; }); });
    const p = createPoller(fn, 1000, fakeEnv());
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.isCurrent()).toBe(true);
    p.stop();
    expect(ctx.isCurrent()).toBe(false);
    expect(ctx.signal.aborted).toBe(true);
    resolve();
  });

  it('stop removes the timer and the visibility listener', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const env = fakeEnv();
    const p = createPoller(fn, 1000, env);
    p.start();
    expect(env.hasListener()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    p.stop();
    expect(env.hasListener()).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runNow() forces a round (respecting the overlap guard)', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const p = createPoller(fn, 60000, fakeEnv());
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    p.runNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(2);
    p.stop();
  });
});
