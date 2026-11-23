import React from 'react';

const vazio = (no) => no === null || no === undefined || no === false || no === '';

/**
 * Faixa de ações e informações curtas da página, logo abaixo da topbar (que já
 * traz o título da rota): `inicio` à esquerda, `children` (ações) à direita.
 * Sem conteúdo, não ocupa espaço.
 */
const PageToolbar = ({ inicio, children }) => {
  const semInicio = vazio(inicio);
  const semAcoes = React.Children.toArray(children).length === 0;
  if (semInicio && semAcoes) return null;
  return (
    <div className="page-toolbar">
      {!semInicio && <div className="page-toolbar-inicio">{inicio}</div>}
      {!semAcoes && <div className="page-toolbar-acoes">{children}</div>}
    </div>
  );
};

export default PageToolbar;
