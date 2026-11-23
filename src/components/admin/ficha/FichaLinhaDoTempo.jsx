import React, { useState } from 'react';
import { TIPOS, ROTULO_TIPO, montarLinhaDoTempo, linhaDoTempoVazia } from '../../../utils/fichaBoia';
import { paginar } from '../../../utils/paginar';
import { formatDataHora } from '../../../utils/format';
import { TOM_CLASSE } from '../../../utils/dashboardView';

const POR_PAGINA = 25;
const FILTROS = [{ chave: 'tudo', rotulo: 'Tudo' }, ...TIPOS.map((t) => ({ chave: t, rotulo: ROTULO_TIPO[t] }))];

function Aviso({ aviso, onTentarDeNovo }) {
  const rot = ROTULO_TIPO[aviso.tipo];
  if (aviso.estado === 'sem-acesso') return <li className="ficha-tl-aviso">{rot}: sem acesso para este perfil</li>;
  if (aviso.estado === 'erro') {
    return (
      <li className="ficha-tl-aviso">
        {rot}: indisponível{' '}
        <button type="button" className="btn-table btn-sm" onClick={() => onTentarDeNovo(aviso.tipo)}>Tentar de novo</button>
      </li>
    );
  }
  return <li className="ficha-tl-aviso">{rot}: carregando…</li>;
}

/** Bloco "Linha do tempo": filtro por tipo, avisos por fonte, lista paginada. */
export default function FichaLinhaDoTempo({ fontes, agoraMs, serialAtual, modo, onTentarDeNovo }) {
  const [filtro, setFiltro] = useState('tudo');
  const [pagina, setPagina] = useState(1);

  const { itens, avisos, limitesAtingidos } = montarLinhaDoTempo({ fontes, filtro, agoraMs, serialAtual, modo });
  const { itens: visiveis, pagina: atual, totalPaginas } = paginar(itens, pagina, POR_PAGINA);
  const vazio = linhaDoTempoVazia({ itens, avisos });

  const escolher = (chave) => { setFiltro(chave); setPagina(1); };

  return (
    <>
      <div className="ficha-filtros" role="group" aria-label="Filtrar linha do tempo">
        {FILTROS.map((f) => (
          <button
            key={f.chave}
            type="button"
            className="btn-table ficha-filtro"
            aria-pressed={filtro === f.chave}
            onClick={() => escolher(f.chave)}
          >
            {f.rotulo}
          </button>
        ))}
      </div>

      {avisos.length > 0 && (
        <ul className="ficha-tl-avisos">
          {avisos.map((a) => <Aviso key={a.tipo} aviso={a} onTentarDeNovo={onTentarDeNovo} />)}
        </ul>
      )}

      {vazio && <p className="text-muted" role="status">Nenhum evento registrado.</p>}

      {visiveis.length > 0 && (
        <ol className="ficha-tl">
          {visiveis.map((it) => (
            <li key={it.id} className="ficha-tl-item">
              <div className="ficha-tl-cab">
                {Number.isFinite(it.emMs)
                  ? <time dateTime={new Date(it.emMs).toISOString()}>{formatDataHora(it.emMs)}</time>
                  : <span>—</span>}
                <span className="badge badge-planejada">{ROTULO_TIPO[it.tipo]}</span>
                {it.autor && <span className="bdm-muted">por {it.autor}</span>}
              </div>
              <p className="ficha-tl-frase">
                <span className={`badge ficha-tl-marca ${TOM_CLASSE[it.tom]}`} aria-hidden="true" />
                {it.frase}
              </p>
              {it.detalhe && <p className="ficha-tl-detalhe bdm-muted">{it.detalhe}</p>}
            </li>
          ))}
        </ol>
      )}

      {itens.length > POR_PAGINA && (
        <nav className="ficha-pag" aria-label="Paginação da linha do tempo">
          <button type="button" className="btn-table" onClick={() => setPagina(atual - 1)} disabled={atual <= 1}>Anterior</button>
          <span className="ficha-pag-info" role="status">Página {atual} de {totalPaginas}</span>
          <button type="button" className="btn-table" onClick={() => setPagina(atual + 1)} disabled={atual >= totalPaginas}>Próxima</button>
        </nav>
      )}

      {limitesAtingidos.length > 0 && (
        <p className="ficha-tl-rodape bdm-muted">
          Mostrando os 100 mais recentes de: {limitesAtingidos.map((t) => ROTULO_TIPO[t]).join(', ')}.
        </p>
      )}
    </>
  );
}
