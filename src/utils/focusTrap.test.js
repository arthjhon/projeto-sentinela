import { describe, it, expect } from 'vitest';
import { destinoTab } from './focusTrap';

const titulo = { id: 'titulo' };
const primeiro = { id: 'primeiro' };
const meio = { id: 'meio' };
const ultimo = { id: 'ultimo' };
const base = { titulo, primeiro, ultimo, dentro: true };

describe('destinoTab (focus trap do modal)', () => {
  it('Tab no último volta ao primeiro', () => {
    expect(destinoTab({ ...base, ativo: ultimo, shift: false })).toBe(primeiro);
  });
  it('Shift+Tab no primeiro vai ao último', () => {
    expect(destinoTab({ ...base, ativo: primeiro, shift: true })).toBe(ultimo);
  });
  it('Shift+Tab no título (tabindex -1) vai ao último, em vez de escapar do diálogo', () => {
    expect(destinoTab({ ...base, ativo: titulo, shift: true })).toBe(ultimo);
  });
  it('Tab no título segue o fluxo natural (primeiro focável)', () => {
    expect(destinoTab({ ...base, ativo: titulo, shift: false })).toBeNull();
  });
  it('no meio da lista não interfere', () => {
    expect(destinoTab({ ...base, ativo: meio, shift: false })).toBeNull();
    expect(destinoTab({ ...base, ativo: meio, shift: true })).toBeNull();
  });
  it('foco fora do diálogo é puxado para dentro', () => {
    expect(destinoTab({ ...base, ativo: { id: 'body' }, dentro: false, shift: false })).toBe(primeiro);
    expect(destinoTab({ ...base, ativo: { id: 'body' }, dentro: false, shift: true })).toBe(ultimo);
  });
  it('sem focáveis: nada a fazer', () => {
    expect(destinoTab({ titulo, primeiro: undefined, ultimo: undefined, ativo: titulo, dentro: true, shift: true })).toBeNull();
  });
});
