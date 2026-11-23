import { describe, it, expect } from 'vitest';
import { paginar } from './paginar.js';

const lista = (n) => Array.from({ length: n }, (_, i) => i + 1);

describe('paginar', () => {
  it('0 itens -> 1 pagina vazia', () => {
    expect(paginar([], 1)).toEqual({ itens: [], pagina: 1, totalPaginas: 1 });
  });
  it('25 itens -> 1 pagina', () => {
    const r = paginar(lista(25), 1);
    expect(r.totalPaginas).toBe(1);
    expect(r.itens).toHaveLength(25);
  });
  it('26 itens -> 2 paginas, pagina 2 com 1 item', () => {
    const r = paginar(lista(26), 2);
    expect(r.totalPaginas).toBe(2);
    expect(r.itens).toEqual([26]);
  });
  it('200 itens -> 8 paginas', () => {
    expect(paginar(lista(200), 1).totalPaginas).toBe(8);
  });
  it('pagina 9 de 200 -> pagina 8', () => {
    const r = paginar(lista(200), 9);
    expect(r.pagina).toBe(8);
    expect(r.itens[0]).toBe(176);
  });
  it('pagina 0 ou NaN -> 1', () => {
    expect(paginar(lista(60), 0).pagina).toBe(1);
    expect(paginar(lista(60), NaN).pagina).toBe(1);
  });
});
