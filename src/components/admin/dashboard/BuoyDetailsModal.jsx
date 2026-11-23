import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapContainer, TileLayer, CircleMarker, AttributionControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { X } from 'lucide-react';
import { TILES } from '../../../config/mapTiles';
import { supabase } from '../../../lib/supabase';
import { listarManutencoes, ultimasCalibracoes, manutencaoAberta } from '../../../services/maintenance';
import { ultimoDeploy } from '../../../services/otaCommand';
import { normalizeModo } from '../../../services/buoyRegistry';
import {
  formatUptime, formatMemoria, formatRssi, blocosDetalhes, estadoFirmware, estadoManutencao, rotuloRecebido,
} from '../../../utils/buoyDetails';
import { formatDataHora } from '../../../utils/format';
import { serialValido } from '../../../utils/deviceIds';
import { destinoTab } from '../../../utils/focusTrap';
import './BuoyDetailsModal.css';

const SEM_LEITURA = 'sem leitura desde que o painel abriu';
const FALHA = 'indisponível (falha na leitura)';
const NAO_MEDIDO = ['Bateria', 'Temperatura interna', 'GPS', 'Sinal de gateway'];
const SENSOR_LABEL = { temperatura: 'Temperatura', ph: 'pH', turbidez: 'Turbidez' };

const fmtData = formatDataHora;

const Row = ({ label, children }) => (
  <div className="bdm-row">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);

const Muted = ({ children, title }) => <span className="bdm-muted" title={title}>{children}</span>;

