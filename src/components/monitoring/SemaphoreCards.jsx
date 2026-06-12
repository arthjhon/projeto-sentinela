import React from 'react';
import { WATER_PARAMS, classifyParam } from '../../config/waterQuality';
import './monitoring.css';

export default function SemaphoreCards({ reading }) {
  return (
    <div className="mon-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
      {WATER_PARAMS.map(p => {
        const val = reading?.[p.key];
        const c = classifyParam(p.key, val);
        const color = c?.color ?? '#64748b';
        return (
          <div key={p.key} className="mon-widget" style={{ borderColor: color, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 14, height: 14, borderRadius: '50%', background: color, boxShadow: `0 0 10px ${color}` }} />
            <div>
              <div style={{ fontSize: 12, color: '#8aa0b6' }}>{p.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color }}>
                {val != null ? val.toFixed(p.decimals) : '--'} {p.unit}
              </div>
              <div style={{ fontSize: 12, color }}>{c?.text ?? 'sem dados'}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
