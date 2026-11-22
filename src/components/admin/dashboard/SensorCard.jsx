import React from 'react';
import { classifyParam, WATER_PARAMS } from '../../../config/waterQuality';
import { estadoMeta } from '../../../services/sensorHealth';
import { TOM_CLASSE, formatValor, rotuloOrigem, textoSemSaude } from '../../../utils/dashboardView';

const PARAM = Object.fromEntries(WATER_PARAMS.map((p) => [p.key, p]));

/**
 * Um sensor da bóia selecionada: valor atual, faixa de qualidade, saúde do
 * detector e mín./máx. das últimas 24 h. `saude` = linha do sensor em
 * healthForDevice (ou null); `extremos` = {min, max} | null (sem leitura) | undefined (carregando) | 'erro'.
 */
export default function SensorCard({ campo, atual, saude, saudeIndisponivel, extremos, agoraMs }) {
  const p = PARAM[campo];
  const Icone = p.icon;
  const faixa = classifyParam(campo, atual.valor);
  const meta = saude ? estadoMeta(saude.estado) : null;
  const origem = rotuloOrigem(atual, agoraMs);

  return (
    <div className="sensor-card glass" style={faixa ? { borderColor: `${faixa.color}55` } : undefined}>
      <div className="sc-head">
        <span className="sc-nome"><Icone size={18} style={{ color: p.color }} /> {p.label}</span>
        {faixa && <span className="sc-faixa" style={{ color: faixa.color }}>{faixa.text}</span>}
      </div>
      <div className={`sc-valor${atual.valor === null ? ' is-vazio' : ''}`} style={faixa ? { color: faixa.color } : undefined}>{formatValor(atual.valor, campo)}</div>
      <div className="sc-origem text-muted">{origem}</div>
      <dl className="sc-dados">
        <div>
          <dt>Saúde</dt>
          <dd>
            {meta
              ? <span className={`badge ${TOM_CLASSE[meta.tone]}`} title={saude.motivo ?? undefined}>{meta.label}</span>
              : <span className="text-muted">{textoSemSaude(saudeIndisponivel)}</span>}
          </dd>
        </div>
        <div>
          <dt title="Das médias de 10 min gravadas e das últimas leituras brutas">Mín./máx. 24 h</dt>
          <dd>
            {extremos === undefined ? <span className="text-muted">carregando…</span>
              : extremos === 'erro' ? <span className="text-muted">indisponível</span>
              : extremos === null ? <span className="text-muted">sem leitura</span>
                : `${formatValor(extremos.min, campo)} / ${formatValor(extremos.max, campo)}`}
          </dd>
        </div>
      </dl>
    </div>
  );
}
