/** Motivo único da conta demo (visualizador) para toda ação de escrita desabilitada. */
export const MOTIVO_DEMO = 'Indisponível no modo demonstração.';

/**
 * Texto do aviso visível de ações desabilitadas: motivos sem repetição e sem
 * vazios, numa linha. Nenhum motivo = undefined (sem aviso, sem aria-describedby).
 * @param {Array<string|null|undefined|false>} motivos
 * @returns {string|undefined}
 */
export function motivosAviso(motivos) {
  const unicos = [...new Set(motivos.filter((m) => typeof m === 'string' && m))];
  return unicos.length ? unicos.join(' ') : undefined;
}