export default function BuoyDetailsModal({ buoy, statusMsg, agoraMs, onClose }) {
  const titleRef = useRef(null);
  const dialogRef = useRef(null);
  const [dados, setDados] = useState({ codigo: null, blocos: null });
  // Blocos independentes ({ok, valor} | {ok:false, erro}); undefined = carregando
  // (os dados guardados ainda são de outra bóia).
  const blocos = dados.codigo === buoy.codigo ? dados.blocos : {};

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
      const focaveis = dialogRef.current.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
      const ativo = document.activeElement;
      const destino = destinoTab({
        ativo,
        titulo: titleRef.current,
        primeiro: focaveis[0],
        ultimo: focaveis[focaveis.length - 1],
        dentro: dialogRef.current.contains(ativo),
        shift: e.shiftKey,
      });
      if (destino) { e.preventDefault(); destino.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelado = false;
    // allSettled: uma leitura que falha não apaga as outras nem vira "nenhuma registrada"
    Promise.allSettled([
      listarManutencoes(buoy.codigo),
      manutencaoAberta(buoy.codigo),
      ultimasCalibracoes(buoy.codigo),
      ultimoDeploy(supabase, buoy.codigo),
    ]).then((resultados) => {
      if (!cancelado) setDados({ codigo: buoy.codigo, blocos: blocosDetalhes(resultados) });
    });
    return () => { cancelado = true; };
  }, [buoy.codigo]);

  const temCoord = Number.isFinite(buoy.lat) && Number.isFinite(buoy.lng);
  const fw = estadoFirmware(statusMsg, blocos.deploy);
  const manut = estadoManutencao(blocos.aberta);
  const rssi = formatRssi(statusMsg?.rssi);
  const memoria = formatMemoria(statusMsg?.free_heap, statusMsg?.total_heap);
  const uptime = formatUptime(statusMsg?.uptime);
  const latencia = Number.isFinite(statusMsg?.mqtt_latency) ? `${Math.round(statusMsg.mqtt_latency)} ms` : null;
  // idade do /status: o valor não é "agora", é o da última mensagem recebida
  const recebido = rotuloRecebido(statusMsg?._recebidoEm, agoraMs);
  const comIdade = (valor) => (valor && <>{valor}{recebido && <Muted> · {recebido}</Muted>}</>);
  const serial = serialValido(buoy);
  const anteriores = buoy.deviceIdsAnteriores ?? [];

  const ausente = <Muted>{SEM_LEITURA}</Muted>;
  const { fallback, ...tile } = TILES; // `fallback` é só da config; não vai ao TileLayer

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
                    <TileLayer {...tile} className={fallback ? 'bdm-tiles-fallback' : undefined} />
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
              <Row label="Serial atual">
                {serial ? <code>{serial}</code>
                  : buoy.deviceId ? <><code>{String(buoy.deviceId)}</code> <Muted>formato inválido: tratado como sem serial</Muted></>
                    : <Muted>sem serial cadastrado</Muted>}
              </Row>
              <Row label="Seriais anteriores">{anteriores.length ? anteriores.map((s) => <code key={s} className="bdm-chip">{s}</code>) : <Muted>nenhum</Muted>}</Row>
              {/* mesmo vocabulário do card (normalizeModo: ausente/inválido = bancada) */}
              <Row label="Modo">{normalizeModo(buoy.modo)}</Row>
              <Row label="Manutenção aberta">
                {manut.tipo === 'carregando' ? <Muted>carregando…</Muted>
                  : manut.tipo === 'falha' ? <Muted>{FALHA}</Muted>
                    : manut.tipo === 'nao' ? 'não'
                      : <>{manut.registro.motivo} <Muted>desde {fmtData(manut.registro.timestamp_inicio)}</Muted></>}
              </Row>
            </dl>
          </section>

          <section className="bdm-sec">
            <h3>Dispositivo</h3>
            <dl>
              <Row label="Placa">{statusMsg?.board ?? ausente}</Row>
              <Row label="Firmware">
                {fw.tipo === 'valor' ? <>{fw.texto}{fw.fonte === 'deploy' && <Muted> segundo o último deploy</Muted>}</>
                  : fw.tipo === 'carregando' ? <Muted>carregando…</Muted>
                    : fw.tipo === 'falha' ? <Muted>sem /status nesta sessão; leitura do último deploy falhou</Muted>
                      : ausente}
              </Row>
              <Row label="Calibrada">{typeof statusMsg?.calibrated === 'boolean' ? (statusMsg.calibrated ? 'Sim' : 'Não') : ausente}</Row>
              <Row label="Tempo ligada">{comIdade(uptime) || ausente}</Row>
              <Row label="Sinal Wi-Fi">{comIdade(rssi) || ausente}</Row>
              <Row label="Memória">{comIdade(memoria) || ausente}</Row>
              <Row label="Latência MQTT">{comIdade(latencia) || ausente}</Row>
            </dl>
          </section>

          <section className="bdm-sec">
            <h3>Histórico</h3>
            <h4>Últimas manutenções</h4>
            {!blocos.manutencoes ? <Muted>carregando…</Muted>
              : !blocos.manutencoes.ok ? <Muted title={blocos.manutencoes.erro}>{FALHA}</Muted>
              : blocos.manutencoes.valor.length ? (
              <ul className="bdm-list">
                {blocos.manutencoes.valor.map((m) => (
                  <li key={m.id}>
                    <strong>{fmtData(m.timestamp_inicio)}</strong>{m.timestamp_fim ? ` → ${fmtData(m.timestamp_fim)}` : ' (em aberto)'}
                    <br /><Muted>{m.operador_nome}: {m.motivo}</Muted>
                  </li>
                ))}
              </ul>
            ) : <Muted>nenhuma registrada</Muted>}
            <h4>Últimas calibrações</h4>
            {!blocos.calibracoes ? <Muted>carregando…</Muted>
              : !blocos.calibracoes.ok ? <Muted title={blocos.calibracoes.erro}>{FALHA}</Muted>
              : blocos.calibracoes.valor.length ? (
              <ul className="bdm-list">
                {blocos.calibracoes.valor.map((c) => (
                  <li key={c.id ?? c.sensor_key}>
                    <strong>{SENSOR_LABEL[c.sensor_key] ?? c.sensor_key}</strong> em {fmtData(c.calibrated_at)}
                    <br /><Muted>{c.operador_nome}{c.observacao ? `: ${c.observacao}` : ''}</Muted>
                  </li>
                ))}
              </ul>
            ) : <Muted>nenhuma registrada</Muted>}
            <h4>Último deploy de firmware</h4>
            {!blocos.deploy ? <Muted>carregando…</Muted>
              : !blocos.deploy.ok ? <Muted title={blocos.deploy.erro}>{FALHA}</Muted>
              : blocos.deploy.valor ? (
              <p><strong>{blocos.deploy.valor.versao}</strong> em {fmtData(blocos.deploy.valor.data_deploy)}
                {blocos.deploy.valor.operador_nome && <Muted> por {blocos.deploy.valor.operador_nome}</Muted>}</p>
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
