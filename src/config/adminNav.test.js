import { describe, it, expect } from 'vitest';
import {
  PERFIS_GESTAO,
  navParaPerfil,
  abasDaSecao,
  REDIRECTS_LEGADOS,
  legacyTarget,
  ehPerfilGestao,
  PERFIS_AUDITORIA,
  ehPerfilAuditoria,
  tituloDaRota,
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

  it('operador vê Monitoramento e Configurações apontando direto para a Auditoria', () => {
    expect(resumo(navParaPerfil('operador'))).toEqual([
      MONITORAMENTO,
      { titulo: 'Administração', itens: [['/admin/config/auditoria', 'Configurações']] },
    ]);
  });

  it('perfil ausente ou desconhecido vê só Monitoramento (fail closed)', () => {
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

  it('Configurações: visualizador não vê a aba Auditoria', () => {
    expect(abasDaSecao('config', 'visualizador').map((a) => a.to)).toEqual(['site', 'changelog', 'operadores']);
  });

  it('Configurações: operador vê só Auditoria', () => {
    expect(abasDaSecao('config', 'operador')).toEqual([{ to: 'auditoria', label: 'Auditoria' }]);
  });

  it('Configurações: perfil desconhecido não vê aba', () => {
    expect(abasDaSecao('config', undefined)).toEqual([]);
    expect(abasDaSecao('config', 'qualquer')).toEqual([]);
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

describe('PERFIS_AUDITORIA', () => {
  it('são admin e operador (a demo não lê o log)', () => {
    expect([...PERFIS_AUDITORIA]).toEqual(['admin', 'operador']);
    expect(ehPerfilAuditoria('admin')).toBe(true);
    expect(ehPerfilAuditoria('operador')).toBe(true);
    expect(ehPerfilAuditoria('visualizador')).toBe(false);
    expect(ehPerfilAuditoria(undefined)).toBe(false);
  });
});

describe('tituloDaRota', () => {
  it('rota de item do menu usa o rótulo do item', () => {
    expect(tituloDaRota('/admin/dashboard', 'admin')).toBe('Visão geral');
    expect(tituloDaRota('/admin/status', 'demo-inexistente')).toBe('Status do sistema');
  });

  it('subrota (aba) usa o rótulo da seção', () => {
    expect(tituloDaRota('/admin/boias/frota', 'admin')).toBe('Bóias');
    expect(tituloDaRota('/admin/boias/firmware', 'visualizador')).toBe('Bóias');
    expect(tituloDaRota('/admin/boias/frota', 'operador')).toBe('Bóias');
    expect(tituloDaRota('/admin/config/operadores', 'admin')).toBe('Configurações');
  });

  it('ficha da bóia usa o título da seção e não muda as abas', () => {
    expect(tituloDaRota('/admin/boias/SM-01', 'admin')).toBe('Bóias');
    expect(abasDaSecao('boias', 'operador')).toEqual([{ to: 'frota', label: 'Frota' }]);
  });

  it('índice da seção, antes do redirect, já tem título', () => {
    expect(tituloDaRota('/admin/boias', 'admin')).toBe('Bóias');
    expect(tituloDaRota('/admin/boias/', 'admin')).toBe('Bóias');
  });

  it('operador em Configurações vê "Auditoria" (a única aba dele)', () => {
    expect(tituloDaRota('/admin/config/auditoria', 'operador')).toBe('Auditoria');
  });

  it('casa só em fronteira de segmento', () => {
    expect(tituloDaRota('/admin/boiasx', 'admin')).toBe('Página não encontrada');
    expect(tituloDaRota('/admin/dashboardx', 'admin')).toBe('Página não encontrada');
  });

  it('rota desconhecida', () => {
    expect(tituloDaRota('/admin/xyz', 'admin')).toBe('Página não encontrada');
    expect(tituloDaRota('/admin', 'admin')).toBe('Página não encontrada');
  });

  it('perfil com nome de propriedade de Object não vaza para o título', () => {
    expect(tituloDaRota('/admin/config/site', 'constructor')).toBe('Configurações');
  });

  it('navParaPerfil não expõe tituloPorPerfil', () => {
    for (const s of navParaPerfil('operador')) for (const i of s.itens) expect(i).not.toHaveProperty('tituloPorPerfil');
  });
});
