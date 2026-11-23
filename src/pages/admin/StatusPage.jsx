import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useSystemStatus } from '../../contexts/SystemStatusContext';
import { useMqtt } from '../../hooks/useMqtt';
import { usePolling } from '../../hooks/usePolling';
import { useUltimasLeituras } from '../../hooks/useUltimasLeituras';
import { useBuoyRegistry } from '../../hooks/useBuoyRegistry';
import { getMqttTopics } from '../../config/fleet';
import { CLOCK_TICK_MS, STATUS_HEALTH_POLL_MS } from '../../config/adminTimings';
import { topicsForRegistry } from '../../services/buoyRegistry';
import { mqttBrokerStatus, brokerDesde, BADGE_META } from '../../services/systemStatus';
import {
  fetchSensorHealth, healthForDevice, estadoMeta, eventTone, fmtDate,
} from '../../services/sensorHealth';
import { conexaoDoRegistro } from '../../utils/conexaoFrota';
import { formatIdade, formatUptime, formatRssi } from '../../utils/format';
import { rotuloConexao, TOM_CLASSE } from '../../utils/dashboardView';
import RegistryErrorBanner from '../../components/admin/RegistryErrorBanner';
import PageToolbar from '../../components/admin/PageToolbar';
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
const BADGE_CLASS = { green: 'badge-online', amber: 'badge-warning', red: 'badge-offline', neutral: 'badge-planejada' };

const JOB_LABEL = { openmeteo: 'Open-Meteo', ana: 'ANA', detector: 'Detector de saúde dos sensores', status: 'Status (worker)' };
const WORKER_JOB = 'job_status';
// Itens que ainda não têm sonda: ficam num bloco recolhido, não como linhas fixas.
const SEM_SONDA = ['Disco', 'Backup', 'Túnel cloudflared', 'Deploy implantado'];

