import React from 'react';
import { RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts';
import { computeWQI } from '../../config/waterQuality';
import './monitoring.css';

export default function WaterQualityIndex({ reading }) {
  const wqi = computeWQI(reading);
  return (
    <div className="mon-widget" style={{ textAlign: 'center' }}>
      <div className="mon-widget-title">Índice de Qualidade da Água</div>
      {!wqi ? (
        <div className="mon-empty">Aguardando leitura…</div>
      ) : (
        <>
          <RadialBarChart width={180} height={120} cx={90} cy={100} innerRadius={62} outerRadius={86}
            startAngle={180} endAngle={0} data={[{ value: wqi.score, fill: wqi.color }]}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar background={{ fill: 'rgba(255,255,255,0.06)' }} dataKey="value" cornerRadius={8} />
          </RadialBarChart>
          <div style={{ marginTop: -34 }}>
            <div style={{ fontSize: 30, fontWeight: 800, color: wqi.color }}>{wqi.score}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: wqi.color, letterSpacing: '.05em' }}>{wqi.level}</div>
          </div>
        </>
      )}
    </div>
  );
}
