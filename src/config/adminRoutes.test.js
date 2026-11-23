import { describe, it, expect } from 'vitest';
import { destinoIndiceConfig } from './adminRoutes';

describe('destinoIndiceConfig', () => {
  it('admin and visualizador land on the site tab', () => {
    expect(destinoIndiceConfig('admin')).toBe('/admin/config/site');
    expect(destinoIndiceConfig('visualizador')).toBe('/admin/config/site');
  });
  it('operador (only sees Auditoria) lands on auditoria, never on access-denied', () => {
    expect(destinoIndiceConfig('operador')).toBe('/admin/config/auditoria');
  });
  it('unknown or missing role has no config tab: back to the overview', () => {
    expect(destinoIndiceConfig(undefined)).toBe('/admin/dashboard');
    expect(destinoIndiceConfig('hacker')).toBe('/admin/dashboard');
  });
});
