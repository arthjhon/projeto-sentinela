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
    expect(PageToolbar({ inicio: '' })).toBeNull();
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
