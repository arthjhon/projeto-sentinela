import { abasDaSecao } from './adminNav';

/**
 * Destino do índice de /admin/config conforme o perfil: a primeira aba que o
 * perfil vê (operador só vê Auditoria). Perfil sem nenhuma aba volta à Visão geral
 * em vez de cair numa tela de acesso negado.
 */
export function destinoIndiceConfig(role) {
  const primeira = abasDaSecao('config', role)[0];
  return primeira ? `/admin/config/${primeira.to}` : '/admin/dashboard';
}
