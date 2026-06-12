import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { WATER_PARAMS, histogramBins } from '../../config/waterQuality';
import './monitoring.css';

export default function Histogram({ history }) {
  const [key, setKey] = useState('temperatura');
  const p = WATER_PARAMS.find(x => x.key === key);
  const bins = histogramBins(history, key, 8);

  return (
    <div className="mon-widget">
      <div className="mon-widget-title" style={{ justifyContent: 'space-between' }}>
        <span>Distribuição das leituras</span>
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
      {bins.length === 0 ? <div className="mon-empty">Sem leituras ainda…</div> : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={bins} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="label" tick={{ fill: '#555', fontSize: 10 }} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: '#555', fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              contentStyle={{ background: '#0D141F', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }}
              formatter={v => [`${v} leituras`, `≈ ${p.label}`]} />
            <Bar dataKey="count" fill={p.color} fillOpacity={0.7} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
