import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useSystemStatus } from '../../contexts/SystemStatusContext';
import { useMqtt } from '../../hooks/useMqtt';
import { useBuoyRegistry } from '../../hooks/useBuoyRegistry';
import { getMqttTopics } from '../../config/fleet';
import { topicsForRegistry, normalizeModo } from '../../services/buoyRegistry';
import {
  buoyStatus, mqttBrokerStatus, inMqttGrace, BADGE_META,
} from '../../services/systemStatus';
import {
  fetchSensorHealth, healthForDevice, estadoMeta, eventTone, fmtDate,
} from '../../services/sensorHealth';
import { formatAge } from '../../utils/buoyRuntime';
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

const JOB_LABEL = { openmeteo: 'Open-Meteo', ana: 'ANA', detector: 'Detector de saúde dos sensores', status: 'Status (worker)' };
const WORKER_JOB = 'job_status';
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
  const [connectedSince, setConnectedSince] = useState(null);

  const connectedRef = useRef(connected);
  useEffect(() => { connectedRef.current = connected; }, [connected]);

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      // Desde quando o broker está fora (referência: montagem, se nunca conectou).
      setConnectedSince((prev) => (connectedRef.current ? (prev ?? Date.now()) : null));
      setDownSince((prev) => (connectedRef.current ? null : (prev ?? Date.now())));
    }, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (registry.length) addTopics(topicsForRegistry(registry));
  }, [registry, addTopics]);

  const healthAliveRef = useRef(true);
  const loadHealth = useCallback(() => fetchSensorHealth().then(
    (rows) => { if (healthAliveRef.current) { setHealthRows(rows); setHealthError(false); } },
    () => { if (healthAliveRef.current) setHealthError(true); },
  ), []);
  useEffect(() => {
    healthAliveRef.current = true;
    loadHealth();
    const id = setInterval(() => {
      if (document.visibilityState !== 'hidden') loadHealth();
    }, 30_000);
    return () => { healthAliveRef.current = false; clearInterval(id); };
  }, [loadHealth]);

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

  const statusJob = sys.jobs?.find((j) => j.componente === WORKER_JOB) ?? null;
  const collectionJobs = sys.jobs?.filter((j) => j.componente !== WORKER_JOB) ?? null;
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
    const grace = d && modo === 'campo' && inMqttGrace(connected, connectedSince, now);
    const estado = grace
      ? { estado: 'desconhecido', detalhe: 'aguardando conexão MQTT' }
      : buoyStatus({ modo, deviceId: d, availability, lastMessageAt: lastAt, now });
    const sh = d ? healthForDevice(healthRows, d, modo) : { sensores: [], pior: 'ok' };
    return { r, d, modo, availability, lastAt, health, estado, sh };
  }), [registry, messages, receivedAt, healthRows, now, connected, connectedSince]);

  const badgeMeta = BADGE_META[sys.badge] ?? BADGE_META.verificando;

  // Detalhe de conexão mostrado uma vez: o do estado, ou (sem detalhe) o rótulo do LWT.
  const connDetail = (b) => {
    if (b.estado.detalhe) return b.estado.detalhe;
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
          estado={sb?.auth?.estado ?? 'desconhecido'} detalhe={sb ? (sb.auth?.detalhe ?? sb.detalhe) : 'Verificando…'} checked={sbChecked} />
        <StatusItem name="Supabase — REST"
          estado={sb?.rest?.estado ?? 'desconhecido'} detalhe={sb ? (sb.rest?.detalhe ?? sb.detalhe) : 'Verificando…'} checked={sbChecked} />
        <StatusItem name="Broker MQTT" estado={broker.estado} detalhe={broker.detalhe} checked="agora" />
        <StatusItem {...workerRow('influxdb', 'InfluxDB')} />
        <StatusItem {...workerRow('telegraf_ingestao', 'Ingestão Telegraf')} />
        <StatusItem {...workerRow('worker', 'Worker')} />
        {statusJob && (
          <StatusItem name="Status (worker)" estado={statusJob.estado} detalhe={statusJob.detalhe}
            checked={statusJob.verificado_em ? ageOf(statusJob.verificado_em, now) : null} />
        )}
      </section>

      <section className="status-section glass">
        <h2>Coleta</h2>
        {sys.jobs === null && <p className="text-muted status-empty">Indisponível (leitura REST falhou).</p>}
        {collectionJobs?.length === 0 && <p className="text-muted status-empty">Nenhum job registrado.</p>}
        {collectionJobs?.map((j) => (
          <StatusItem key={j.componente}
            name={JOB_LABEL[j.componente.replace(/^job_/, '')] ?? j.componente}
            estado={j.estado} detalhe={j.detalhe}
            checked={j.verificado_em ? ageOf(j.verificado_em, now) : null} />
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
                      <div className="status-item-detail text-muted">{connDetail(b)}</div>
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
