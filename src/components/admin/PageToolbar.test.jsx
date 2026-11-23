// @vitest-environment node
import React from 'react';
import { describe, it, expect } from 'vitest';
import PageToolbar from './PageToolbar.jsx';

// Componente sem hooks: chamado como função, devolve a árvore (sem render lib).
const classes = (el) => React.Children.toArray(el.props.children).map((c) => c.props.className);

describe('PageToolbar', () => {
  it('sem início nem ações não renderiza nada', () => {
    expect(PageToolbar({})).toBeNull();
    expect(PageToolbar({ inicio: null, children: [false, null] })).toBeNull();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['false', false],
    ["''", ''],
  ])('início %s sem ações não renderiza nada', (_, inicio) => {
    expect(PageToolbar({ inicio })).toBeNull();
    expect(PageToolbar({ inicio, children: [] })).toBeNull();
  });

  it("ações vazias (null, false, '') não contam como ação", () => {
    expect(PageToolbar({ children: '' })).toBeNull();
    expect(PageToolbar({ children: [null, false, undefined, ''] })).toBeNull();
  });

  it('0 é conteúdo: renderiza no início e nas ações', () => {
    expect(classes(PageToolbar({ inicio: 0 }))).toEqual(['page-toolbar-inicio']);
    expect(classes(PageToolbar({ children: 0 }))).toEqual(['page-toolbar-acoes']);
  });

  it('só início', () => {
    const el = PageToolbar({ inicio: 'Atualizado às 10:00' });
    expect(el.props.className).toBe('page-toolbar');
    expect(classes(el)).toEqual(['page-toolbar-inicio']);
  });

  it('só ações', () => {
    const el = PageToolbar({ children: <button type="button">Atualizar</button> });
    expect(classes(el)).toEqual(['page-toolbar-acoes']);
  });

  it('início e ações, nessa ordem', () => {
    const el = PageToolbar({ inicio: <span>x</span>, children: [<button key="a" type="button">a</button>, false] });
    expect(classes(el)).toEqual(['page-toolbar-inicio', 'page-toolbar-acoes']);
  });
});
