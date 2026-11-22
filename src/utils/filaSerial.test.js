import { describe, it, expect, vi, afterEach } from 'vitest';
import { criarFilaSerial } from './filaSerial';

const adiado = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('criarFilaSerial', () => {
  it('roda uma tarefa por vez, na ordem de chegada', async () => {
    const fila = criarFilaSerial();
    const log = [];
    const a = adiado();
    const p1 = fila(async () => { log.push('a:início'); await a.promise; log.push('a:fim'); return 1; });
    const p2 = fila(async () => { log.push('b'); return 2; });
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual(['a:início']);
    a.resolve();
    expect(await p1).toBe(1);
    expect(await p2).toBe(2);
    expect(log).toEqual(['a:início', 'a:fim', 'b']);
  });

  it('falha de uma tarefa chega a quem chamou e não trava as seguintes', async () => {
    const fila = criarFilaSerial();
    const p1 = fila(async () => { throw new Error('x'); });
    const p2 = fila(async () => 'ok');
    await expect(p1).rejects.toThrow('x');
    expect(await p2).toBe('ok');
  });
});

describe('criarFilaSerial: timeout', () => {
  afterEach(() => vi.useRealTimers());

  it('tarefa que passa do limite é abortada, rejeita com TimeoutError e libera a fila', async () => {
    vi.useFakeTimers();
    const fila = criarFilaSerial({ timeoutMs: 35000 });
    let sinal;
    const travada = fila((signal) => { sinal = signal; return new Promise(() => {}); });
    const seguinte = fila(async () => 'ok');
    const rejeitou = expect(travada).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(34999);
    expect(sinal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejeitou;
    expect(sinal.aborted).toBe(true);
    expect(await seguinte).toBe('ok');
  });

  it('o padrão é 35 s', async () => {
    vi.useFakeTimers();
    const fila = criarFilaSerial();
    const p = fila(() => new Promise(() => {}));
    const rejeitou = expect(p).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(35000);
    await rejeitou;
  });

  it('tarefa que termina a tempo não é abortada nem deixa timer pendente', async () => {
    vi.useFakeTimers();
    const fila = criarFilaSerial({ timeoutMs: 1000 });
    let sinal;
    expect(await fila(async (signal) => { sinal = signal; return 7; })).toBe(7);
    expect(vi.getTimerCount()).toBe(0);
    expect(sinal.aborted).toBe(false);
  });

  it('o abort do chamador chega à tarefa; já abortado antes de começar, nem roda', async () => {
    const fila = criarFilaSerial();
    const dono = new AbortController();
    let sinal;
    const gate = adiado();
    const p1 = fila(async (signal) => { sinal = signal; await gate.promise; return 1; }, { signal: dono.signal });
    await new Promise((r) => setTimeout(r, 0));
    dono.abort();
    expect(sinal.aborted).toBe(true);
    gate.resolve();
    await p1;

    const ja = new AbortController();
    ja.abort();
    let rodou = false;
    await expect(fila(async () => { rodou = true; }, { signal: ja.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(rodou).toBe(false);
    expect(await fila(async () => 'depois')).toBe('depois');
  });
});
