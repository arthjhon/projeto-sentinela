import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Circle, CircleMarker, Popup, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useMqtt } from '../../hooks/useMqtt';
import {
  Thermometer, Droplet, Activity,
  Play, Pause, SkipBack,
  Wifi, WifiOff, Layers,
} from 'lucide-react';
import './InteractiveMap.css';

// ─── Configuração das bóias (coords reais do CEMM) ────────────────────────────
const BUOYS_CONFIG = [
  {
    id: 'SM-01',
    name: 'Bóia Mundaú Centro',
    coords: [-9.6559, -35.7701],
    lagoon: 'mundau',
    mqttDevice: 'esp_sururu', // única bóia com hardware real por enquanto
  },
  {
    id: 'SM-02',
    name: 'Bóia Mundaú Sul',
    coords: [-9.6862, -35.7847],
    lagoon: 'mundau',
  },
  {
    id: 'MG-01',
    name: 'Bóia Manguaba Norte',
    coords: [-9.5873, -35.8394],
    lagoon: 'manguaba',
  },
];

const PARAMS = [
  { key: 'ph',          label: 'pH',         icon: Droplet,    unit: '' },
  { key: 'temperatura', label: 'Temperatura', icon: Thermometer, unit: '°C' },
  { key: 'turbidez',    label: 'Turbidez',   icon: Activity,   unit: 'NTU' },
];

// ─── Gerador de histórico mock (7 dias × intervalo de 30 min = 336 snapshots) ─
function buildHistory() {
  const now = Date.now();
  const INTERVAL = 30 * 60 * 1000;
  const TOTAL    = 7 * 24 * 2; // 336
  const snapshots = [];

  for (let i = TOTAL; i >= 0; i--) {
    const snapshot = { timestamp: now - i * INTERVAL, buoys: {} };

    BUOYS_CONFIG.forEach((b, bIdx) => {
      const phase = bIdx * 0.4;
      // padrão sinusoidal + ruído para simular variações naturais
      snapshot.buoys[b.id] = {
        temperatura: +(27 + Math.sin((i + phase * 10) * 0.15) * 2.5 + (Math.random() - 0.5) * 0.4).toFixed(1),
        ph:          +(7.4 + Math.sin((i + phase * 8)  * 0.08) * 0.7 + (Math.random() - 0.5) * 0.2).toFixed(2),
        turbidez:    +(15  + Math.sin((i + phase * 12) * 0.12) * 10  + Math.abs((Math.random() - 0.3) * 4)).toFixed(1),
        status:      'online',
      };
    });
    snapshots.push(snapshot);
  }
  return snapshots;
}

// Calculado uma vez fora do componente para não regenerar a cada render
const HISTORY = buildHistory();

// ─── Helpers de qualidade ──────────────────────────────────────────────────────
function qualityColor(param, value) {
  if (value == null) return '#475569';
  if (param === 'ph') {
    if (value >= 7.0 && value <= 8.0) return '#22c55e';
    if (value >= 6.5 && value <= 8.5) return '#eab308';
    return '#ef4444';
  }
  if (param === 'temperatura') {
    if (value >= 22 && value <= 28) return '#22c55e';
    if (value >= 18 && value <= 32) return '#eab308';
    return '#ef4444';
  }
  if (param === 'turbidez') {
    if (value <= 30)  return '#22c55e';
    if (value <= 100) return '#eab308';
    return '#ef4444';
  }
  return '#475569';
}

function statusColor(status) {
  if (status === 'online')  return '#22c55e';
  if (status === 'warning') return '#eab308';
  return '#ef4444';
}

