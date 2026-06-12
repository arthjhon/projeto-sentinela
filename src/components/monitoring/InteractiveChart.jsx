import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Brush, ResponsiveContainer } from 'recharts';
import { Pause, Play } from 'lucide-react';
import { WATER_PARAMS } from '../../config/waterQuality';
import './monitoring.css';

export default function InteractiveChart({ history, paused, onTogglePause }) {
  const [visible, setVisible] = useState(() => Object.fromEntries(WATER_PARAMS.map(p => [p.key, true])));
  const toggle = k => setVisible(v => ({ ...v, [k]: !v[k] }));

  return (
    <div className="mon-widget">
      <div className="mon-widget-title" style={{ justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {WATER_PARAMS.map(p => (
            <button key={p.key} onClick={() => toggle(p.key)}
              style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                border: `1px solid ${p.color}55`, background: 'transparent', color: visible[p.key] ? p.color : '#475569',
                textDecoration: visible[p.key] ? 'none' : 'line-through' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: visible[p.key] ? p.color : '#475569' }} />
              {p.label}
            </button>
          ))}
        </span>
        <button onClick={onTogglePause} title={paused ? 'Retomar' : 'Pausar'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid rgba(255,255,255,.15)', background: paused ? '#eab30822' : 'transparent', color: paused ? '#eab308' : '#8aa0b6' }}>
          {paused ? <Play size={13} /> : <Pause size={13} />}{paused ? 'Pausado' : 'Ao vivo'}
        </button>
      </div>
      {history.length === 0 ? (
        <div className="mon-empty">Aguardando os primeiros dados…</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="time" tick={{ fill: '#555', fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#555', fontSize: 11 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
            <Tooltip contentStyle={{ background: '#0D141F', color: '#e6f0fa', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#8aa0b6' }} />
            {WATER_PARAMS.filter(p => visible[p.key]).map(p => (
              <Line key={p.key} type="monotone" dataKey={p.key} name={p.label} stroke={p.color}
                strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            ))}
            <Brush dataKey="time" height={22} stroke="#00f0ff" fill="rgba(0,240,255,0.06)" travellerWidth={8} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
