import React, { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea, ResponsiveContainer } from 'recharts';
import { WATER_PARAMS } from '../../config/waterQuality';
import './monitoring.css';

export default function ThresholdLineChart({ history }) {
  const [key, setKey] = useState('temperatura');
  const p = WATER_PARAMS.find(x => x.key === key);
  const [lo, hi] = p.thresholds.ideal;

  return (
    <div className="mon-widget">
      <div className="mon-widget-title" style={{ justifyContent: 'space-between' }}>
        <span>Série temporal com faixa saudável</span>
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
      {history.length === 0 ? (
        <div className="mon-empty">Aguardando os primeiros dados…</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="time" tick={{ fill: '#555', fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#555', fontSize: 11 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
            <ReferenceArea y1={lo} y2={hi} fill="#22c55e" fillOpacity={0.10} stroke="#22c55e" strokeOpacity={0.25} strokeDasharray="3 3" />
            <Tooltip labelStyle={{ color: '#8aa0b6' }}
              contentStyle={{ background: '#0D141F', color: '#e6f0fa', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 13 }}
              formatter={v => [`${v?.toFixed(p.decimals)} ${p.unit}`, p.label]} />
            <Area type="monotone" dataKey={key} stroke={p.color} strokeWidth={2} fill={p.color} fillOpacity={0.12} dot={false} connectNulls />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
