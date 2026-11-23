// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verificarCssAdmin } from './adminCssRules.js';

// Visão geral (Onda 2, Task 3): CSS da página e dos componentes da visão geral
// seguem as regras de token; eixos dos gráficos sem a cor muda reprovada.
const SRC = fileURLToPath(new URL('..', import.meta.url));
const DIR = 'components/admin/dashboard';

const doDir = (ext) =>
  fs.readdirSync(path.join(SRC, DIR)).filter((f) => f.endsWith(ext)).map((f) => path.join(DIR, f));

const CSS = ['pages/admin/AdminDashboard.css', ...doDir('.css')];
const JSX = ['pages/admin/AdminDashboard.jsx', ...doDir('.jsx')];

describe('CSS da visão geral', () => {
  it('há CSS para verificar', () => {
    expect(CSS.length).toBeGreaterThanOrEqual(4);
  });

  it.each(CSS)('%s segue as regras de token', (rel) => {
    const css = fs.readFileSync(path.join(SRC, rel), 'utf8');
    expect(verificarCssAdmin(css, rel)).toEqual([]);
  });
});

describe('JSX da visão geral sem #64748b (eixos via COR_TEXTO_SUTIL)', () => {
  it.each(JSX)('%s', (rel) => {
    const jsx = fs.readFileSync(path.join(SRC, rel), 'utf8');
    expect(jsx.match(/#64748b/gi) ?? []).toEqual([]);
  });
});
