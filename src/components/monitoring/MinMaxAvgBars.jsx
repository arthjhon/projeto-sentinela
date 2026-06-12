import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { WATER_PARAMS, sessionStats } from '../../config/waterQuality';
import './monitoring.css';

export default function MinMaxAvgBars({ history }) {
  const [key, setKey] = useState('temperatura');
  const p = WATER_PARAMS.find(x => x.key === key);
  const stats = sessionStats(history)[key];
  const data = stats ? [
    { label: 'Mín', value: +stats.min.toFixed(p.decimals) },
    { label: 'Média', value: +stats.avg.toFixed(p.decimals) },
    { label: 'Máx', value: +stats.max.toFixed(p.decimals) },
  ] : [];

  // Piso do eixo abaixo do mínimo para a barra "Mín" não ficar com altura zero.
  const span = stats ? (stats.max - stats.min) || Math.max(Math.abs(stats.max) * 0.05, 0.5) : 1;
  const yDomain = stats ? [stats.min - span, stats.max + span * 0.2] : [0, 1];

  return (
    <div className="mon-widget">
      <div className="mon-widget-title" style={{ justifyContent: 'space-between' }}>
        <span>Mín / Média / Máx</span>
        <span style={{ display: 'flex', gap: 6 }}>
          {WATER_PARAMS.map(x => (
            <button key={x.key} onClick={() => setKey(x.key)}
              style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${key === x.key ? x.color : 'rgba(255,255,255,.15)'}`,
                background: key === x.key ? x.color + '22' : 'transparent', color: key === x.key ? x.color : '#8aa0b6' }}>
              {x.label}
            </button>
          ))}
        </span>
      </div>
      {!stats ? <div className="mon-empty">Sem leituras ainda…</div> : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="label" tick={{ fill: '#8aa0b6', fontSize: 12 }} tickLine={false} />
            <YAxis tick={{ fill: '#555', fontSize: 11 }} tickLine={false} axisLine={false} domain={yDomain} allowDecimals />
            <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              contentStyle={{ background: '#0D141F', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }}
              formatter={v => [`${v} ${p.unit}`, p.label]} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]}>
              {data.map((_, i) => <Cell key={i} fill={p.color} fillOpacity={i === 1 ? 1 : 0.5} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
