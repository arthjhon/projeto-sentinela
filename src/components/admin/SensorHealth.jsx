import React, { useEffect, useState } from 'react';
import {
  estadoMeta, eventTone, fmtDate, DADOS_INSUFICIENTES_HINT, jobStaleness, jobTitle, fetchHealthEvents,
} from '../../services/sensorHealth';
import './SensorHealth.css';

const TONE_CLASS = {
  ok: 'badge-online', warn: 'badge-warning', bad: 'badge-offline',
  neutral: 'badge-planejada', info: 'sh-info',
};
const JOB_LABEL = { openmeteo: 'Open-Meteo', ana: 'ANA', detector: 'Detector' };

const fmt = fmtDate;

function titleFor(s) {
  const meta = estadoMeta(s.estado);
  if (s.estado === 'dados_insuficientes') return DADOS_INSUFICIENTES_HINT;
  return [s.motivo, s.desde && fmt(s.desde) !== '—' ? `desde ${fmt(s.desde)}` : null].filter(Boolean).join(' — ') || meta?.label;
}

/** Uma pílula por sensor; o motivo vai no title. */
export function SensorHealthBadges({ health }) {
  if (!health || !health.sensores.length) return null;
  return (
    <span className="sh-badges">
      {health.sensores.map((s) => {
        const meta = estadoMeta(s.estado);
        return (
          <span key={s.sensor} className={`badge ${TONE_CLASS[meta.tone]}`} title={titleFor(s)}>
            {s.sensor}: {meta.label}
          </span>
        );
      })}
    </span>
  );
}

/** Últimos eventos de saúde do device (dentro da linha expandida). */
export function HealthEvents({ deviceId, modo }) {
  const [state, setState] = useState({ loading: true, error: false, events: [] });

  useEffect(() => {
    let cancelled = false;
    fetchHealthEvents(deviceId, 10)
      .then((events) => { if (!cancelled) setState({ loading: false, error: false, events }); })
      .catch(() => { if (!cancelled) setState({ loading: false, error: true, events: [] }); });
    return () => { cancelled = true; };
  }, [deviceId]);

  if (state.loading) return <p className="text-muted sh-events-empty">Carregando eventos…</p>;
  if (state.error) return <p className="text-muted sh-events-empty">Saúde indisponível</p>;
  if (!state.events.length) return <p className="text-muted sh-events-empty">Sem eventos de saúde.</p>;
  return (
    <ul className="sh-events">
      {state.events.map((e) => {
        const meta = estadoMeta(e.estado);
        return (
          <li key={e.id}>
            <span className={`badge ${TONE_CLASS[eventTone(e.estado, modo)]}`}>{meta.label}</span>
            <span className="sh-ev-sensor">{e.sensor}</span>
            <span className="text-muted">
              {fmt(e.inicio)} → {e.fim ? fmt(e.fim) : 'em andamento'}
            </span>
            {e.motivo && <span className="sh-ev-motivo">{e.motivo}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Linha do cabeçalho: "Coleta: Open-Meteo ✓ · ANA ✓ · Detector ✓". */
export function CollectionHealth({ jobs, unavailable = false }) {
  if (unavailable) return <span className="text-muted sh-collection">Saúde indisponível</span>;
  const list = jobStaleness(jobs, new Date());
  if (!list.length) return null;
  return (
    <span className="sh-collection">
      Coleta:{' '}
      {list.map((j, i) => {
        const bad = j.atrasado || j.ok === false;
        const title = jobTitle(j);
        return (
          <React.Fragment key={j.job}>
            {i > 0 && ' · '}
            <span className={bad ? 'sh-job-late' : undefined} title={title}>
              {JOB_LABEL[j.job] ?? j.job} {bad ? '!' : '✓'}
            </span>
          </React.Fragment>
        );
      })}
    </span>
  );
}
