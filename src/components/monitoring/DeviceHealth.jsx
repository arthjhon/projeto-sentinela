import React from 'react';
import { Wifi, Clock, Cpu, Timer, BatteryCharging } from 'lucide-react';
import './monitoring.css';

function fmtUptime(s) {
  if (s == null) return '--';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function DeviceHealth({ status, battery }) {
  const stats = [
    { icon: Wifi, label: 'Sinal RSSI', value: status?.rssi != null ? `${status.rssi.toFixed(0)} dBm` : '--' },
    { icon: Cpu, label: 'Memória livre', value: status?.free_heap != null ? `${(status.free_heap / 1024).toFixed(0)} KB` : '--' },
    { icon: Clock, label: 'Uptime', value: fmtUptime(status?.uptime) },
    { icon: Timer, label: 'Latência MQTT', value: status?.mqtt_latency != null ? `${status.mqtt_latency} ms` : '--' },
    { icon: BatteryCharging, label: 'Firmware', value: status?.firmware ?? '--' },
  ];
  const bat = battery ?? 0;
  const batColor = bat > 50 ? '#22c55e' : bat > 20 ? '#eab308' : '#ef4444';

  // Anel SVG (donut) determinístico para a bateria.
  const R = 42, C = 2 * Math.PI * R;
  const filled = (bat / 100) * C;

  return (
    <div className="mon-widget">
      <div className="mon-widget-title">Saúde do dispositivo</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <svg width="120" height="120" viewBox="0 0 120 120" style={{ flexShrink: 0 }}>
          <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
          <circle cx="60" cy="60" r={R} fill="none" stroke={batColor} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={`${filled} ${C}`} transform="rotate(-90 60 60)" />
          <text x="60" y="58" textAnchor="middle" fontSize="22" fontWeight="800" fill={batColor}>{bat}%</text>
          <text x="60" y="78" textAnchor="middle" fontSize="11" fill="#8aa0b6">Bateria</text>
        </svg>
        <div className="mon-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(120px,1fr))', flex: 1 }}>
          {stats.map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <s.icon size={16} color="#00f0ff" />
              <div>
                <div style={{ fontSize: 11, color: '#8aa0b6' }}>{s.label}</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#dce7f2' }}>{s.value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
