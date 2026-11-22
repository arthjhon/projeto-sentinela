import { describe, it, expect } from 'vitest';
import {
  PERFIS_GESTAO,
  navParaPerfil,
  abasDaSecao,
  REDIRECTS_LEGADOS,
  legacyTarget,
  ehPerfilGestao,
} from './adminNav.js';

const resumo = (secoes) =>
  secoes.map((s) => ({ titulo: s.titulo, itens: s.itens.map((i) => [i.to, i.label]) }));

const MONITORAMENTO = {
  titulo: 'Monitoramento',
  itens: [
    ['/admin/dashboard', 'Visão geral'],
    ['/admin/boias', 'Bóias'],
    ['/admin/contexto', 'Contexto ambiental'],
    ['/admin/status', 'Status do sistema'],
  ],
};
const ADMINISTRACAO = { titulo: 'Administração', itens: [['/admin/config', 'Configurações']] };

describe('PERFIS_GESTAO', () => {
  it('são admin e visualizador', () => {
    expect([...PERFIS_GESTAO]).toEqual(['admin', 'visualizador']);
  });
});

describe('navParaPerfil', () => {
  it('admin vê Monitoramento e Administração', () => {
    expect(resumo(navParaPerfil('admin'))).toEqual([MONITORAMENTO, ADMINISTRACAO]);
  });

  it('visualizador vê o mesmo que o admin', () => {
    expect(resumo(navParaPerfil('visualizador'))).toEqual([MONITORAMENTO, ADMINISTRACAO]);
  });

  it('operador vê só Monitoramento', () => {
    expect(resumo(navParaPerfil('operador'))).toEqual([MONITORAMENTO]);
  });

  it('perfil ausente ou desconhecido é tratado como operador', () => {
    expect(resumo(navParaPerfil(undefined))).toEqual([MONITORAMENTO]);
    expect(resumo(navParaPerfil('qualquer'))).toEqual([MONITORAMENTO]);
  });

  it('todo item traz um ícone', () => {
    for (const s of navParaPerfil('admin')) for (const i of s.itens) expect(i.icon).toBeTruthy();
  });
});

describe('abasDaSecao', () => {
  it('Bóias: admin vê Frota e Firmware', () => {
    expect(abasDaSecao('boias', 'admin')).toEqual([
      { to: 'frota', label: 'Frota' },
      { to: 'firmware', label: 'Firmware' },
    ]);
  });

  it('Bóias: operador vê só Frota', () => {
    expect(abasDaSecao('boias', 'operador')).toEqual([{ to: 'frota', label: 'Frota' }]);
  });

  it('Configurações: admin vê as 4 abas na ordem', () => {
    expect(abasDaSecao('config', 'admin')).toEqual([
      { to: 'site', label: 'Site público' },
      { to: 'changelog', label: 'Changelog' },
      { to: 'operadores', label: 'Operadores' },
      { to: 'auditoria', label: 'Auditoria' },
    ]);
  });

  it('Configurações: operador e perfil desconhecido não veem aba', () => {
    expect(abasDaSecao('config', 'operador')).toEqual([]);
    expect(abasDaSecao('config', undefined)).toEqual([]);
  });
});

describe('redirecionamentos legados', () => {
  it('cobrem exatamente os 5 endereços antigos', () => {
    expect(REDIRECTS_LEGADOS).toEqual({
      sensors: '/admin/boias/frota',
      ota: '/admin/boias/firmware',
      settings: '/admin/config/site',
      changelog: '/admin/config/changelog',
      users: '/admin/config/operadores',
    });
  });

  it('legacyTarget preserva search e hash', () => {
    expect(legacyTarget('ota', '?x=1', '#y')).toBe('/admin/boias/firmware?x=1#y');
  });

  it('legacyTarget sem search/hash', () => {
    expect(legacyTarget('users')).toBe('/admin/config/operadores');
  });

  it('legacyTarget devolve null para caminho que não é legado', () => {
    expect(legacyTarget('boias')).toBeNull();
    expect(legacyTarget('constructor')).toBeNull();
  });
});

describe('ehPerfilGestao', () => {
  it('admits management profiles only, failing closed', () => {
    expect(ehPerfilGestao('admin')).toBe(true);
    expect(ehPerfilGestao('visualizador')).toBe(true);
    expect(ehPerfilGestao('operador')).toBe(false);
    expect(ehPerfilGestao(undefined)).toBe(false);
    expect(ehPerfilGestao('qualquer')).toBe(false);
  });
});
