import { describe, it, expect } from 'vitest';
import { menuInerte, focoDoMenu } from './menuMobile.js';

describe('menuInerte', () => {
  it('is inert only on mobile with the menu closed', () => {
    expect(menuInerte({ mobile: true, aberto: false })).toBe(true);
    expect(menuInerte({ mobile: true, aberto: true })).toBe(false);
    expect(menuInerte({ mobile: false, aberto: false })).toBe(false);
    expect(menuInerte({ mobile: false, aberto: true })).toBe(false);
  });
});

describe('focoDoMenu', () => {
  it('focuses the first link when opening on mobile', () => {
    expect(focoDoMenu({ mobile: true, aberto: true, jaAbriu: false })).toBe('primeiro-link');
  });
  it('returns focus to the toggle when closing after an open', () => {
    expect(focoDoMenu({ mobile: true, aberto: false, jaAbriu: true })).toBe('botao');
  });
  it('does nothing on first render, on desktop, or when never opened', () => {
    expect(focoDoMenu({ mobile: true, aberto: false, jaAbriu: false })).toBeNull();
    expect(focoDoMenu({ mobile: false, aberto: true, jaAbriu: false })).toBeNull();
    expect(focoDoMenu({ mobile: false, aberto: false, jaAbriu: true })).toBeNull();
  });
});
