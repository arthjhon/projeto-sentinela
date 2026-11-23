import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Download, Info, Radio, RefreshCw, ShieldAlert, Table2 } from 'lucide-react';
import { useInfluxHistory, fetchHistory, PERIODS } from '../../../hooks/useInfluxHistory';
import { fetchHistoryCsv, downloadCsv } from '../../../utils/exportHistoryCsv';
import { deviceIdsOf } from '../../../services/buoyRegistry';
import { serialValido } from '../../../utils/deviceIds';
import { num } from '../../../utils/dashboard';
import { formatDataHoraSeg } from '../../../utils/format';
import { healthForDevice } from '../../../services/sensorHealth';
import { HealthEvents } from '../SensorHealth';
import { WATER_PARAMS } from '../../../config/waterQuality';
import { COR_GRADE, COR_TEXTO_SUTIL } from '../../../config/adminTheme';
import {
  CAMPOS, TOM_CLASSE, extremos24h, formatIdade, formatTick, formatValor, rotuloConexao, serieGrafico,
} from '../../../utils/dashboardView';
import SensorCard from './SensorCard';
import SystemPanel from './SystemPanel';
import ChartTooltip from './ChartTooltip';
import './dashboard.css';

const MAX_BUFFER = 120; // ≈ 10 min de leituras ao vivo (uma a cada 5 s)
const PERIODO_PADRAO = '24h';
const PARAM = Object.fromEntries(WATER_PARAMS.map((p) => [p.key, p]));
const celula = (v, campo) => (num(v) === null ? '—' : formatValor(v, campo));

/**
 * Tudo da bóia selecionada: um card por sensor, gráfico com período e CSV,
 * sistema da placa, eventos do detector e últimas coletas. Montado com
 * key = código: trocar de bóia zera o estado (buffer ao vivo, abas, período).
 * `mqtt` = {lwt, sensores, status} da própria bóia; `ultimas` = leituras
 * gravadas (30 dias) só dos seriais dela, mais recente primeiro.
 */
