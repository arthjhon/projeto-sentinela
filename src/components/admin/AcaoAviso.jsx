import React from 'react';

/**
 * Linha visível com o motivo de ações desabilitadas (o `title` só aparece com
 * mouse; no toque ninguém vê). Ligue cada botão desabilitado a ela com
 * `aria-describedby={id}` (só enquanto estiver desabilitado). Sem texto = não renderiza.
 * Texto: `motivosAviso(...)` em utils/acaoAviso.js. Estilo `.acao-aviso` em admin-shared.css.
 */
export default function AcaoAviso({ id, children }) {
  if (!children) return null;
  return <p className="acao-aviso text-muted" id={id}>{children}</p>;
}
