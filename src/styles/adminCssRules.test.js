// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { verificarCssAdmin } from './adminCssRules.js';

const ok = (css, nome = 'X.css') => expect(verificarCssAdmin(css, nome)).toEqual([]);
const viola = (css, nome = 'X.css') => expect(verificarCssAdmin(css, nome)).toHaveLength(1);

describe('verificarCssAdmin', () => {
  it('CSS vazio passa', () => ok(''));

  it('cor #64748b é proibida, sem diferenciar maiúsculas', () => {
    viola('.a { color: #64748b; }');
    viola('.a { color: #64748B; }');
    ok('.a { color: var(--text-subtle); }');
  });

  it('cor #eab308 é proibida', () => {
    viola('.a { color: #EAB308; }');
    ok('.a { color: var(--warning); }');
  });

  it('font-size só por token ou inherit', () => {
    viola('.a { font-size: 0.78rem; }');
    viola('.a { font-size: 14px }');
    ok('.a { font-size: var(--fs-sm); }');
    ok('.a { font-size: inherit; }');
    ok('.a{font-size:var(--fs-xl)}');
  });

  it('border-radius só por token, 50% ou 0', () => {
    viola('.a { border-radius: 6px; }');
    viola('.a { border-radius: 0 8px 8px 0; }');
    ok('.a { border-radius: var(--radius-ctl); }');
    ok('.a { border-radius: 50%; }');
    ok('.a { border-radius: 0; }');
  });

  it('backdrop-filter só em AdminLayout.css e Modal.css', () => {
    viola('.a { backdrop-filter: blur(6px); }', 'src/pages/admin/X.css');
    ok('.a { backdrop-filter: blur(6px); }', 'src/pages/admin/AdminLayout.css');
    ok('.a { backdrop-filter: blur(6px); }', 'src/components/admin/Modal.css');
  });

  it('ignora regras dentro de comentários', () => {
    ok('/* .a { font-size: 0.78rem; color: #64748b; border-radius: 6px } */ .b { font-size: var(--fs-md) }');
    ok('/* várias\n linhas: font-size: 2rem;\n */');
  });

  it('cada violação cita o arquivo e a linha', () => {
    const [v] = verificarCssAdmin('.a {\n  font-size: 0.9rem;\n}', 'Y.css');
    expect(v).toMatch(/^Y\.css:2: /);
    expect(v).toContain('0.9rem');
  });

  it('conta uma violação por declaração', () => {
    expect(verificarCssAdmin('.a { font-size: 1rem; border-radius: 4px; color: #64748b }', 'X.css')).toHaveLength(3);
  });
});
