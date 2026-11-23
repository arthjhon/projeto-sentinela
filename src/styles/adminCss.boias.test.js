// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verificarCssAdmin } from './adminCssRules.js';

// Bóias (Frota e Firmware), Onda 2 Task 2: os CSS da área seguem as regras de
// token e nenhum JSX da área usa a cor reprovada em contraste.
const SRC = fileURLToPath(new URL('..', import.meta.url));

const DIRS = ['components/admin/boias', 'components/admin/firmware', 'components/admin/ficha'];

const arquivosEm = (dir, ext) =>
  fs.readdirSync(path.join(SRC, dir), { recursive: true })
    .filter((f) => f.endsWith(ext))
    .map((f) => path.join(dir, f));

// Os componentes da frota não têm CSS próprio (usam SensorsPage.css/OtaPage.css):
// os arquivos nomeados carregam a verificação; o glob cobre CSS que surgir depois.
const CSS_BOIAS = [
  'pages/admin/SensorsPage.css',
  'pages/admin/OtaPage.css',
  'pages/admin/BuoyFichaPage.css',
  'components/admin/SensorHealth.css',
  ...DIRS.flatMap((d) => arquivosEm(d, '.css')),
];

const JSX_BOIAS = [
  'pages/admin/SensorsPage.jsx',
  'pages/admin/OtaPage.jsx',
  'pages/admin/BuoyFichaPage.jsx',
  ...DIRS.flatMap((d) => arquivosEm(d, '.jsx')),
];

describe('CSS de Bóias (Frota e Firmware)', () => {
  it.each(CSS_BOIAS)('%s segue as regras de token', (rel) => {
    const css = fs.readFileSync(path.join(SRC, rel), 'utf8');
    expect(verificarCssAdmin(css, rel)).toEqual([]);
  });
});

describe('JSX de Bóias sem #64748b', () => {
  it('há componentes para verificar', () => {
    expect(JSX_BOIAS.length).toBeGreaterThan(5);
  });

  it.each(JSX_BOIAS)('%s', (rel) => {
    const jsx = fs.readFileSync(path.join(SRC, rel), 'utf8');
    expect(jsx.match(/#64748b/gi) ?? []).toEqual([]);
  });
});
