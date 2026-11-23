import React from 'react';
import { formatData, formatDataHora } from '../../../utils/format';
import { TOM_CLASSE } from '../../../utils/dashboardView';

const Mudo = ({ children }) => <span className="bdm-muted">{children}</span>;

function Indisponivel({ onTentar }) {
  return (
    <>
      <Mudo>indisponível</Mudo>{' '}
      <button type="button" className="btn-table btn-sm" onClick={onTentar}>Tentar de novo</button>
    </>
  );
}

function ColunaSaude({ saude, onTentar }) {
  switch (saude.tipo) {
    case 'sem-serial': return <Mudo>sem serial</Mudo>;
    case 'carregando': return <Mudo>carregando…</Mudo>;
    case 'erro': return <Indisponivel onTentar={onTentar} />;
    case 'sem-avaliacao': return <Mudo>sem avaliação</Mudo>;
    default:
      return (
        <>
          <span className={`badge ${TOM_CLASSE[saude.tom]}`}>{saude.label}</span>
          {saude.motivo && <span className="ficha-sensor-motivo"> {saude.motivo}</span>}
          {saude.desde && <Mudo> · desde {formatDataHora(saude.desde)}</Mudo>}
        </>
      );
  }
}

function ColunaCalibracao({ calibracao, onTentar }) {
  switch (calibracao.tipo) {
    case 'carregando': return <Mudo>carregando…</Mudo>;
    case 'erro': return <Indisponivel onTentar={onTentar} />;
    case 'nenhuma': return <Mudo>nenhuma registrada</Mudo>;
    default: {
      const r = calibracao.registro;
      return (
        <>
          <span>{formatData(r.calibrated_at)}{r.operador_nome ? ` por ${r.operador_nome}` : ''}</span>
          {r.observacao && <span className="ficha-sensor-obs" title={r.observacao}>{r.observacao}</span>}
        </>
      );
    }
  }
}

/** Bloco "Sensores": uma linha por sensor; estados por coluna. `onTentarDeNovo('saudeAtual'|'calibracao')`. */
export default function FichaSensores({ linhas, onTentarDeNovo }) {
  return (
    <ul className="ficha-sensores">
      {linhas.map((l) => (
        <li key={l.key} className="ficha-sensor">
          <strong className="ficha-sensor-nome">{l.nome}</strong>
          <div className="ficha-sensor-col">
            <span className="ficha-sensor-rot">Saúde</span>
            <div><ColunaSaude saude={l.saude} onTentar={() => onTentarDeNovo('saudeAtual')} /></div>
          </div>
          <div className="ficha-sensor-col">
            <span className="ficha-sensor-rot">Última calibração</span>
            <div><ColunaCalibracao calibracao={l.calibracao} onTentar={() => onTentarDeNovo('calibracao')} /></div>
            {l.avisoFirmware && <span className="ficha-sensor-aviso">firmware informa não calibrado</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
