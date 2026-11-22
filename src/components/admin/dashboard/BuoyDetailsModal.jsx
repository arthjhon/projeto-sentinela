import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapContainer, TileLayer, CircleMarker, AttributionControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { X } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { listarManutencoes, ultimasCalibracoes, manutencaoAberta } from '../../../services/maintenance';
import { ultimoDeploy } from '../../../services/otaCommand';
import { formatUptime, formatMemoria, formatRssi, escolherFirmware } from '../../../utils/buoyDetails';
import './BuoyDetailsModal.css';

// Mesmo basemap do mapa público (InteractiveMap): Carto com key, senão Esri.
const CARTO_KEY = import.meta.env.VITE_CARTO_BASEMAPS_KEY;
const TILES = CARTO_KEY
  ? {
      url: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`,
      subdomains: 'abcd',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }
  : {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      attribution: '&copy; <a href="https://www.esri.com">Esri</a>',
      className: 'bdm-tiles-fallback',
    };

const SEM_LEITURA = 'sem leitura desde que o painel abriu';
const NAO_MEDIDO = ['Bateria', 'Temperatura interna', 'GPS', 'Sinal de gateway'];
const SENSOR_LABEL = { temperatura: 'Temperatura', ph: 'pH', turbidez: 'Turbidez' };

const fmtData = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const Row = ({ label, children }) => (
  <div className="bdm-row">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);

const Muted = ({ children }) => <span className="bdm-muted">{children}</span>;

export default function BuoyDetailsModal({ buoy, statusMsg, onClose }) {
  const titleRef = useRef(null);
  const dialogRef = useRef(null);
  const [dados, setDados] = useState({ codigo: null, error: null, manutencoes: [], aberta: null, calibracoes: [], deploy: null });
  // carregando = os dados guardados ainda são de outra bóia
  const extra = { ...dados, loading: dados.codigo !== buoy.codigo };

  // foco no título ao abrir; devolve ao elemento anterior ao fechar
  useEffect(() => {
    const anterior = document.activeElement;
    titleRef.current?.focus();
    return () => { if (anterior && typeof anterior.focus === 'function') anterior.focus(); };
  }, []);

  // Esc fecha; Tab fica dentro do diálogo
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focaveis = dialogRef.current.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])');
      if (!focaveis.length) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelado = false;
    Promise.all([
      listarManutencoes(buoy.codigo),
      manutencaoAberta(buoy.codigo),
      ultimasCalibracoes(buoy.codigo),
      ultimoDeploy(supabase, buoy.codigo),
    ]).then(([manutencoes, aberta, calibs, deploy]) => {
      if (cancelado) return;
      const calibracoes = Object.values(calibs).sort((a, b) => new Date(b.calibrated_at) - new Date(a.calibrated_at)).slice(0, 3);
      setDados({ codigo: buoy.codigo, error: null, manutencoes: manutencoes.slice(0, 3), aberta, calibracoes, deploy });
    }).catch((err) => {
      if (!cancelado) setDados({ codigo: buoy.codigo, error: err.message, manutencoes: [], aberta: null, calibracoes: [], deploy: null });
    });
    return () => { cancelado = true; };
  }, [buoy.codigo]);

  const temCoord = Number.isFinite(buoy.lat) && Number.isFinite(buoy.lng);
  const fw = escolherFirmware(statusMsg, extra.deploy);
  const rssi = formatRssi(statusMsg?.rssi);
  const memoria = formatMemoria(statusMsg?.free_heap, statusMsg?.total_heap);
  const uptime = formatUptime(statusMsg?.uptime);
  const latencia = Number.isFinite(statusMsg?.mqtt_latency) ? `${Math.round(statusMsg.mqtt_latency)} ms` : null;
  const anteriores = buoy.deviceIdsAnteriores ?? [];
  const modoTxt = extra.aberta ? 'Manutenção' : buoy.modo === 'bancada' ? 'Bancada' : 'Operação';

  const ausente = <Muted>{SEM_LEITURA}</Muted>;

  return createPortal(
    <div className="bdm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="bdm" role="dialog" aria-modal="true" aria-labelledby="bdm-title" ref={dialogRef}>
        <header className="bdm-head">
          <div>
            <h2 id="bdm-title" tabIndex={-1} ref={titleRef}>Detalhes da bóia</h2>
            <p className="bdm-sub">{buoy.nome} <span className="bdm-code">{buoy.codigo}</span></p>
          </div>
          <button type="button" className="bdm-close" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        </header>

        <div className="bdm-body">
          <section className="bdm-sec">
            <h3>Localização</h3>
            {temCoord ? (
              <>
                <div className="bdm-map">
                  <MapContainer center={[buoy.lat, buoy.lng]} zoom={14} attributionControl={false} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
                    <TileLayer {...TILES} />
                    <AttributionControl position="bottomright" prefix={false} />
                    <CircleMarker center={[buoy.lat, buoy.lng]} radius={9} pathOptions={{ color: '#00f0ff', fillColor: '#00f0ff', fillOpacity: 0.6 }} />
                  </MapContainer>
                </div>
                <p className="bdm-coord">{buoy.lat.toFixed(5)}, {buoy.lng.toFixed(5)}</p>
              </>
            ) : <p><Muted>localização não cadastrada</Muted></p>}
          </section>

          <section className="bdm-sec">
            <h3>Identificação</h3>
            <dl>
              <Row label="Serial atual">{buoy.deviceId ? <code>{buoy.deviceId}</code> : <Muted>sem serial cadastrado</Muted>}</Row>
              <Row label="Seriais anteriores">{anteriores.length ? anteriores.map((s) => <code key={s} className="bdm-chip">{s}</code>) : <Muted>nenhum</Muted>}</Row>
              <Row label="Modo">{modoTxt}</Row>
              {extra.aberta && <Row label="Manutenção aberta">{extra.aberta.motivo} <Muted>desde {fmtData(extra.aberta.timestamp_inicio)}</Muted></Row>}
            </dl>
          </section>

          <section className="bdm-sec">
            <h3>Dispositivo</h3>
            <dl>
              <Row label="Placa">{statusMsg?.board ?? ausente}</Row>
              <Row label="Firmware">
                {fw ? <>{fw.texto}{fw.fonte === 'deploy' && <Muted> segundo o último deploy</Muted>}</> : (extra.loading ? <Muted>carregando…</Muted> : ausente)}
              </Row>
              <Row label="Calibrada">{typeof statusMsg?.calibrated === 'boolean' ? (statusMsg.calibrated ? 'Sim' : 'Não') : ausente}</Row>
              <Row label="Tempo ligada">{uptime ?? ausente}</Row>
              <Row label="Sinal Wi-Fi">{rssi ?? ausente}</Row>
              <Row label="Memória">{memoria ?? ausente}</Row>
              <Row label="Latência MQTT">{latencia ?? ausente}</Row>
            </dl>
          </section>

          <section className="bdm-sec">
            <h3>Histórico</h3>
            {extra.error && <p className="bdm-error">Não foi possível carregar o histórico: {extra.error}</p>}
            <h4>Últimas manutenções</h4>
            {extra.loading ? <Muted>carregando…</Muted> : extra.manutencoes.length ? (
              <ul className="bdm-list">
                {extra.manutencoes.map((m) => (
                  <li key={m.id}>
                    <strong>{fmtData(m.timestamp_inicio)}</strong>{m.timestamp_fim ? ` → ${fmtData(m.timestamp_fim)}` : ' (em aberto)'}
                    <br /><Muted>{m.operador_nome}: {m.motivo}</Muted>
                  </li>
                ))}
              </ul>
            ) : <Muted>nenhuma registrada</Muted>}
            <h4>Últimas calibrações</h4>
            {extra.loading ? <Muted>carregando…</Muted> : extra.calibracoes.length ? (
              <ul className="bdm-list">
                {extra.calibracoes.map((c) => (
                  <li key={c.id ?? c.sensor_key}>
                    <strong>{SENSOR_LABEL[c.sensor_key] ?? c.sensor_key}</strong> em {fmtData(c.calibrated_at)}
                    <br /><Muted>{c.operador_nome}{c.observacao ? `: ${c.observacao}` : ''}</Muted>
                  </li>
                ))}
              </ul>
            ) : <Muted>nenhuma registrada</Muted>}
            <h4>Último deploy de firmware</h4>
            {extra.loading ? <Muted>carregando…</Muted> : extra.deploy ? (
              <p><strong>{extra.deploy.versao}</strong> em {fmtData(extra.deploy.data_deploy)}
                {extra.deploy.operador_nome && <Muted> por {extra.deploy.operador_nome}</Muted>}</p>
            ) : <Muted>nenhum deploy com sucesso registrado</Muted>}
          </section>

          <section className="bdm-sec bdm-nao-medido">
            <h3>Não medido por este hardware</h3>
            <ul>
              {NAO_MEDIDO.map((n) => <li key={n}>{n}: <Muted>não medido por este hardware</Muted></li>)}
            </ul>
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
}
