/**
 * Destino do foco ao apertar Tab num diálogo modal, ou null para deixar o
 * navegador seguir. `titulo` é o cabeçalho focável por código (tabindex -1, onde
 * o foco nasce); `primeiro`/`ultimo` são os focáveis por Tab; `dentro` diz se
 * o foco atual está no diálogo. Shift+Tab no título, que não está na ordem de
 * Tab, também vai ao último (senão o foco escapa do diálogo).
 */
export function destinoTab({ ativo, titulo, primeiro, ultimo, dentro, shift }) {
  if (!primeiro || !ultimo) return null;
  if (!dentro) return shift ? ultimo : primeiro;
  if (shift) return ativo === primeiro || ativo === titulo ? ultimo : null;
  return ativo === ultimo ? primeiro : null;
}
