import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, Thermometer, Droplet, Activity, MapPin } from 'lucide-react';
import { useMqtt } from '../../hooks/useMqtt';
import { FLEET, getMqttTopics } from '../../config/fleet';
import { WATER_PARAMS, classifyParam } from '../../config/waterQuality';
import { useMockMode, getMockMode, makeMockReading, makeMockStatus } from '../../config/mockData';
import InteractiveMap from '../../components/public/InteractiveMap';
import WaterQualityIndex from '../../components/monitoring/WaterQualityIndex';
import SemaphoreCards from '../../components/monitoring/SemaphoreCards';
import ThresholdLineChart from '../../components/monitoring/ThresholdLineChart';
import InteractiveChart from '../../components/monitoring/InteractiveChart';
import DeviceHealth from '../../components/monitoring/DeviceHealth';
import MinMaxAvgBars from '../../components/monitoring/MinMaxAvgBars';
import Histogram from '../../components/monitoring/Histogram';
import './MonitoringPage.css';

const ICONS = { temperatura: Thermometer, ph: Droplet, turbidez: Activity };
const MAX_HISTORY = 120;
const BUOY = FLEET.find(b => b.deviceId) || FLEET[0];

const MonitoringPage = () => {
  const [history, setHistory] = useState([]);
  const [paused, setPaused] = useState(false);
  const [mockEnabled] = useMockMode();
  // Seed inicial imediato quando o mock já está ligado no carregamento.
  const [mockData, setMockData] = useState(() => (getMockMode() ? makeMockReading(null) : null));
  const [mockStatus, setMockStatus] = useState(() => (getMockMode() ? makeMockStatus(2 * 86400) : null));

  const { messages, connected } = useMqtt(getMqttTopics(['sensores', 'status']));
  const sensorTopic = BUOY.deviceId ? `${BUOY.deviceId}/sensores` : null;
  const statusTopic = BUOY.deviceId ? `${BUOY.deviceId}/status` : null;
  const mqttData = sensorTopic ? messages[sensorTopic] : null;
  const mqttStatus = statusTopic ? messages[statusTopic] : null;

  // Atualiza os dados simulados a cada 3s (setState só no callback do timer).
  useEffect(() => {
    if (!mockEnabled) return undefined;
    let prev = makeMockReading(null);
    let uptime = 2 * 86400;
    const id = setInterval(() => {
      prev = makeMockReading(prev);
      uptime += 3;
      setMockData(prev);
      setMockStatus(makeMockStatus(uptime));
    }, 3000);
    return () => clearInterval(id);
  }, [mockEnabled]);

  // Fonte efetiva: mock quando ligado, senão MQTT real.
  const latestData = mockEnabled ? mockData : mqttData;
  const latestStatus = mockEnabled ? mockStatus : mqttStatus;

  // Limpa o histórico ao alternar a fonte (remove os dados simulados).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory([]);
  }, [mockEnabled]);

  useEffect(() => {
    if (!latestData || paused) return;
    const point = {
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      temperatura: latestData.temperatura ?? null,
      ph: latestData.ph ?? null,
      turbidez: latestData.turbidez ?? null,
    };
    // Acumula histórico a cada nova leitura (stream append-only).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory(prev => [...prev, point].slice(-MAX_HISTORY));
  }, [latestData, paused]);

  const isLive = mockEnabled || (connected && !!BUOY.deviceId);
  const activeArea = BUOY.location.includes('Mundaú') ? 'mundau' : 'manguaba';

  return (
    <div className="monitoring-page">
      {/* Header */}
      <div className="mon-header">
        <div className="mon-title-group">
          <div className={`live-badge ${isLive ? 'live' : 'offline'}`}>
            <span className="live-dot" />
            {mockEnabled ? 'SIMULADO' : isLive ? 'AO VIVO' : BUOY.deviceId ? 'SEM SINAL' : 'SEM HARDWARE'}
          </div>
          <h1 className="mon-title">Monitoramento Estuarino</h1>
          <p className="mon-subtitle">{BUOY.id} · {BUOY.name} — {BUOY.location}</p>
        </div>
        <div className={`mqtt-status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
          MQTT {connected ? 'Online' : 'Offline'}
        </div>
      </div>

      {/* KPIs + Velocímetro */}
      <div className="mon-top-grid">
        <div className="metric-grid">
          {WATER_PARAMS.map(param => {
            const Icon = ICONS[param.key];
            const val = latestData?.[param.key];
            const c = classifyParam(param.key, val);
            return (
              <div key={param.key} className="metric-card glass" style={{ '--c': param.color }}>
                <div className="metric-card-top">
                  <Icon size={18} style={{ color: param.color }} />
                  <span className="metric-label">{param.label}</span>
                </div>
                <div className="metric-value" style={{ color: param.color }}>
                  {val != null ? val.toFixed(param.decimals) : '--'}
                  {param.unit && <span className="metric-unit">{param.unit}</span>}
                </div>
                <span className="metric-hint">
                  {c ? c.text : (!BUOY.deviceId ? 'sem hardware' : !connected ? 'sem sinal' : 'aguardando…')}
                </span>
              </div>
            );
          })}
        </div>
        <WaterQualityIndex reading={latestData} />
      </div>

      <SemaphoreCards reading={latestData} />
      <InteractiveChart history={history} paused={paused} onTogglePause={() => setPaused(p => !p)} />
      <ThresholdLineChart history={history} />
      <div className="mon-two-col">
        <MinMaxAvgBars history={history} />
        <Histogram history={history} />
      </div>
      <DeviceHealth status={latestStatus} battery={BUOY.battery} />

      {/* Mapa */}
      <div className="mon-map-section glass">
        <div className="mon-map-header">
          <MapPin size={18} color="var(--primary)" />
          <h3>Digital Twin — Mapa de Telemetria</h3>
        </div>
        <p className="mon-map-desc">Bóia {BUOY.id} plotada em coordenadas reais do CEMM.</p>
        <InteractiveMap activeArea={activeArea} />
      </div>
    </div>
  );
};

export default MonitoringPage;
