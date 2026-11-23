// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verificarCssAdmin } from './adminCssRules.js';

// Status e Contexto ambiental (Onda 2, Task 4).
const SRC = fileURLToPath(new URL('..', import.meta.url));
const ler = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

describe('CSS de Status e Contexto', () => {
  it.each(['pages/admin/StatusPage.css', 'pages/admin/ContextoPage.css'])(
    '%s segue as regras de token', (rel) => {
      expect(verificarCssAdmin(ler(rel), rel)).toEqual([]);
    },
  );
  it.each([
    'pages/admin/StatusPage.jsx', 'pages/admin/ContextoPage.jsx', 'components/admin/ContextoChart.jsx',
  ])('%s não usa #64748b', (rel) => {
    expect(ler(rel).toLowerCase()).not.toContain('#64748b');
  });
});
