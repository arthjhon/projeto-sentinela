import React, { useState, useEffect, useRef } from 'react';
import { Wifi, WifiOff, Thermometer, Droplet, Activity, MapPin, Share2 } from 'lucide-react';
import { useMqtt } from '../../hooks/useMqtt';
import { FLEET, getMqttTopics } from '../../config/fleet';
import { WATER_PARAMS, classifyParam } from '../../config/waterQuality';
import { useMockMode, getMockMode, makeMockReading, makeMockStatus } from '../../config/mockData';
import InteractiveMap from '../../components/public/InteractiveMap';
import WaterQualityIndex from '../../components/monitoring/WaterQualityIndex';
import ShareableSnapshot from '../../components/monitoring/ShareableSnapshot';
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
    setHistory(prev => [...prev, point].slice(-MAX_HISTORY));
  }, [latestData, paused]);

  const isLive = mockEnabled || (connected && !!BUOY.deviceId);
  const activeArea = BUOY.location.includes('Mundaú') ? 'mundau' : 'manguaba';

  // 5.5 — snapshot compartilhável dos cards principais
  const snapshotRef = useRef(null);
  const [capturing, setCapturing] = useState(false);
  const [shareError, setShareError] = useState(false);

  async function handleShare() {
    const node = snapshotRef.current;
    if (!node || capturing) return;
    setShareError(false);
    setCapturing(true);
    // espera dois frames: o React precisa esconder o botão e mostrar o carimbo
    // ANTES do html2canvas ler o DOM, senão o botão sai na imagem
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      // import dinâmico: a lib (~48 KB gzip) só carrega quando alguém
      // compartilha, não no bundle das outras páginas
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(node, {
        backgroundColor: '#0a1524', // mesma cor do card, caso sobre borda
        scale: 2,                   // 2x para o texto sair nítido
        logging: false,
        useCORS: true,              // deixa o html2canvas carregar a logo (PNG)
        imageTimeout: 8000,
      });
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sentinela_${BUOY.id}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[snapshot] falha ao gerar imagem:', err);
      setShareError(true);
    } finally {
      setCapturing(false);
    }
  }

  const carimboData = new Date().toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

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
        <div className="mon-header-actions">
          <div className={`mqtt-status ${connected ? 'connected' : 'disconnected'}`}>
            {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
            MQTT {connected ? 'Online' : 'Offline'}
          </div>
          <button className="mon-share-btn" onClick={handleShare} disabled={capturing} title="Gerar imagem dos indicadores atuais">
            <Share2 size={15} />
            {capturing ? 'Gerando…' : 'Compartilhar'}
          </button>
        </div>
      </div>

      {shareError && (
        <p className="mon-share-error" role="status">
          Não foi possível gerar a imagem. Tente novamente.
        </p>
      )}

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

      {/* 5.5 — card dedicado ao snapshot: fica fora da tela e é capturado sob
          demanda. Estilo próprio (cores sólidas, sem gradiente/backdrop-filter)
          porque o html2canvas 1.4.1 quebra na função CSS color() que o Chrome
          usa ao serializar os gradientes do glassmorphism. */}
      <ShareableSnapshot
        ref={snapshotRef}
        reading={latestData}
        boia={BUOY}
        fonte={mockEnabled ? 'Dados simulados' : 'Dados ao vivo'}
        quando={carimboData}
      />

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
        <p className="mon-map-desc">Frota do CEMM em coordenadas reais: 1 protótipo ativo (SM-01) + 2 pontos de expansão georreferenciados.</p>
        <InteractiveMap activeArea="comparativo" />
      </div>
    </div>
  );
};

export default MonitoringPage;
