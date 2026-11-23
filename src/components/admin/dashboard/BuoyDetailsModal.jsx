import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, AttributionControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { X } from 'lucide-react';
import { TILES } from '../../../config/mapTiles';
import { supabase } from '../../../lib/supabase';
import { manutencaoAberta } from '../../../services/maintenance';
import { ultimoDeploy } from '../../../services/otaCommand';
import { normalizeModo } from '../../../services/buoyRegistry';
import { blocosDetalhes, estadoManutencao } from '../../../utils/buoyDetails';
import DeviceInfoList, { Row, Muted, SerialRows } from './DeviceInfoList';
import { formatDataHora } from '../../../utils/format';
import { destinoTab } from '../../../utils/focusTrap';
import { hrefFicha } from '../../../utils/fichaBoia';
import './BuoyDetailsModal.css';

const FALHA = 'indisponível (falha na leitura)';
const NAO_MEDIDO = ['Bateria', 'Temperatura interna', 'GPS', 'Sinal de gateway'];

const fmtData = formatDataHora;

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
      manutencaoAberta(buoy.codigo),
      ultimoDeploy(supabase, buoy.codigo),
    ]).then((resultados) => {
      if (!cancelado) setDados({ codigo: buoy.codigo, blocos: blocosDetalhes(resultados) });
    });
    return () => { cancelado = true; };
  }, [buoy.codigo]);

  const temCoord = Number.isFinite(buoy.lat) && Number.isFinite(buoy.lng);
  const manut = estadoManutencao(blocos.aberta);

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
              <SerialRows buoy={buoy} />
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
            <DeviceInfoList statusMsg={statusMsg} agoraMs={agoraMs} deployBloco={blocos.deploy} />
          </section>

          <section className="bdm-sec bdm-nao-medido">
            <h3>Não medido por este hardware</h3>
            <ul>
              {NAO_MEDIDO.map((n) => <li key={n}>{n}: <Muted>não medido por este hardware</Muted></li>)}
            </ul>
          </section>
        </div>

        <footer className="bdm-foot">
          <Link className="btn-table action-btn" to={hrefFicha(buoy.codigo)} onClick={onClose}>Abrir ficha completa</Link>
        </footer>
      </div>
    </div>,
    document.body
  );
}
