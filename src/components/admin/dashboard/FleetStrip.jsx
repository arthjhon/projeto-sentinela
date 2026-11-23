import React from 'react';
import { Info, Wrench } from 'lucide-react';
import { classifyParam, WATER_PARAMS } from '../../../config/waterQuality';
import { estadoMeta } from '../../../services/sensorHealth';
import {
  CAMPOS, TOM_CLASSE, formatIdade, formatValor, rotuloConexao, rotuloGravada, seloManutencao, textoSemSaude,
} from '../../../utils/dashboardView';
import './dashboard.css';

const ROTULO = Object.fromEntries(WATER_PARAMS.map((p) => [p.key, p.label]));

/** Linha de um parâmetro no card: valor com a cor da faixa; "gravada às" se veio do Influx. */
function ValorLinha({ campo, atual, agoraMs }) {
  const faixa = classifyParam(campo, atual.valor);
  return (
    <span className="fc-valor">
      <span className="fc-valor-rotulo" title={ROTULO[campo]}>{ROTULO[campo]}</span>
      <span className={`fc-valor-num${atual.valor === null ? ' is-vazio' : ''}`} style={faixa ? { color: faixa.color } : undefined} title={faixa?.text}>
        {formatValor(atual.valor, campo)}
      </span>
      {atual.fonte === 'gravada' && <span className="fc-valor-nota">{rotuloGravada(atual.em, agoraMs)}</span>}
    </span>
  );
}

/**
 * Um card por bóia do cadastro; clicar seleciona, "Detalhes" abre o modal.
 * Cabeçalho numa linha (nome, código, selos; "Detalhes" posicionado à direita,
 * irmão do botão de seleção: botão dentro de botão não vale), uma linha com os
 * três valores e um rodapé curto (última leitura, saúde dos sensores).
 */
export default function FleetStrip({
  itens, selecionada, onSelecionar, onDetalhes, detalhesCodigo, saudeIndisponivel, agoraMs,
}) {
  return (
    <section className="fleet-strip" aria-label="Frota">
      {itens.map(({ buoy, resumo, manutencao }) => {
        const idade = resumo.ultimaMs != null ? formatIdade(agoraMs - resumo.ultimaMs) : null;
        const conexao = rotuloConexao(resumo.conexao, idade);
        const saude = resumo.saude ? estadoMeta(resumo.saude) : null;
        const ativa = buoy.codigo === selecionada;
        const selo = seloManutencao(manutencao);
        return (
          <article key={buoy.codigo} className={`fleet-card glass${ativa ? ' is-active' : ''}`}>
            <button
              type="button"
              className="fc-select"
              aria-pressed={ativa}
              onClick={() => onSelecionar(buoy.codigo)}
            >
              <span className="fc-head">
                <span className="fc-nome">{buoy.nome}</span>
                <span className="fc-codigo">{buoy.codigo}</span>
                <span className={`badge ${TOM_CLASSE[conexao.tom]}`}>
                  <span className={`fc-dot tom-${conexao.tom}`} aria-hidden="true" />{conexao.texto}
                </span>
                <span className="badge badge-planejada">{resumo.modo}</span>
                {selo && (
                  <span className={`badge ${selo.tipo === 'aberta' ? 'sh-info' : 'badge-planejada'}`} title={selo.title}>
                    <Wrench size={12} /> {selo.texto}
                  </span>
                )}
              </span>
              <span className="fc-valores">
                {CAMPOS.map((c) => <ValorLinha key={c} campo={c} atual={resumo.valores[c]} agoraMs={agoraMs} />)}
              </span>
              <span className="fc-rodape text-muted">
                <span className="fc-ultima">{idade ? `última leitura ${idade}` : 'sem leitura'}</span>
                <span className="fc-saude">
                  Sensores:{' '}
                  {saude ? (
                    <span className={`badge ${TOM_CLASSE[saude.tone]}`}>{saude.label}</span>
                  ) : (
                    <span>{textoSemSaude(saudeIndisponivel)}</span>
                  )}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="btn-table btn-sm fc-detalhes"
              aria-haspopup="dialog"
              aria-expanded={detalhesCodigo === buoy.codigo}
              onClick={() => onDetalhes(buoy)}
            >
              <Info size={14} /> Detalhes
            </button>
          </article>
        );
      })}
    </section>
  );
}
