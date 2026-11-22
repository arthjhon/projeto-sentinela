import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Cpu } from 'lucide-react';
import { fetchStatusHistory, chaveHistorico, PERIODS } from '../../../hooks/useInfluxHistory';
import { disponibilidadeDoPeriodo } from '../../../utils/dashboard';
import { estadoColeta, formatIdade, formatTick } from '../../../utils/dashboardView';
import ChartTooltip from './ChartTooltip';

const SERIES = [
  { key: 'rssi', titulo: 'Sinal Wi-Fi (RSSI)', cor: '#38bdf8', fmt: (v) => `${Math.round(v)} dBm`, tick: Math.round },
  { key: 'mqtt_latency', titulo: 'Latência MQTT', cor: '#a78bfa', fmt: (v) => `${Math.round(v)} ms`, tick: Math.round },
  { key: 'free_heap', titulo: 'Memória livre (mínimo)', cor: '#34d399', fmt: (v) => `${Math.round(v / 1024)} KB`,
    // KB com uma casa: a variação do heap cabe em poucos KB e ticks inteiros se repetiam
    tick: (v) => (v / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) },
];

const ESTADO_JOB = {
  ok: { classe: 'badge-online', texto: 'ok' },
  atrasado: { classe: 'badge-warning', texto: 'atrasado' },
  falha: { classe: 'badge-offline', texto: 'falha' },
};

function MiniGrafico({ serie, dados, periodo }) {
  const pontos = dados.filter((d) => d[serie.key] != null);
  return (
    <div className="sys-chart">
      <h4>{serie.titulo}</h4>
      {pontos.length === 0 ? (
        <div className="chart-empty chart-empty-sm"><span>Sem dados em {PERIODS[periodo].label}.</span></div>
      ) : (
        <div className="sys-chart-body">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={pontos} margin={{ top: 5, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="time" type="number" scale="time" domain={['dataMin', 'dataMax']}
                tickFormatter={(t) => formatTick(t, periodo)} tick={{ fill: '#64748b', fontSize: 10 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.06)' }} tickLine={false} minTickGap={24} />
              <YAxis domain={['auto', 'auto']} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false}
                tickLine={false} width={44} tickFormatter={serie.tick} />
              <Tooltip content={<ChartTooltip formatar={serie.fmt} />} />
              <Line type="monotone" dataKey={serie.key} stroke={serie.cor} strokeWidth={2} dot={false}
                isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/**
 * Sistema da bóia selecionada: RSSI, latência MQTT e memória livre (status
 * gravado no Influx), disponibilidade no período (da série do gráfico de
 * sensores) e resumo da coleta do worker.
 * @param {{ids: string[], periodo: string, fila: Function, historico: {data, loading, error, chave},
 *   campo: string, campoRotulo: string, jobs: object[]|null|undefined (undefined = carregando, null = falhou),
 *   agoraMs: number}} props
 */
export default function SystemPanel({ ids, periodo, fila, historico, campo, campoRotulo, jobs, agoraMs }) {
  const idsKey = JSON.stringify(ids);
  const [status, setStatus] = useState({ chave: null, data: [], error: null });
  const chave = `${idsKey}|${periodo}`;

  useEffect(() => {
    const ctrl = new AbortController();
    fila((signal) => fetchStatusHistory(JSON.parse(idsKey), periodo, { signal }), { signal: ctrl.signal })
      .then((data) => { if (!ctrl.signal.aborted) setStatus({ chave: `${idsKey}|${periodo}`, data, error: null }); })
      .catch((err) => {
        if (ctrl.signal.aborted || err.name === 'AbortError') return;
        setStatus({ chave: `${idsKey}|${periodo}`, data: [], error: err.message });
      });
    return () => ctrl.abort();
  }, [idsKey, periodo, fila]);

  const carregando = status.chave !== chave;
  // só com a série do período/campo pedido: sem ela é "calculando…", nunca 0% nem dado velho
  const disp = ids.length > 0
    ? disponibilidadeDoPeriodo(historico, chaveHistorico(campo, periodo, ids), periodo) : null;
  const coleta = estadoColeta(jobs, new Date(agoraMs));

  return (
    <section className="dash-section glass">
      <div className="dash-section-head">
        <h3><Cpu size={18} className="text-primary" /> Sistema da bóia</h3>
        <span className="text-muted dash-small">Período: {PERIODS[periodo].label}</span>
      </div>

      <p className="sys-disp">
        Disponibilidade no período:{' '}
        <strong>
          {!ids.length ? 'sem serial cadastrado'
            : historico.error ? 'indisponível'
              : disp === null ? 'calculando…' : `${Math.round(disp * 100)}%`}
        </strong>
        {ids.length > 0 && !historico.error && (
          <span className="text-muted dash-small">
            {' '}janelas de {PERIODS[periodo].every} com leitura de {campoRotulo} ÷ janelas do período
          </span>
        )}
      </p>

      {!ids.length ? (
        <p className="text-muted">Bóia sem serial cadastrado: não há status da placa.</p>
      ) : carregando ? (
        <p className="text-muted">Carregando status da placa…</p>
      ) : status.error ? (
        <p className="text-muted">Não foi possível carregar o status da placa ({status.error}).</p>
      ) : (
        <div className="sys-charts">
          {SERIES.map((s) => <MiniGrafico key={s.key} serie={s} dados={status.data} periodo={periodo} />)}
        </div>
      )}

      <div className="sys-coleta">
        <h4>Coleta do worker</h4>
        {coleta.tipo === 'carregando' ? (
          <p className="text-muted">Carregando coleta…</p>
        ) : coleta.tipo === 'falha' ? (
          <p className="text-muted">Coleta indisponível (leitura falhou).</p>
        ) : coleta.tipo === 'vazio' ? (
          <p className="text-muted">Nenhum job registrado.</p>
        ) : (
          <ul>
            {coleta.itens.map((j) => (
              <li key={j.job} title={j.title}>
                <span className={`badge ${ESTADO_JOB[j.estado].classe}`}>{ESTADO_JOB[j.estado].texto}</span>
                <span>{j.rotulo}</span>
                <span className="text-muted dash-small">
                  {j.ultimoSucessoMs ? `último sucesso ${formatIdade(agoraMs - j.ultimoSucessoMs)}` : 'nunca concluído'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link to="/admin/status" className="dash-link">Status do sistema →</Link>
      </div>
    </section>
  );
}
