import React from 'react';
import { classifyParam, WATER_PARAMS } from '../../../config/waterQuality';
import { estadoMeta } from '../../../services/sensorHealth';
import { TOM_CLASSE, formatValor, rotuloOrigem, textoSemSaude } from '../../../utils/dashboardView';
import { rotuloSemLeitura } from './semLeitura';

const PARAM = Object.fromEntries(WATER_PARAMS.map((p) => [p.key, p]));

/**
 * Um sensor da bóia selecionada: valor atual, faixa de qualidade, saúde do
 * detector e mín./máx. das últimas 24 h. `saude` = linha do sensor em
 * healthForDevice (ou null); `extremos` = {min, max} | null (sem leitura) | undefined (carregando) | 'erro'.
 * Sem valor, o card vira uma linha só ("sem leitura desde HH:MM"), com a saúde
 * (ou a falha ao lê-la) e o mín./máx. apenas quando houver o que mostrar.
 */
export default function SensorCard({ campo, atual, saude, saudeIndisponivel, extremos, agoraMs }) {
  const p = PARAM[campo];
  const Icone = p.icon;
  const faixa = classifyParam(campo, atual.valor);
  const meta = saude ? estadoMeta(saude.estado) : null;

  if (atual.valor === null) {
    const temExtremos = extremos && typeof extremos === 'object';
    return (
      <div className="sensor-card glass is-vazio">
        <span className="sc-nome"><Icone size={16} style={{ color: p.color }} /> {p.label}</span>
        <span className="sc-vazio-texto">{rotuloSemLeitura(atual.em, agoraMs)}</span>
        {temExtremos && (
          <span className="sc-vazio-extra text-muted" title="Das médias de 10 min gravadas e das últimas leituras brutas">
            24 h: {formatValor(extremos.min, campo)} / {formatValor(extremos.max, campo)}
          </span>
        )}
        {meta
          ? <span className={`badge ${TOM_CLASSE[meta.tone]}`} title={saude.motivo ?? undefined}>{meta.label}</span>
          : saudeIndisponivel && <span className="sc-vazio-extra text-muted">{textoSemSaude(true)}</span>}
      </div>
    );
  }

  const origem = rotuloOrigem(atual, agoraMs);
  return (
    <div className="sensor-card glass" style={faixa ? { borderColor: `${faixa.color}55` } : undefined}>
      <div className="sc-head">
        <span className="sc-nome"><Icone size={18} style={{ color: p.color }} /> {p.label}</span>
        {faixa && <span className="sc-faixa" style={{ color: faixa.color }}>{faixa.text}</span>}
      </div>
      <div className="sc-valor" style={faixa ? { color: faixa.color } : undefined}>{formatValor(atual.valor, campo)}</div>
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
