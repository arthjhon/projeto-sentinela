import React, { useState, useEffect, useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import {
  PieChart, Thermometer, Droplet, Activity,
  Wifi, WifiOff, Radio,
} from 'lucide-react';
import { useMqtt } from '../../hooks/useMqtt';
import './AdminDashboard.css';

// Mantém os últimos 120 pontos (≈ 10 min com leituras a cada 5 s)
const MAX_BUFFER = 120;

const PARAMS = {
  temperatura: { label: 'Temperatura (°C)', unit: '°C',  color: '#ef4444' },
  ph:          { label: 'pH',               unit: '',    color: '#00f0ff' },
  turbidez:    { label: 'Turbidez (NTU)',   unit: ' NTU', color: '#f59e0b' },
};

// Tooltip customizado para o gráfico
const ChartTooltip = ({ active, payload, label, unit }) => {
  if (!active || !payload?.length || payload[0].value == null) return null;
  return (
    <div className="chart-tooltip">
      <span className="chart-tooltip-time">{label}</span>
      <span className="chart-tooltip-value">
        {payload[0].value}{unit}
      </span>
    </div>
  );
};

const AdminDashboard = () => {
  const { messages, connected } = useMqtt([
    'esp_sururu/sensores',
    'esp_sururu/status',
  ]);

  // ── Buffer circular de leituras ───────────────────────────────────────────────
  const [buffer, setBuffer]         = useState([]);
  const [activeParam, setActiveParam] = useState('temperatura');

  const sensorMsg = messages['esp_sururu/sensores'];

  useEffect(() => {
    if (!sensorMsg) return;

    const ts = new Date().toLocaleTimeString('pt-BR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    setBuffer(prev => {
      const entry = {
        time:        ts,
        temperatura: sensorMsg.temperatura != null ? +sensorMsg.temperatura.toFixed(2) : null,
        ph:          sensorMsg.ph          != null ? +sensorMsg.ph.toFixed(3)          : null,
        turbidez:    sensorMsg.turbidez    != null ? +sensorMsg.turbidez.toFixed(1)    : null,
      };
      const next = [...prev, entry];
      return next.length > MAX_BUFFER ? next.slice(-MAX_BUFFER) : next;
    });
  }, [sensorMsg]);

  // ── Última leitura + status do hardware ──────────────────────────────────────
  const latest     = buffer.at(-1) ?? {};
  const sm01Online = !!messages['esp_sururu/status'] && connected;

  // ── Estatísticas da sessão (avg / min / max) ──────────────────────────────────
  const stats = useMemo(() => {
    const result = {};
    for (const key of ['temperatura', 'ph', 'turbidez']) {
      const vals = buffer.map(d => d[key]).filter(v => v != null);
      if (!vals.length) { result[key] = null; continue; }
      result[key] = {
        avg:   +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2),
        min:   +Math.min(...vals).toFixed(2),
        max:   +Math.max(...vals).toFixed(2),
        count: vals.length,
      };
    }
    return result;
  }, [buffer]);

  // ── Frota: SM-01 real, SM-02 e MG-01 aguardando hardware ─────────────────────
  const fleetActive = sm01Online ? 1 : 0;
  const fleetTotal  = 3;

  // ── Metric cards (4 cards superiores) ────────────────────────────────────────
  const metricCards = [
    {
      title: 'MQTT Broker',
      value: connected ? 'Online' : 'Offline',
      icon:  connected ? Wifi : WifiOff,
      color: connected ? 'success' : 'danger',
      desc:  connected
        ? `SM-01 ${sm01Online ? 'conectada' : 'sem dados'}`
        : 'Reconectando...',
      style: {
        borderColor: connected ? 'rgba(34,197,94,0.25)'  : 'rgba(239,68,68,0.25)',
        background:  connected ? 'rgba(34,197,94,0.04)'  : 'rgba(239,68,68,0.04)',
      },
    },
    {
      title: 'Temperatura (SM-01)',
      value: latest.temperatura != null ? `${latest.temperatura}°C` : '---',
      icon:  Thermometer,
      color: 'danger',
      desc:  stats.temperatura
        ? `Sessão: ${stats.temperatura.min} – ${stats.temperatura.max} °C`
        : 'Aguardando dados...',
    },
    {
      title: 'pH (SM-01)',
      value: latest.ph != null ? String(latest.ph) : '---',
      icon:  Droplet,
      color: 'primary',
      desc:  stats.ph
        ? `Sessão: ${stats.ph.min} – ${stats.ph.max}`
        : 'Aguardando dados...',
    },
    {
      title: 'Turbidez (SM-01)',
      value: latest.turbidez != null ? `${latest.turbidez} NTU` : '---',
      icon:  Activity,
      color: 'warning',
      desc:  stats.turbidez
        ? `Sessão: ${stats.turbidez.min} – ${stats.turbidez.max} NTU`
        : 'Aguardando dados...',
    },
  ];

  const param = PARAMS[activeParam];

  return (
    <div className="dashboard-content-area">
      <div className="page-header">
        <h1>Centro de Comando | Telemetria em Tempo Real</h1>
        <p>Dados ao vivo via MQTT · Histórico da sessão · Frota de monitoramento</p>
      </div>

      {/* ── Metric Cards ── */}
      <div className="metrics-grid">
        {metricCards.map((m, idx) => (
          <div key={idx} className="metric-card glass" style={m.style}>
            <div className="metric-header">
              <h4>{m.title}</h4>
              <m.icon className={`text-${m.color}`} size={22} />
            </div>
            <div className="metric-value">{m.value}</div>
            <p className="metric-trend" style={{ color: 'var(--text-muted)' }}>{m.desc}</p>
          </div>
        ))}
      </div>

      {/* ── Avg Cards ── */}
      <div className="averages-grid">
        {[
          { name: 'Temperatura Média', key: 'temperatura', unit: '°C',   icon: Thermometer, color: 'var(--danger)'  },
          { name: 'Turbidez Média',    key: 'turbidez',    unit: ' NTU', icon: Activity,    color: 'var(--warning)' },
          { name: 'pH Médio',          key: 'ph',          unit: '',     icon: Droplet,     color: 'var(--primary)' },
        ].map((s, idx) => (
          <div key={idx} className="avg-card glass">
            <div
              className="avg-icon-wrapper"
              style={{
                color: s.color,
                backgroundColor: `color-mix(in srgb, ${s.color} 15%, transparent)`,
              }}
            >
              <s.icon size={28} />
            </div>
            <div className="avg-data">
              <span className="avg-title">{s.name}</span>
              <div className="avg-value-row">
                <span className="avg-value">{stats[s.key]?.avg ?? '---'}</span>
                <span className="avg-unit">{s.unit}</span>
              </div>
              <span className="avg-trend">
                {stats[s.key]
                  ? `${stats[s.key].count} leituras na sessão`
                  : 'Aguardando leituras...'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Charts ── */}
      <div className="charts-grid">

        {/* Gráfico de linha — tempo real */}
        <div className="chart-panel glass">
          <div className="chart-panel-header">
            <div className="chart-title">
              <Radio size={20} className="text-primary" />
              <h3>Histórico da Sessão — Tempo Real</h3>
            </div>
            <span className={`mqtt-badge ${connected ? 'mqtt-online' : 'mqtt-offline'}`}>
              {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
              {connected ? 'MQTT Online' : 'MQTT Offline'}
            </span>
          </div>

          {/* Seletor de parâmetro */}
          <div className="chart-param-tabs">
            {Object.entries(PARAMS).map(([key, cfg]) => (
              <button
                key={key}
                className={`chart-tab ${activeParam === key ? 'active' : ''}`}
                style={activeParam === key ? { borderColor: cfg.color, color: cfg.color } : {}}
                onClick={() => setActiveParam(key)}
              >
                {cfg.label}
              </button>
            ))}
          </div>

          {/* Área do gráfico */}
          <div className="chart-body">
            {buffer.length === 0 ? (
              <div className="chart-empty">
                <Radio size={32} />
                <span>Aguardando dados do broker MQTT...</span>
                <small>Certifique-se que o ESP32 está ligado e conectado.</small>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={buffer} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: '#475569', fontSize: 10 }}
                    axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={['auto', 'auto']}
                    tick={{ fill: '#475569', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={42}
                  />
                  <Tooltip content={<ChartTooltip unit={param.unit} />} />
                  <Line
                    type="monotone"
                    dataKey={activeParam}
                    stroke={param.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: param.color, stroke: 'transparent' }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="chart-footer">
            <span className="chart-footer-stat">
              {buffer.length} leituras · ~{Math.round(buffer.length * 5 / 60)} min
            </span>
            {latest.time && (
              <span className="chart-footer-stat">Última: {latest.time}</span>
            )}
          </div>
        </div>

        {/* Ring chart — frota */}
        <div className="chart-panel glass fleet-panel">
          <div className="chart-panel-header">
            <div className="chart-title">
              <PieChart size={20} className="text-success" />
              <h3>Status da Frota</h3>
            </div>
            <span className="badge">Total: {fleetTotal} bóias</span>
          </div>

          <div className="fleet-stats-container">
            <div className="fleet-ring-chart">
              <svg viewBox="0 0 36 36" className="circular-chart">
                <path
                  className="circle-bg"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className="circle active-stroke"
                  strokeDasharray={`${(fleetActive / fleetTotal) * 100}, 100`}
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <text x="18" y="16" className="percentage">
                  {Math.round((fleetActive / fleetTotal) * 100)}%
                </text>
                <text x="18" y="22" className="percentage-sub">Online</text>
              </svg>
            </div>

            <div className="fleet-legends">
              <div className="legend-item">
                <span className="legend-color bg-success" />
                <span>Online / Operando</span>
                <span className="legend-val">{fleetActive}</span>
              </div>
              <div className="legend-item">
                <span className="legend-color" style={{ background: '#475569' }} />
                <span>Sem Hardware</span>
                <span className="legend-val">{fleetTotal - fleetActive}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Alertas ── */}
      <div className="recent-alerts view-panel glass">
        <h3>Últimos Alertas Reportados</h3>
        <ul className="alert-list">
          <li className="alert-item warning-item">
            <span className="alert-time">Hoje, 08:30</span>
            <span className="alert-msg">
              Baixo nível de OD (3.1 mg/L) detectado no Sensor B-04 (Mundaú)
            </span>
          </li>
          <li className="alert-item error-item">
            <span className="alert-time">Ontem, 22:15</span>
            <span className="alert-msg">
              Falha de comunicação no Sensor M-02 (Manguaba).{' '}
              <b>Equipe de manutenção acionada.</b>
            </span>
          </li>
          <li className="alert-item success-item">
            <span className="alert-time">12 Jun, 14:00</span>
            <span className="alert-msg">
              Retorno à operação da Bóia SM-08 após calibração preventiva.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
};

export default AdminDashboard;
