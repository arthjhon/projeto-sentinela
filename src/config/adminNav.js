// Estrutura de navegação do painel admin: seções do menu lateral, abas de cada
// seção, quem vê o quê e os endereços antigos que redirecionam. Módulo puro
// (sem React além dos ícones) para ser testado sem renderizar.
// Spec: docs/superpowers/specs/2026-11-22-admin-navegacao-design.md (local).
import { LayoutDashboard, ActivitySquare, CloudRain, HeartPulse, SlidersHorizontal } from 'lucide-react';

/** Perfis que veem as telas de gestão (Firmware, Configurações). */
export const PERFIS_GESTAO = Object.freeze(['admin', 'visualizador']);

/** Fail closed: perfil ausente ou desconhecido vale como operador. */
export const ehPerfilGestao = (role) => PERFIS_GESTAO.includes(role);

/** Perfis que leem o log de auditoria (a conta demo, visualizador, não lê). */
export const PERFIS_AUDITORIA = Object.freeze(['admin', 'operador']);

export const ehPerfilAuditoria = (role) => PERFIS_AUDITORIA.includes(role);

const PERFIS_CONFIG = Object.freeze([...new Set([...PERFIS_GESTAO, ...PERFIS_AUDITORIA])]);

const SECOES = Object.freeze([
  {
    titulo: 'Monitoramento',
    itens: [
      { to: '/admin/dashboard', label: 'Visão geral', icon: LayoutDashboard },
      { to: '/admin/boias', label: 'Bóias', icon: ActivitySquare },
      { to: '/admin/contexto', label: 'Contexto ambiental', icon: CloudRain },
      { to: '/admin/status', label: 'Status do sistema', icon: HeartPulse },
    ],
  },
  {
    titulo: 'Administração',
    itens: [
      {
        to: '/admin/config',
        label: 'Configurações',
        icon: SlidersHorizontal,
        perfis: PERFIS_CONFIG,
        // operador só tem a aba Auditoria: o menu leva direto a ela
        toPorPerfil: { operador: '/admin/config/auditoria' },
      },
    ],
  },
]);

const ABAS = Object.freeze({
  boias: [
    { to: 'frota', label: 'Frota' },
    { to: 'firmware', label: 'Firmware', perfis: PERFIS_GESTAO },
  ],
  config: [
    { to: 'site', label: 'Site público', perfis: PERFIS_GESTAO },
    { to: 'changelog', label: 'Changelog', perfis: PERFIS_GESTAO },
    { to: 'operadores', label: 'Operadores', perfis: PERFIS_GESTAO },
    { to: 'auditoria', label: 'Auditoria', perfis: PERFIS_AUDITORIA },
  ],
});

const visivel = (role) => (x) => !x.perfis || x.perfis.includes(role);

/** Seções do menu lateral visíveis para o perfil; seções vazias são omitidas. */
export function navParaPerfil(role) {
  return SECOES.map((s) => ({
    titulo: s.titulo,
    itens: s.itens
      .filter(visivel(role))
      .map(({ to, label, icon, toPorPerfil }) => ({ to: toPorPerfil?.[role] ?? to, label, icon })),
  })).filter((s) => s.itens.length > 0);
}

/** Abas da seção visíveis para o perfil; `to` é relativo à seção. */
export function abasDaSecao(secao, role) {
  return (ABAS[secao] || []).filter(visivel(role)).map(({ to, label }) => ({ to, label }));
}

/** Caminho antigo sob /admin -> destino novo (absoluto). */
export const REDIRECTS_LEGADOS = Object.freeze({
  sensors: '/admin/boias/frota',
  ota: '/admin/boias/firmware',
  settings: '/admin/config/site',
  changelog: '/admin/config/changelog',
  users: '/admin/config/operadores',
});

/** Destino de um endereço antigo, preservando search e hash; null se não for legado. */
export function legacyTarget(antigo, search = '', hash = '') {
  if (!Object.hasOwn(REDIRECTS_LEGADOS, antigo)) return null;
  return `${REDIRECTS_LEGADOS[antigo]}${search}${hash}`;
}