function fmtTimestamp(ts) {
  return new Date(ts).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── Componente principal ──────────────────────────────────────────────────────
const InteractiveMap = ({ activeArea = 'mundau' }) => {
  const [selectedParam, setSelectedParam] = useState('ph');
  const [showHeatmap, setShowHeatmap]     = useState(true);
  const [sliderIdx, setSliderIdx]         = useState(HISTORY.length - 1);
  const [isPlaying, setIsPlaying]         = useState(false);
  const [liveMode, setLiveMode]           = useState(true);
  const playIntervalRef = useRef(null);

  // MQTT: dados ao vivo da bóia SM-01 via HiveMQ Cloud
  const { messages, connected } = useMqtt(['esp_sururu/sensores', 'esp_sururu/status']);

  // ── Dados "atuais" (live MQTT ou snapshot histórico) ──────────────────────
  const currentData = useMemo(() => {
    const snapshot = HISTORY[sliderIdx];
    const data = {};

    BUOYS_CONFIG.forEach(b => {
      data[b.id] = { ...snapshot.buoys[b.id] };

      // sobrescreve SM-01 com dado real do MQTT quando em modo ao vivo
      if (liveMode && b.mqttDevice) {
        const live = messages[`${b.mqttDevice}/sensores`];
        if (live) {
          data[b.id] = {
            ...data[b.id],
            temperatura: live.temperatura,
            ph:          live.ph,
            turbidez:    live.turbidez,
            status:      'online',
          };
        }
      }
    });
    return data;
  }, [sliderIdx, liveMode, messages]);

  // ── Controle de playback do time slider ───────────────────────────────────
  useEffect(() => {
    if (isPlaying) {
      playIntervalRef.current = setInterval(() => {
        setSliderIdx(prev => {
          if (prev >= HISTORY.length - 1) {
            setIsPlaying(false);
            setLiveMode(true);
            return HISTORY.length - 1;
          }
          return prev + 1;
        });
      }, 80);
    } else {
      clearInterval(playIntervalRef.current);
    }
    return () => clearInterval(playIntervalRef.current);
  }, [isPlaying]);

  const handleSlider = useCallback((e) => {
    const idx = Number(e.target.value);
    setSliderIdx(idx);
    setLiveMode(idx === HISTORY.length - 1);
    setIsPlaying(false);
  }, []);

  const handlePlay = useCallback(() => {
    if (sliderIdx >= HISTORY.length - 1) {
      setSliderIdx(0);
      setLiveMode(false);
    }
    setIsPlaying(true);
  }, [sliderIdx]);

  const handleReset = useCallback(() => {
    clearInterval(playIntervalRef.current);
    setSliderIdx(HISTORY.length - 1);
    setLiveMode(true);
    setIsPlaying(false);
  }, []);

  const visibleBuoys = activeArea === 'comparativo'
    ? BUOYS_CONFIG
    : BUOYS_CONFIG.filter(b => b.lagoon === activeArea);

  const currentTs = HISTORY[sliderIdx]?.timestamp;

  return (
    <div className="imap-wrapper">

      {/* ── Barra de controles ── */}
      <div className="imap-controls">
        <div className="imap-param-selector">
          {PARAMS.map(p => (
            <button
              key={p.key}
              className={`imap-param-btn ${selectedParam === p.key ? 'active' : ''}`}
              onClick={() => setSelectedParam(p.key)}
            >
              <p.icon size={13} />
              {p.label}
            </button>
          ))}
        </div>

        <div className="imap-toggles">
          <button
            className={`imap-toggle-btn ${showHeatmap ? 'active' : ''}`}
            onClick={() => setShowHeatmap(v => !v)}
            title="Alternar heatmap de qualidade"
          >
            <Layers size={14} />
            Heatmap
          </button>

          <span className={`imap-mqtt-badge ${connected ? 'online' : 'offline'}`}>
            {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
            {connected ? 'Ao vivo' : 'Offline'}
          </span>
        </div>
      </div>

      {/* ── Mapa Leaflet ── */}
      <div className="imap-container-outer">
        <MapContainer
          center={[-9.630, -35.800]}
          zoom={12}
          className="imap-leaflet"
          zoomControl
          scrollWheelZoom={false}
          attributionControl={false}
        >
          {/* Tiles CartoDB Dark Matter — sem API key */}
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            subdomains="abcd"
            maxZoom={19}
            attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
          />

          {visibleBuoys.map(buoy => {
            const d          = currentData[buoy.id];
            const paramVal   = d?.[selectedParam];
            const heatColor  = qualityColor(selectedParam, paramVal);
            const dotColor   = statusColor(d?.status ?? 'online');
            const isLive     = liveMode && !!buoy.mqttDevice && connected;
            const param      = PARAMS.find(p => p.key === selectedParam);

            return (
              <React.Fragment key={buoy.id}>

                {/* Heatmap: 3 círculos concêntricos com gradiente de opacidade */}
                {showHeatmap && (
                  <>
                    <Circle
                      center={buoy.coords}
                      radius={1000}
                      pathOptions={{ color: 'none', fillColor: heatColor, fillOpacity: 0.05 }}
                    />
                    <Circle
                      center={buoy.coords}
                      radius={550}
                      pathOptions={{ color: 'none', fillColor: heatColor, fillOpacity: 0.10 }}
                    />
                    <Circle
                      center={buoy.coords}
                      radius={220}
                      pathOptions={{ color: 'none', fillColor: heatColor, fillOpacity: 0.20 }}
                    />
                  </>
                )}

                {/* Anel pulsante para bóias ao vivo */}
                {isLive && (
                  <CircleMarker
                    center={buoy.coords}
                    radius={18}
                    pathOptions={{
                      color: dotColor,
                      fillColor: 'none',
                      fillOpacity: 0,
                      weight: 1.5,
                      opacity: 0.4,
                      className: 'imap-pulse-ring',
                    }}
                  />
                )}

                {/* Marcador principal da bóia */}
                <CircleMarker
                  center={buoy.coords}
                  radius={9}
                  pathOptions={{
                    color: '#0B111A',
                    fillColor: dotColor,
                    fillOpacity: 1,
                    weight: 2,
                  }}
                >
                  {/* Tooltip hover */}
                  <Tooltip direction="top" offset={[0, -14]}>
                    <div className="imap-tooltip">
                      <div className="imap-tooltip-title">
                        <span className="imap-tooltip-id">{buoy.id}</span>
                        {buoy.name}
                        {isLive && <span className="imap-live-dot" />}
                      </div>
                      <div className="imap-tooltip-readings">
                        <span><Thermometer size={12} /> {d?.temperatura ?? '--'} °C</span>
                        <span><Droplet size={12} /> pH {d?.ph ?? '--'}</span>
                        <span><Activity size={12} /> {d?.turbidez ?? '--'} NTU</span>
                      </div>
                    </div>
                  </Tooltip>

                  {/* Popup click (mais detalhado) */}
                  <Popup className="imap-popup">
                    <div className="imap-popup-content">
                      <div className="imap-popup-header">
                        <strong>{buoy.id}</strong>
                        <span
                          className="imap-popup-status"
                          style={{ color: dotColor }}
                        >
                          ● {d?.status ?? 'online'}
                        </span>
                      </div>
                      <p className="imap-popup-name">{buoy.name}</p>
                      <table className="imap-popup-table">
                        <tbody>
                          <tr>
                            <td><Thermometer size={13} /> Temperatura</td>
                            <td style={{ color: qualityColor('temperatura', d?.temperatura) }}>
                              {d?.temperatura ?? '--'} °C
                            </td>
                          </tr>
                          <tr>
                            <td><Droplet size={13} /> pH</td>
                            <td style={{ color: qualityColor('ph', d?.ph) }}>
                              {d?.ph ?? '--'}
                            </td>
                          </tr>
                          <tr>
                            <td><Activity size={13} /> Turbidez</td>
                            <td style={{ color: qualityColor('turbidez', d?.turbidez) }}>
                              {d?.turbidez ?? '--'} NTU
                            </td>
                          </tr>
                        </tbody>
                      </table>
                      <div className="imap-popup-source">
                        {isLive ? '🔴 Dados em tempo real (MQTT)' : `📅 ${fmtTimestamp(currentTs)}`}
                      </div>
                    </div>
                  </Popup>
                </CircleMarker>

                {/* Label fixa com ID da bóia */}
                <Tooltip
                  direction="bottom"
                  offset={[0, 12]}
                  permanent
                  className="imap-buoy-label"
                >
                  {buoy.id}
                </Tooltip>

              </React.Fragment>
            );
          })}
        </MapContainer>

        {/* Legenda de qualidade */}
        <div className="imap-legend">
          <span className="imap-legend-title">Qualidade da Água</span>
          <div className="imap-legend-items">
            <span><span className="imap-legend-dot" style={{ background: '#22c55e' }} /> Ótima</span>
            <span><span className="imap-legend-dot" style={{ background: '#eab308' }} /> Atenção</span>
            <span><span className="imap-legend-dot" style={{ background: '#ef4444' }} /> Crítica</span>
            <span><span className="imap-legend-dot" style={{ background: '#475569' }} /> Sem dados</span>
          </div>
        </div>
      </div>

      {/* ── Time Slider ── */}
      <div className="imap-slider-section">
        <div className="imap-slider-header">
          <div className="imap-slider-timestamp">
            {liveMode ? (
              <><span className="imap-live-badge">AO VIVO</span> Dados em tempo real</>
            ) : (
              <><span className="imap-hist-badge">HISTÓRICO</span> {fmtTimestamp(currentTs)}</>
            )}
          </div>

          <div className="imap-slider-controls">
            <button
              className="imap-ctrl-btn"
              onClick={handleReset}
              title="Voltar para agora"
            >
              <SkipBack size={15} />
            </button>
            {isPlaying ? (
              <button className="imap-ctrl-btn active" onClick={() => setIsPlaying(false)}>
                <Pause size={15} />
              </button>
            ) : (
              <button className="imap-ctrl-btn" onClick={handlePlay} title="Animar histórico">
                <Play size={15} />
              </button>
            )}
          </div>
        </div>

        <input
          type="range"
          min={0}
          max={HISTORY.length - 1}
          value={sliderIdx}
          onChange={handleSlider}
          className="imap-range"
        />

        <div className="imap-slider-dates">
          <span>{fmtTimestamp(HISTORY[0].timestamp)}</span>
          <span>Agora</span>
        </div>
      </div>

    </div>
  );
};

export default InteractiveMap;
