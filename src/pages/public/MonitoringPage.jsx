import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, Thermometer, Droplet, Activity, Radio, MapPin } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { useMqtt } from '../../hooks/useMqtt';
import { FLEET, getMqttTopics } from '../../config/fleet';
import InteractiveMap from '../../components/public/InteractiveMap';
import './MonitoringPage.css';

const PARAMS = [
  { key: 'temperatura', label: 'Temperatura', unit: '°C',  decimals: 1, icon: Thermometer, color: '#ff7043' },
  { key: 'ph',          label: 'pH',          unit: '',    decimals: 2, icon: Droplet,     color: '#00f0ff' },
  { key: 'turbidez',    label: 'Turbidez',    unit: 'NTU', decimals: 1, icon: Activity,    color: '#b388ff' },
];

const BUOYS = FLEET.map(b => ({
  id: b.id,
  name: b.name,
  deviceId: b.deviceId,
  location: b.location,
}));

const MAX_HISTORY = 30;

const MonitoringPage = () => {
  const [selectedBuoy, setSelectedBuoy] = useState(BUOYS[0]);
  const [chartParam, setChartParam]     = useState('temperatura');
  const [history, setHistory]           = useState([]);

  const { messages, connected } = useMqtt(getMqttTopics(['sensores', 'status']));

  const sensorTopic = selectedBuoy.deviceId ? `${selectedBuoy.deviceId}/sensores` : null;
  const latestData  = sensorTopic ? messages[sensorTopic] : null;

  useEffect(() => {
    if (!latestData) return;
    const point = {
      time:        new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      temperatura: latestData.temperatura ?? null,
      ph:          latestData.ph          ?? null,
      turbidez:    latestData.turbidez    ?? null,
    };
    setHistory(prev => [...prev, point].slice(-MAX_HISTORY));
  }, [latestData]);

  useEffect(() => { setHistory([]); }, [selectedBuoy.id]);

  const isLive        = connected && !!selectedBuoy.deviceId;
  const activeParam   = PARAMS.find(p => p.key === chartParam);
  const activeArea    = selectedBuoy.location.includes('Mundaú') ? 'mundau' : 'manguaba';

  return (
    <div className="monitoring-page">

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="mon-header">
        <div className="mon-title-group">
          <div className={`live-badge ${isLive ? 'live' : 'offline'}`}>
            <span className="live-dot" />
            {isLive ? 'AO VIVO' : selectedBuoy.deviceId ? 'SEM SINAL' : 'SEM HARDWARE'}
          </div>
          <h1 className="mon-title">Monitoramento Estuarino</h1>
          <p className="mon-subtitle">CEMM — Complexo Estuarino Mundaú-Manguaba, Alagoas</p>
        </div>
        <div className={`mqtt-status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
          MQTT {connected ? 'Online' : 'Offline'}
        </div>
      </div>

      {/* ── Seletor de bóias ─────────────────────────────────── */}
      <div className="buoy-selector">
        {BUOYS.map(b => {
          const hasHw    = !!b.deviceId;
          const isOnline = hasHw && connected;
          return (
            <button
              key={b.id}
              className={`buoy-tab ${selectedBuoy.id === b.id ? 'active' : ''}`}
              onClick={() => setSelectedBuoy(b)}
            >
              <span className={`buoy-dot ${isOnline ? 'online' : hasHw ? 'warning' : 'no-hw'}`} />
              <span className="buoy-tab-id">{b.id}</span>
              <span className="buoy-tab-name">{b.name}</span>
            </button>
          );
        })}
      </div>

      {/* ── Cards de métricas ────────────────────────────────── */}
      <div className="metric-grid">
        {PARAMS.map(param => {
          const val = latestData?.[param.key];
          return (
            <div key={param.key} className="metric-card glass" style={{ '--c': param.color }}>
              <div className="metric-card-top">
                <param.icon size={18} style={{ color: param.color }} />
                <span className="metric-label">{param.label}</span>
              </div>
              <div className="metric-value" style={{ color: param.color }}>
                {val != null ? val.toFixed(param.decimals) : '--'}
                {param.unit && <span className="metric-unit">{param.unit}</span>}
              </div>
              <span className="metric-hint">
                {!selectedBuoy.deviceId  ? 'hardware não implantado'  :
                 !connected              ? 'sem sinal MQTT'           :
                 val == null             ? 'aguardando leitura…'      : 'última leitura ao vivo'}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Gráfico ──────────────────────────────────────────── */}
      <div className="chart-card glass">
        <div className="chart-card-header">
          <span className="chart-card-title">
            Série Histórica
            <span className="chart-count">{history.length}/{MAX_HISTORY} leituras</span>
          </span>
          <div className="chart-param-tabs">
            {PARAMS.map(p => (
              <button
                key={p.key}
                className={`chart-tab ${chartParam === p.key ? 'active' : ''}`}
                style={{ '--c': p.color }}
                onClick={() => setChartParam(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {history.length === 0 ? (
          <div className="chart-empty">
            <Radio size={36} className="chart-empty-icon" />
            <p>{!selectedBuoy.deviceId
              ? 'Esta bóia ainda não possui hardware implantado.'
              : 'Aguardando os primeiros dados do sensor…'}</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={activeParam.color} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={activeParam.color} stopOpacity={0}    />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="time"
                tick={{ fill: '#555', fontSize: 11 }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fill: '#555', fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: '#0D141F', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 13 }}
                labelStyle={{ color: '#888' }}
                itemStyle={{ color: activeParam.color }}
                formatter={v => [`${v?.toFixed(activeParam.decimals)} ${activeParam.unit}`, activeParam.label]}
              />
              <Area
                type="monotone"
                dataKey={chartParam}
                stroke={activeParam.color}
                strokeWidth={2}
                fill="url(#chartGrad)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Mapa ─────────────────────────────────────────────── */}
      <div className="mon-map-section glass">
        <div className="mon-map-header">
          <MapPin size={18} color="var(--primary)" />
          <h3>Digital Twin — Mapa de Telemetria</h3>
        </div>
        <p className="mon-map-desc">
          Bóias plotadas em coordenadas reais do CEMM. Selecione uma área na barra acima para filtrar o mapa.
        </p>
        <InteractiveMap activeArea={activeArea} />
      </div>

    </div>
  );
};

export default MonitoringPage;