const ageOf = (iso, now) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? (formatIdade(now - t) ?? '—') : '—';
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
  const { buoys: registry, error: registryError, isFallback, reload: reloadRegistry } = useBuoyRegistry();
  const { ultimas } = useUltimasLeituras(registry);
  const [now, setNow] = useState(() => Date.now());
  const [healthRows, setHealthRows] = useState([]);
  const [healthError, setHealthError] = useState(false);
  // Hora da última transição de `connected` observada nesta página (ou da montagem):
  // é a única marca de tempo honesta do broker; sem ela não se mostra idade.
  const [broker0, setBroker0] = useState(() => ({ connected, desde: now }));
  if (broker0.connected !== connected) setBroker0({ connected, desde: now }); // now: relógio de 5 s, precisão da marca

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (registry.length) addTopics(topicsForRegistry(registry));
  }, [registry, addTopics]);

  const { runNow: reloadHealth } = usePolling(async ({ isCurrent }) => {
    try {
      const rows = await fetchSensorHealth();
      if (isCurrent()) { setHealthRows(rows); setHealthError(false); }
    } catch {
      if (isCurrent()) setHealthError(true);
    }
  }, STATUS_HEALTH_POLL_MS);

  const handleRefresh = () => { sys.refresh(); reloadHealth(); };

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
  const sbChecked = sys.checkedAt ? formatIdade(now - sys.checkedAt) : null;
  const broker = mqttBrokerStatus(connected, broker0.desde, now);
  const brokerIdade = connected ? brokerDesde(connected, broker0.desde, now) : null; // fora: o detalhe já traz o tempo
  const ingestao = rowByName.telegraf_ingestao;
  const writes = ingestao?.dados ?? {};

  const buoyRows = useMemo(() => registry.map((r) => {
    // Mesma entrada da Visão geral (MQTT + última leitura gravada): conexaoDoRegistro.
    const { serial: d, modo, estado, ultimaMs: lastAt } = conexaoDoRegistro({
      registro: r, mensagens: messages, chegadas: receivedAt, ultimas: ultimas[r.codigo] ?? [], agoraMs: now, brokerConectado: connected,
    });
    const lwt = d ? messages[`${d}/availability`] : undefined;
    const st = d ? messages[`${d}/status`] : undefined;
    const health = st && typeof st === 'object' ? st : {};
    const statusChegada = d ? receivedAt[`${d}/status`] : undefined;
    const sh = d ? healthForDevice(healthRows, d, modo) : { sensores: [], pior: 'ok' };
    return { r, d, modo, lwt, lastAt, health, statusChegada, estado, sh };
  }), [registry, messages, receivedAt, ultimas, healthRows, now, connected]);

  const badgeMeta = BADGE_META[sys.badge] ?? BADGE_META.verificando;

  const lwtTexto = (b) => (b.lwt === 'online' || b.lwt === 'offline' ? `LWT: ${b.lwt}` : 'sem LWT');

  return (
    <div className="dashboard-content-area">
      <PageToolbar
        inicio={
          <span className={`badge ${BADGE_CLASS[badgeMeta.tone]}`} title="Pior estado entre Plataforma (sem MQTT) e Coleta">
            {badgeMeta.label}
          </span>
        }
      >
        <button type="button" className="btn-table" onClick={handleRefresh} disabled={sys.loading}>
          <RefreshCw size={14} /> Atualizar
        </button>
      </PageToolbar>

      <RegistryErrorBanner error={isFallback ? registryError : null} onRetry={reloadRegistry} />

      <section className="status-section glass">
        <h2>Plataforma</h2>
        <StatusItem name="Supabase — autenticação"
          estado={sb?.auth?.estado ?? 'desconhecido'} detalhe={sb ? (sb.auth?.detalhe ?? sb.detalhe) : 'Verificando…'} checked={sbChecked} />
        <StatusItem name="Supabase — REST"
          estado={sb?.rest?.estado ?? 'desconhecido'} detalhe={sb ? (sb.rest?.detalhe ?? sb.detalhe) : 'Verificando…'} checked={sbChecked} />
        <StatusItem name="Broker MQTT" estado={broker.estado} detalhe={[broker.detalhe, brokerIdade].filter(Boolean).join(' · ')} checked={null} />
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
                <th>Código</th><th>Nome</th><th>Modo</th><th>Conexão</th><th>Última leitura</th>
                <th>Última gravação Influx</th><th>Status recebido</th><th>RSSI</th><th>Uptime</th><th>Firmware</th><th>Calibrado</th><th>Sensores</th>
              </tr>
            </thead>
            <tbody>
              {buoyRows.length === 0 && (
                <tr><td colSpan={12} className="text-muted">Nenhuma bóia cadastrada.</td></tr>
              )}
              {buoyRows.map((b) => {
                const tone = eventTone(b.sh.pior, b.modo);
                const writeIso = b.d ? writes[b.d] : null;
                const { health } = b;
                const conexao = rotuloConexao(b.estado, b.lastAt ? formatIdade(now - b.lastAt) : null);
                const stAt = b.statusChegada?.at;
                const stIdade = Number.isFinite(stAt) ? formatIdade(now - stAt) : null;
                return (
                  <tr key={b.r.codigo}>
                    <td>{b.r.codigo}</td>
                    <td>{b.r.nome}</td>
                    <td><span className={`badge ${b.modo === 'campo' ? 'badge-online' : 'badge-planejada'}`}>{b.modo === 'campo' ? 'Campo' : 'Bancada'}</span></td>
                    <td>
                      <span className={`badge ${TOM_CLASSE[conexao.tom]}`}>{conexao.texto}</span>
                      <div className="status-item-detail text-muted">{b.d ? lwtTexto(b) : 'sem serial cadastrado'}</div>
                    </td>
                    <td>{b.lastAt ? formatIdade(now - b.lastAt) : '—'}</td>
                    <td title={writeIso ? fmtDate(writeIso) : undefined}>{writeIso ? ageOf(writeIso, now) : '—'}</td>
                    <td title="Idade da última mensagem /status; RSSI, uptime e firmware abaixo são dela">
                      {stIdade ? `${stIdade}${b.statusChegada.retained ? ' (retida)' : ''}` : '—'}
                    </td>
                    <td>{formatRssi(health.rssi) ?? '—'}</td>
                    <td>{formatUptime(health.uptime) ?? '—'}</td>
                    <td>{health.firmware ?? '—'}</td>
                    <td>{typeof health.calibrated === 'boolean' ? (health.calibrated ? 'Sim' : 'Não') : '—'}</td>
                    <td>{b.d
                      ? <span className={`badge ${TOM_CLASSE[tone]}`}>{estadoMeta(b.sh.pior).label}</span>
                      : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <details className="status-section glass status-sem-sonda">
        <summary>Ainda sem sonda ({SEM_SONDA.length})</summary>
        <p className="text-muted status-empty">
          Não monitorados hoje (Fase 2); não entram no selo de saúde.
        </p>
        <ul>
          {SEM_SONDA.map((name) => <li key={name}>{name}</li>)}
        </ul>
      </details>
    </div>
  );
};

export default StatusPage;
