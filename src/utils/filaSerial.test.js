import { describe, it, expect } from 'vitest';
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
