import React from 'react';
import { RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts';
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

  return (
    <div className="mon-widget">
      <div className="mon-widget-title">Saúde do dispositivo</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ textAlign: 'center' }}>
          <RadialBarChart width={120} height={120} cx={60} cy={60} innerRadius={42} outerRadius={56}
            startAngle={90} endAngle={-270} data={[{ value: bat, fill: batColor }]}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar background={{ fill: 'rgba(255,255,255,0.06)' }} dataKey="value" cornerRadius={8} />
          </RadialBarChart>
          <div style={{ marginTop: -74, fontSize: 20, fontWeight: 800, color: batColor }}>{bat}%</div>
          <div style={{ marginTop: 40, fontSize: 11, color: '#8aa0b6' }}>Bateria</div>
        </div>
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
