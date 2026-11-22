// Estrutura de navegação do painel admin: seções do menu lateral, abas de cada
// seção, quem vê o quê e os endereços antigos que redirecionam. Módulo puro
// (sem React além dos ícones) para ser testado sem renderizar.
// Spec: docs/superpowers/specs/2026-11-22-admin-navegacao-design.md (local).
import { LayoutDashboard, ActivitySquare, CloudRain, HeartPulse, SlidersHorizontal } from 'lucide-react';

/** Perfis que veem as telas de gestão (Firmware, Configurações). */
export const PERFIS_GESTAO = Object.freeze(['admin', 'visualizador']);

/** Fail closed: perfil ausente ou desconhecido vale como operador. */
export const ehPerfilGestao = (role) => PERFIS_GESTAO.includes(role);
const ehGestao = ehPerfilGestao;

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
    itens: [{ to: '/admin/config', label: 'Configurações', icon: SlidersHorizontal, gestao: true }],
  },
]);

const ABAS = Object.freeze({
  boias: [
    { to: 'frota', label: 'Frota' },
    { to: 'firmware', label: 'Firmware', gestao: true },
  ],
  config: [
    { to: 'site', label: 'Site público', gestao: true },
    { to: 'changelog', label: 'Changelog', gestao: true },
    { to: 'operadores', label: 'Operadores', gestao: true },
    { to: 'auditoria', label: 'Auditoria', gestao: true },
  ],
});

const visivel = (role) => (x) => !x.gestao || ehGestao(role);

/** Seções do menu lateral visíveis para o perfil; seções vazias são omitidas. */
export function navParaPerfil(role) {
  return SECOES.map((s) => ({
    titulo: s.titulo,
    itens: s.itens.filter(visivel(role)).map(({ to, label, icon }) => ({ to, label, icon })),
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