export default function BuoyPanel({
  buoy, mqtt, resumo, ultimas, ultimasErro, onAtualizarUltimas, healthRows, jobs, fila, agoraMs, onDetalhes,
}) {
  const ids = useMemo(() => deviceIdsOf(buoy), [buoy]);
  const idsKey = JSON.stringify(ids);
  const [campo, setCampo] = useState('temperatura');
  const [periodo, setPeriodo] = useState(PERIODO_PADRAO);
  const historico = useInfluxHistory(campo, periodo, ids);

  // Leituras MQTT da sessão, para o gráfico não parar entre gravações do
  // Telegraf. Ajuste no render (não em efeito): cada mensagem nova pela hora
  // de chegada, que identifica a mensagem mesmo com objeto recriado.
  const [buffer, setBuffer] = useState([]);
  const [vistaEm, setVistaEm] = useState(null);
  const sensores = mqtt?.sensores ?? null;
  if (sensores && sensores._recebidoEm !== vistaEm) {
    setVistaEm(sensores._recebidoEm);
    const entrada = { ts: sensores._recebidoEm };
    for (const c of CAMPOS) entrada[c] = num(sensores[c]);
    setBuffer((b) => [...b, entrada].slice(-MAX_BUFFER));
  }
  const serie = useMemo(() => serieGrafico(historico.data, buffer, campo), [historico.data, buffer, campo]);

  // Mín./máx. 24 h: médias de 10 min gravadas (history 24h) + últimas leituras brutas.
  const [hist24, setHist24] = useState(null); // null = carregando; {erro} | {campo: série}
  useEffect(() => {
    const ctrl = new AbortController();
    const lista = JSON.parse(idsKey);
    (async () => {
      const out = {};
      for (const c of CAMPOS) out[c] = await fila((signal) => fetchHistory(c, '24h', lista, { signal }), { signal: ctrl.signal });
      return out;
    })()
      .then((out) => { if (!ctrl.signal.aborted) setHist24(out); })
      .catch((err) => { if (!ctrl.signal.aborted && err.name !== 'AbortError') setHist24({ erro: err.message }); });
    return () => ctrl.abort();
  }, [idsKey, fila]);

  // serial fora do formato = sem serial válido (igual ao card)
  const serial = serialValido(buoy);
  const saudeIndisponivel = healthRows === null;
  const saudeSensores = serial ? healthForDevice(healthRows, serial, resumo.modo).sensores : [];
  const idade = resumo.ultimaMs != null ? formatIdade(agoraMs - resumo.ultimaMs) : null;
  const conexao = rotuloConexao(resumo.conexao, idade);
  const param = PARAM[campo];
  const paramTexto = campo === 'ph' ? param.label : param.label.toLowerCase(); // "pH" não vira "ph"
  // Sem gráfico para desenhar (sem serial, erro ou sem leituras): o bloco encolhe.
  // Carregando mantém a altura, para o gráfico não empurrar a página ao chegar.
  const graficoVazio = !ids.length || Boolean(historico.error) || (!historico.loading && serie.length === 0);

  // ── Export CSV do período do gráfico (como antes) ───────────────────────────
  const [exportando, setExportando] = useState(false);
  const [exportMsg, setExportMsg] = useState(null);
  async function exportar() {
    setExportando(true);
    setExportMsg(null);
    try {
      const { csv, rows, truncated } = await fetchHistoryCsv(periodo, ids, buoy.codigo);
      if (rows === 0) {
        setExportMsg(`Sem leituras em ${PERIODS[periodo].label} para exportar.`);
        return;
      }
      downloadCsv(csv, `sentinela_${buoy.codigo}_${periodo}_${new Date().toISOString().slice(0, 10)}.csv`);
      if (truncated) {
        setExportMsg('Exportação truncada: o período tem mais leituras que o limite do arquivo, e as mais antigas ficaram de fora. Escolha um período menor.');
      }
    } catch (err) {
      setExportMsg(err.message);
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="buoy-panel">
      <div className="bp-head">
        <div>
          <h2>{buoy.nome} <span className="bp-codigo">{buoy.codigo}</span></h2>
          <span className="text-muted dash-small">
            {idade ? `última leitura ${idade}` : 'sem leitura'} · modo {resumo.modo}
          </span>
        </div>
        <div className="bp-head-acoes">
          <span className={`badge ${TOM_CLASSE[conexao.tom]}`}>{conexao.texto}</span>
          <button type="button" className="btn-table" aria-haspopup="dialog" onClick={() => onDetalhes(buoy)}>
            <Info size={14} /> Detalhes
          </button>
        </div>
      </div>

      <div className="sensor-grid">
        {CAMPOS.map((c) => (
          <SensorCard key={c} campo={c} atual={resumo.valores[c]} agoraMs={agoraMs}
            saude={saudeSensores.find((s) => s.sensor === c) ?? null} saudeIndisponivel={saudeIndisponivel}
            extremos={extremos24h(hist24, ultimas, c, agoraMs, buffer)} />
        ))}
      </div>

      <section className="dash-section glass">
        <div className="dash-section-head">
          <h3><Radio size={18} className="text-primary" /> Histórico dos sensores</h3>
        </div>
        <div className="chart-param-tabs">
          {WATER_PARAMS.map((p) => (
            <button key={p.key} type="button" className={`chart-tab ${campo === p.key ? 'active' : ''}`}
              style={campo === p.key ? { borderColor: p.color, color: p.color } : undefined}
              aria-pressed={campo === p.key} onClick={() => setCampo(p.key)}>
              {p.label}
            </button>
          ))}
          <div className="chart-period-tabs">
            {Object.entries(PERIODS).map(([key, cfg]) => (
              <button key={key} type="button" className={`chart-period-tab ${periodo === key ? 'active' : ''}`}
                aria-pressed={periodo === key} onClick={() => setPeriodo(key)}>
                {cfg.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn-table action-btn chart-export-btn" onClick={exportar}
            disabled={exportando || !ids.length} title={`Exportar as leituras de ${PERIODS[periodo].label} em CSV`}>
            <Download size={14} /> {exportando ? 'Gerando...' : 'Exportar CSV'}
          </button>
        </div>
        {exportMsg && <p className="chart-export-error" role="status">{exportMsg}</p>}

        <div className={`chart-body${graficoVazio ? ' is-vazio' : ''}`}>
          {!ids.length ? (
            <div className="chart-empty"><span>Bóia sem serial cadastrado: não há histórico.</span></div>
          ) : historico.error ? (
            <div className="chart-empty">
              <span>Não foi possível carregar o histórico.</span><small>{historico.error}</small>
            </div>
          ) : historico.loading && serie.length === 0 ? (
            <div className="chart-empty"><span>Carregando histórico...</span></div>
          ) : serie.length === 0 ? (
            <div className="chart-empty">
              <span>Sem leituras de {paramTexto} em {PERIODS[periodo].label}.</span>
              <small>Escolha um período maior ou verifique se a bóia está publicando.</small>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={serie} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COR_GRADE} />
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
                  tickFormatter={(t) => formatTick(t, periodo)} tick={{ fill: COR_TEXTO_SUTIL, fontSize: 10 }}
                  axisLine={{ stroke: COR_GRADE }} tickLine={false} minTickGap={28} />
                <YAxis domain={['auto', 'auto']} tick={{ fill: COR_TEXTO_SUTIL, fontSize: 10 }} axisLine={false}
                  tickLine={false} width={42} />
                <Tooltip content={<ChartTooltip formatar={(v) => formatValor(v, campo)} />} />
                <Line type="monotone" dataKey="value" stroke={param.color} strokeWidth={2} dot={false}
                  activeDot={{ r: 4, fill: param.color, stroke: 'transparent' }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <SystemPanel ids={ids} periodo={periodo} fila={fila} historico={historico}
        campo={campo} campoRotulo={paramTexto} jobs={jobs} agoraMs={agoraMs} />

      <div className="bp-duo">
        <section className="dash-section glass">
          <div className="dash-section-head">
            <h3><ShieldAlert size={18} className="text-primary" /> Eventos do detector</h3>
          </div>
          {serial
            ? <HealthEvents deviceId={serial} modo={resumo.modo} />
            : <p className="text-muted">Bóia sem serial cadastrado: sem eventos.</p>}
        </section>

        <section className="dash-section glass">
          <div className="dash-section-head">
            <h3><Table2 size={18} className="text-primary" /> Últimas coletas</h3>
            <button type="button" className="btn-table btn-sm" onClick={onAtualizarUltimas} disabled={!ids.length}>
              <RefreshCw size={12} /> Atualizar
            </button>
          </div>
          {ultimasErro && <p className="chart-export-error" role="status">Não foi possível ler as últimas coletas ({ultimasErro}).</p>}
          {ultimas.length === 0 ? (
            <p className="text-muted">{ids.length ? 'Sem leituras gravadas nos últimos 30 dias.' : 'Bóia sem serial cadastrado.'}</p>
          ) : (
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr><th>Data/hora</th><th>Temp.</th><th>pH</th><th>Turbidez</th></tr>
                </thead>
                <tbody>
                  {ultimas.slice(0, 10).map((r, i) => (
                    <tr key={`${+r.time}-${i}`}>
                      <td data-label="Data/hora">{formatDataHoraSeg(r.time)}</td>
                      <td data-label="Temp.">{celula(r.temperatura, 'temperatura')}</td>
                      <td data-label="pH">{celula(r.ph, 'ph')}</td>
                      <td data-label="Turbidez">{celula(r.turbidez, 'turbidez')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
