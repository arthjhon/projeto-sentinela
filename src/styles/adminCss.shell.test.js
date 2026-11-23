// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verificarCssAdmin } from './adminCssRules.js';

// Casca do painel (Onda 2, Task 1): os CSS da casca seguem as regras de token
// e nenhuma tela admin soma `mt-4` ao gap do contêiner.
const SRC = fileURLToPath(new URL('..', import.meta.url));

const CSS_CASCA = [
  'styles/admin-shared.css',
  'pages/admin/AdminLayout.css',
  'components/admin/AdminSection.css',
  'components/admin/Modal.css',
  'components/admin/AcessoNegado.css',
];

const jsxEm = (dir) =>
  fs.readdirSync(path.join(SRC, dir), { recursive: true })
    .filter((f) => f.endsWith('.jsx'))
    .map((f) => path.join(dir, f));

describe('CSS da casca do admin', () => {
  it.each(CSS_CASCA)('%s segue as regras de token', (rel) => {
    const css = fs.readFileSync(path.join(SRC, rel), 'utf8');
    expect(verificarCssAdmin(css, rel)).toEqual([]);
  });
});

describe('sem mt-4 nas telas admin', () => {
  const arquivos = [...jsxEm('pages/admin'), ...jsxEm('components/admin')];

  it('há telas para verificar', () => {
    expect(arquivos.length).toBeGreaterThan(10);
  });

  it.each(arquivos)('%s', (rel) => {
    const jsx = fs.readFileSync(path.join(SRC, rel), 'utf8');
    const classes = [...jsx.matchAll(/className=\{?\s*["'`]([^"'`]*)["'`]/g)].map((m) => m[1]);
    expect(classes.filter((c) => /(^|\s)mt-4(\s|$)/.test(c))).toEqual([]);
  });
});
