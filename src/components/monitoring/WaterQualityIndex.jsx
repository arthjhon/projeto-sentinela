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
    <div className="mon-widget" style={{ textAlign: 'center' }}>
      <div className="mon-widget-title">Índice de Qualidade da Água</div>
      {!wqi ? (
        <div className="mon-empty">Aguardando leitura…</div>
      ) : (
        <svg width="180" height="120" viewBox="0 0 180 120" style={{ maxWidth: '100%' }}>
          <path d={arc} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={STROKE} strokeLinecap="round" />
          <path d={arc} fill="none" stroke={wqi.color} strokeWidth={STROKE} strokeLinecap="round"
            strokeDasharray={`${filled} ${len}`} />
          <text x={CX} y={CY - 16} textAnchor="middle" fontSize="34" fontWeight="800" fill={wqi.color}>{wqi.score}</text>
          <text x={CX} y={CY + 10} textAnchor="middle" fontSize="14" fontWeight="700" letterSpacing="1.5" fill={wqi.color}>{wqi.level}</text>
        </svg>
      )}
    </div>
  );
}
