import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useSystemStatus } from '../../contexts/SystemStatusContext';
import { useMqtt } from '../../hooks/useMqtt';
import { useUltimasLeituras } from '../../hooks/useUltimasLeituras';
import { useBuoyRegistry } from '../../hooks/useBuoyRegistry';
import { getMqttTopics } from '../../config/fleet';
import { CLOCK_TICK_MS } from '../../config/adminTimings';
import { topicsForRegistry } from '../../services/buoyRegistry';
import { mqttBrokerStatus, brokerDesde } from '../../services/systemStatus';
import { fmtDate } from '../../services/sensorHealth';
import { conexaoDoRegistro, COLUNAS_STATUS_BOIAS } from '../../utils/conexaoFrota';
import { hrefFicha } from '../../utils/fichaBoia';
import { formatIdade } from '../../utils/format';
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
      <span className="status-item-name">{name}</span>
      <span className="status-item-detail text-muted">{detalhe || ''}</span>
      <span className="status-item-pill"><StatePill estado={estado} /></span>
      <span className="status-item-checked text-muted">{checked ? `verificado ${checked}` : ''}</span>
    </div>
  );
}

const StatusPage = () => {
  const sys = useSystemStatus();
  const { messages, receivedAt, connected, addTopics } = useMqtt(getMqttTopics());
  const { buoys: registry, error: registryError, isFallback, reload: reloadRegistry } = useBuoyRegistry();
  const { ultimas } = useUltimasLeituras(registry);
  const [now, setNow] = useState(() => Date.now());
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

  const handleRefresh = () => sys.refresh();

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
    return { r, d, modo, lwt, lastAt, estado };
  }), [registry, messages, receivedAt, ultimas, now, connected]);

  const lwtTexto = (b) => (b.lwt === 'online' || b.lwt === 'offline' ? `LWT: ${b.lwt}` : 'sem LWT');

  return (
    <div className="dashboard-content-area">
      <PageToolbar>
        <button type="button" className="btn-table" onClick={handleRefresh} disabled={sys.loading}>
          <RefreshCw size={14} /> Atualizar
        </button>
      </PageToolbar>

      <RegistryErrorBanner error={isFallback ? registryError : null} onRetry={reloadRegistry} />

      <div className="status-pair">
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
      </div>

      <section className="status-section glass">
        <h2>Bóias</h2>
        <div className="status-table-wrap">
          <table className="sensors-table status-buoys">
            <thead>
              <tr>
                {COLUNAS_STATUS_BOIAS.map((c) => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {buoyRows.length === 0 && (
                <tr><td colSpan={COLUNAS_STATUS_BOIAS.length} className="text-muted">Nenhuma bóia cadastrada.</td></tr>
              )}
              {buoyRows.map((b) => {
                const writeIso = b.d ? writes[b.d] : null;
                const conexao = rotuloConexao(b.estado, b.lastAt ? formatIdade(now - b.lastAt) : null);
                return (
                  <tr key={b.r.codigo}>
                    <td data-label="Código"><Link to={hrefFicha(b.r.codigo)}>{b.r.codigo}</Link></td>
                    <td data-label="Nome">{b.r.nome}</td>
                    <td data-label="Modo"><span className={`badge ${b.modo === 'campo' ? 'badge-online' : 'badge-planejada'}`}>{b.modo === 'campo' ? 'Campo' : 'Bancada'}</span></td>
                    <td data-label="Conexão">
                      <span className={`badge ${TOM_CLASSE[conexao.tom]}`}>{conexao.texto}</span>
                      <div className="status-item-detail text-muted">{b.d ? lwtTexto(b) : 'sem serial cadastrado'}</div>
                    </td>
                    <td data-label="Última leitura">{b.lastAt ? formatIdade(now - b.lastAt) : '—'}</td>
                    <td data-label="Última gravação Influx" title={writeIso ? fmtDate(writeIso) : undefined}>{writeIso ? ageOf(writeIso, now) : '—'}</td>
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
