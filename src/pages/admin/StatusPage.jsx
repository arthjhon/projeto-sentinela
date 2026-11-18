import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useSystemStatus } from '../../contexts/SystemStatusContext';
import { useMqtt } from '../../hooks/useMqtt';
import { useBuoyRegistry } from '../../hooks/useBuoyRegistry';
import { getMqttTopics } from '../../config/fleet';
import { topicsForRegistry, normalizeModo } from '../../services/buoyRegistry';
import {
  buoyStatus, mqttBrokerStatus, BADGE_META,
} from '../../services/systemStatus';
import {
  fetchSensorHealth, healthForDevice, estadoMeta, eventTone, fmtDate,
} from '../../services/sensorHealth';
import { formatAge } from '../../utils/buoyRuntime';
import './SensorsPage.css';
import './StatusPage.css';

const STATE_LABEL = {
  ok: 'OK', degradado: 'Degradado', falha: 'Falha',
  desconhecido: 'Desconhecido', nao_monitorado: 'Não monitorado',
};
// Classes de badge existentes (shared.css). Vermelho só para 'falha'.
const STATE_CLASS = {
  ok: 'badge-online', degradado: 'badge-warning', falha: 'badge-offline',
  desconhecido: 'badge-planejada', nao_monitorado: 'badge-planejada',
};
const TONE_CLASS = {
  ok: 'badge-online', warn: 'badge-warning', bad: 'badge-offline',
  info: 'badge-planejada', neutral: 'badge-planejada',
};
const BADGE_CLASS = { green: 'badge-online', amber: 'badge-warning', red: 'badge-offline', neutral: 'badge-planejada' };

const JOB_LABEL = { openmeteo: 'Open-Meteo', ana: 'ANA', detector: 'Detector de saúde dos sensores' };
const INFRA = ['Disco', 'Backup', 'Túnel cloudflared', 'Deploy implantado'];

const ageOf = (iso, now) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? formatAge(now - t) : '—';
};

function StatePill({ estado }) {
  return <span className={`badge ${STATE_CLASS[estado] ?? 'badge-planejada'}`}>{STATE_LABEL[estado] ?? estado}</span>;
}

function StatusItem({ name, estado, detalhe, checked }) {
  return (
    <div className="status-item">
      <div className="status-item-main">
        <span className="status-item-name">{name}</span>
        {detalhe && <span className="status-item-detail text-muted">{detalhe}</span>}
      </div>
      <span className="status-item-checked text-muted">{checked ? `verificado ${checked}` : ''}</span>
      <StatePill estado={estado} />
    </div>
  );
}

