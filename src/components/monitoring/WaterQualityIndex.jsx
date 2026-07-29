import React from 'react';
import { computeWQI } from '../../config/waterQuality';
import './monitoring.css';

// Gauge semicircular desenhado em SVG (determinístico, sem dependência de layout).
export default function WaterQualityIndex({ reading }) {
  const wqi = computeWQI(reading);

  const R = 70, CX = 90, CY = 92, STROKE = 14;
  const len = Math.PI * R;                     // comprimento do semicírculo
  const filled = wqi ? (wqi.score / 100) * len : 0;
  const arc = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;

  return (
    <div className="mon-widget wqi-widget" style={{ textAlign: 'center' }}>
      <div className="mon-widget-title">Índice de Qualidade da Água</div>
      <div className="wqi-body">
        {!wqi ? (
          <div className="mon-empty">Aguardando leitura…</div>
        ) : (
          // O tamanho vem do CSS (.wqi-gauge), não de width/height fixos: é ele
          // que mantém o card mais baixo que os de métrica, para a linha do
          // grid ser ditada por eles e as alturas baterem.
          <svg className="wqi-gauge" viewBox="0 0 180 120" role="img"
               aria-label={`Índice de qualidade da água: ${wqi.score} de 100, ${wqi.level}`}>
            <path d={arc} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={STROKE} strokeLinecap="round" />
            <path d={arc} fill="none" stroke={wqi.color} strokeWidth={STROKE} strokeLinecap="round"
              strokeDasharray={`${filled} ${len}`} />
            <text x={CX} y={CY - 16} textAnchor="middle" fontSize="34" fontWeight="800" fill={wqi.color}>{wqi.score}</text>
            <text x={CX} y={CY + 10} textAnchor="middle" fontSize="14" fontWeight="700" letterSpacing="1.5" fill={wqi.color}>{wqi.level}</text>
          </svg>
        )}
      </div>
    </div>
  );
}
