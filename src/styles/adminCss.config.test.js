// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verificarCssAdmin } from './adminCssRules.js';

// Configuracoes (Onda 2, Task 5).
const SRC = fileURLToPath(new URL('..', import.meta.url));

const CSS = [
  'pages/admin/SettingsPage.css',
  'pages/admin/ChangelogPage.css',
  'pages/admin/UsersPage.css',
  'components/admin/AuditLogPanel.css',
];
const JSX = [
  'pages/admin/SettingsPage.jsx',
  'pages/admin/ChangelogPage.jsx',
  'pages/admin/UsersPage.jsx',
  'pages/admin/AuditoriaPage.jsx',
  'components/admin/AuditLogPanel.jsx',
];

describe('Configuracoes', () => {
  it.each(CSS)('%s segue as regras de token', (rel) => {
    expect(verificarCssAdmin(fs.readFileSync(path.join(SRC, rel), 'utf8'), rel)).toEqual([]);
  });
  it.each(JSX)('%s sem #64748b', (rel) => {
    expect(fs.readFileSync(path.join(SRC, rel), 'utf8').toLowerCase()).not.toContain('#64748b');
  });
});