const StatusPage = () => {
  const sys = useSystemStatus();
  const { messages, receivedAt, connected, addTopics } = useMqtt(getMqttTopics());
  const { buoys: registry } = useBuoyRegistry();
  const [now, setNow] = useState(() => Date.now());
  const [healthRows, setHealthRows] = useState([]);
  const [healthError, setHealthError] = useState(false);
  const [downSince, setDownSince] = useState(() => Date.now());

  const connectedRef = useRef(connected);
  useEffect(() => { connectedRef.current = connected; }, [connected]);

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      // Desde quando o broker está fora (referência: montagem, se nunca conectou).
      setDownSince((prev) => (connectedRef.current ? null : (prev ?? Date.now())));
    }, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (registry.length) addTopics(topicsForRegistry(registry));
  }, [registry, addTopics]);

  const loadHealth = () => fetchSensorHealth().then(
    (rows) => { setHealthRows(rows); setHealthError(false); },
    () => setHealthError(true),
  );
  useEffect(() => {
    let cancelled = false;
    fetchSensorHealth().then(
      (rows) => { if (!cancelled) { setHealthRows(rows); setHealthError(false); } },
      () => { if (!cancelled) setHealthError(true); },
    );
    return () => { cancelled = true; };
  }, []);

  const handleRefresh = () => { sys.refresh(); loadHealth(); };

  const rowByName = useMemo(
    () => Object.fromEntries((sys.rows ?? []).map((r) => [r.componente, r])),
    [sys.rows],
  );
  const workerRow = (componente, name) => {
    const r = rowByName[componente];
    if (!r) {
      return {
        name, estado: 'desconhecido',
        detalhe: sys.rows ? 'sem dados do worker' : 'indisponível (leitura REST falhou)',
        checked: null,
      };
    }
    return { name, estado: r.estado, detalhe: r.detalhe, checked: ageOf(r.verificado_em, now) };
  };

  const sb = sys.supabase;
  const sbChecked = sys.checkedAt ? formatAge(now - sys.checkedAt) : null;
  const broker = mqttBrokerStatus(connected, downSince, now);
  const ingestao = rowByName.telegraf_ingestao;
  const writes = ingestao?.dados ?? {};

  const buoyRows = useMemo(() => registry.map((r) => {
    const d = r.deviceId || null;
    const modo = normalizeModo(r.modo);
    // Mensagens retidas (LWT entregue no subscribe) não provam que a bóia está falando agora.
    const live = d
      ? ['sensores', 'status'].map((s) => receivedAt[`${d}/${s}`]).filter((x) => x && !x.retained).map((x) => x.at)
      : [];
    const lastAt = live.length ? Math.max(...live) : null;
    const availability = d ? messages[`${d}/availability`] : undefined;
    const st = d ? messages[`${d}/status`] : undefined;
    const health = st && typeof st === 'object' ? st : {};
    const estado = buoyStatus({ modo, deviceId: d, availability, lastMessageAt: lastAt, now });
    const sh = d ? healthForDevice(healthRows, d, modo) : { sensores: [], pior: 'ok' };
    return { r, d, modo, availability, lastAt, health, estado, sh };
  }), [registry, messages, receivedAt, healthRows, now]);

  const badgeMeta = BADGE_META[sys.badge] ?? BADGE_META.verificando;

  const connLabel = (b) => {
    if (!b.d) return 'sem hardware';
    if (b.availability === 'online') return 'online';
    if (b.availability === 'offline') return 'offline';
    return 'sem LWT';
  };

  return (
    <div className="dashboard-content-area">
      <div className="page-header d-flex-between">
        <div>
          <h1>Status do Sistema</h1>
          <p>Saúde da plataforma, da coleta e das bóias. Somente leitura.</p>
        </div>
        <div className="header-actions">
          <span className={`badge ${BADGE_CLASS[badgeMeta.tone]}`} title="Pior estado entre Plataforma (sem MQTT) e Coleta">
            {badgeMeta.label}
          </span>
          <button type="button" className="btn-table" onClick={handleRefresh} disabled={sys.loading}>
            <RefreshCw size={14} /> Atualizar
          </button>
        </div>
      </div>

      <section className="status-section glass">
        <h2>Plataforma</h2>
        <StatusItem name="Supabase — autenticação"
          estado={sb?.auth?.estado ?? 'desconhecido'} detalhe={sb ? sb.auth.detalhe : 'Verificando…'} checked={sbChecked} />
        <StatusItem name="Supabase — REST"
          estado={sb?.rest?.estado ?? 'desconhecido'} detalhe={sb ? sb.rest.detalhe : 'Verificando…'} checked={sbChecked} />
        <StatusItem name="Broker MQTT" estado={broker.estado} detalhe={broker.detalhe} checked="agora" />
        <StatusItem {...workerRow('influxdb', 'InfluxDB')} />
        <StatusItem {...workerRow('telegraf_ingestao', 'Ingestão Telegraf')} />
        <StatusItem {...workerRow('worker', 'Worker')} />
      </section>

      <section className="status-section glass">
        <h2>Coleta</h2>
        {sys.jobs === null && <p className="text-muted status-empty">Indisponível (leitura REST falhou).</p>}
        {sys.jobs?.length === 0 && <p className="text-muted status-empty">Nenhum job registrado.</p>}
        {sys.jobs?.map((j) => (
          <StatusItem key={j.componente}
            name={JOB_LABEL[j.componente.replace(/^job_/, '')] ?? j.componente}
            estado={j.estado} detalhe={j.detalhe} checked={null} />
        ))}
      </section>

      <section className="status-section glass">
        <h2>Bóias</h2>
        {healthError && <p className="text-muted status-empty">Saúde dos sensores indisponível.</p>}
        <div className="status-table-wrap">
          <table className="sensors-table status-buoys">
            <thead>
              <tr>
                <th>Código</th><th>Nome</th><th>Modo</th><th>Conexão</th><th>Última mensagem</th>
                <th>Última gravação Influx</th><th>RSSI</th><th>Uptime</th><th>Firmware</th><th>Calibrado</th><th>Sensores</th>
              </tr>
            </thead>
            <tbody>
              {buoyRows.length === 0 && (
                <tr><td colSpan={11} className="text-muted">Nenhuma bóia cadastrada.</td></tr>
              )}
              {buoyRows.map((b) => {
                const tone = eventTone(b.sh.pior, b.modo);
                const writeIso = b.d ? writes[b.d] : null;
                const { health } = b;
                return (
                  <tr key={b.r.codigo}>
                    <td>{b.r.codigo}</td>
                    <td>{b.r.nome}</td>
                    <td><span className={`badge ${b.modo === 'campo' ? 'badge-online' : 'badge-planejada'}`}>{b.modo === 'campo' ? 'Campo' : 'Bancada'}</span></td>
                    <td>
                      <StatePill estado={b.estado.estado} />
                      <div className="status-item-detail text-muted">{connLabel(b)}{b.estado.detalhe ? ` · ${b.estado.detalhe}` : ''}</div>
                    </td>
                    <td>{b.lastAt ? formatAge(now - b.lastAt) : '—'}</td>
                    <td title={writeIso ? fmtDate(writeIso) : undefined}>{writeIso ? ageOf(writeIso, now) : '—'}</td>
                    <td>{Number.isFinite(health.rssi) ? `${health.rssi} dBm` : '—'}</td>
                    <td>{Number.isFinite(health.uptime) ? `${Math.floor(health.uptime / 60)} min` : '—'}</td>
                    <td>{health.firmware ?? '—'}</td>
                    <td>{typeof health.calibrated === 'boolean' ? (health.calibrated ? 'Sim' : 'Não') : '—'}</td>
                    <td>{b.d
                      ? <span className={`badge ${TONE_CLASS[tone]}`}>{estadoMeta(b.sh.pior).label}</span>
                      : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="status-section glass">
        <h2>Infraestrutura</h2>
        {INFRA.map((name) => (
          <StatusItem key={name} name={name} estado="nao_monitorado" detalhe="Fase 2 — não monitorado" checked={null} />
        ))}
      </section>
    </div>
  );
};

export default StatusPage;
