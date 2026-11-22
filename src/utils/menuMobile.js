// Decisões do menu lateral no celular (<= 768 px), sem DOM, para teste em node.

/** O aside sai da ordem de Tab só quando está fora da tela (celular, fechado). */
export const menuInerte = ({ mobile, aberto }) => mobile && !aberto;

/**
 * Para onde o foco vai após uma mudança de estado do menu:
 * 'primeiro-link' ao abrir, 'botao' ao fechar depois de ter aberto, senão null
 * (primeira renderização e desktop não mexem no foco).
 */
export function focoDoMenu({ mobile, aberto, jaAbriu }) {
  if (!mobile) return null;
  if (aberto) return 'primeiro-link';
  return jaAbriu ? 'botao' : null;
}
