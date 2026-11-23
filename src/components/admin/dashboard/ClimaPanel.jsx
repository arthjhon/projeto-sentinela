import React, { useEffect, useMemo, useState } from 'react';
import { CloudRain, AlertTriangle, Waves } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { fetchPrevisao, fetchAnaRecente } from '../../../hooks/useClima';
import { LIMITE_CHUVA_FORTE_MM } from '../../../utils/clima';
import { formatMm, formatNum, formatTick, modeloClima } from '../../../utils/climaView';
import './dashboard.css';
import './ClimaPanel.css';

// Seção "Clima e aporte" da visão geral: previsão (Open-Meteo, gravada pelo
// worker) da lagoa e da bacia do Mundaú, e chuva/vazão medidas pela ANA
// (estação 39770000). As buscas entram na fila serial da página (limite de
// conexões do proxy); atualiza a cada 30 min e quando a aba volta a ficar
// visível. Toda a leitura dos dados vem de utils/climaView.js.

const INTERVALO_MS = 30 * 60e3;
const MIN_ENTRE_BUSCAS_MS = 60e3; // foco repetido na aba não dispara outra busca em seguida
const COR_CHUVA = '#38bdf8';
const COR_TEMP = '#ff7043'; // mesma cor da temperatura dos sensores

const BUSCAS = {
  lagoa: (signal) => fetchPrevisao('celmm', { signal }),
  bacia: (signal) => fetchPrevisao('bacia_mundau', { signal }),
  ana: (signal) => fetchAnaRecente({ signal }),
};

/** Busca as três séries pela fila; mantém o dado anterior se a nova busca falhar. */
function useBuscasClima(fila) {
  const [buscas, setBuscas] = useState({});
  useEffect(() => {
    const ctrl = new AbortController();
    let ultima = 0;
    const carregar = () => {
      if (document.visibilityState === 'hidden' || Date.now() - ultima < MIN_ENTRE_BUSCAS_MS) return;
      ultima = Date.now();
      for (const [chave, tarefa] of Object.entries(BUSCAS)) {
        setBuscas((b) => ({ ...b, [chave]: { dados: b[chave]?.dados ?? null, erro: null, carregando: true } }));
        fila(tarefa, { signal: ctrl.signal })
          .then((dados) => {
            if (!ctrl.signal.aborted) setBuscas((b) => ({ ...b, [chave]: { dados, erro: null, carregando: false } }));
          })
          .catch((err) => {
            if (err.name === 'AbortError' || ctrl.signal.aborted) return;
            setBuscas((b) => ({ ...b, [chave]: { dados: b[chave]?.dados ?? null, erro: err.message, carregando: false } }));
          });
      }
    };
    carregar();
    const timer = setInterval(carregar, INTERVALO_MS);
    document.addEventListener('visibilitychange', carregar);
    return () => {
      ctrl.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', carregar);
    };
  }, [fila]);
  return buscas;
}

/** Selo de frescor: nada quando ok; "desatualizada" ou "sem dado" visíveis. */
function Frescor({ estado }) {
  if (estado === 'desatualizada') return <span className="badge badge-warning clima-selo">desatualizada</span>;
  if (estado === 'sem dado') return <span className="badge badge-planejada clima-selo">sem dado</span>;
  return null;
}

/** Mensagem de bloco sem dado (carregando, falha ou vazio). */
function SemDado({ estado, erro, vazio }) {
  if (estado === 'carregando') return <p className="text-muted clima-vazio">Carregando…</p>;
  if (estado === 'erro') return <p className="text-muted clima-vazio">sem dado: falha na consulta{erro ? ` (${erro})` : ''}.</p>;
  return <p className="text-muted clima-vazio">sem dado: {vazio}</p>;
}

function TooltipHora({ active, payload }) {
  const h = active && payload?.[0]?.payload;
  if (!h) return null;
  return (
    <div className="chart-tooltip">
      <span className="chart-tooltip-time">hoje {h.hora} · previsto</span>
      <span className="clima-tt">chuva {formatMm(h.chuva)} · prob. {formatNum(h.prob, 0, '%')}</span>
      <span className="clima-tt">{formatNum(h.temp, 1, '°C')} · vento {formatNum(h.vento, 0, 'km/h')}</span>
    </div>
  );
}

const eixoX = { dataKey: 'hora', tick: { fill: '#64748b', fontSize: 10 }, tickLine: false, interval: 'preserveStartEnd', minTickGap: 18, axisLine: { stroke: 'rgba(255,255,255,0.06)' } };
const eixoY = { tick: { fill: '#64748b', fontSize: 10 }, axisLine: false, tickLine: false, width: 40, tickFormatter: formatTick };

function HorasDeHoje({ horas }) {
  if (!horas.length) return <p className="text-muted clima-vazio">sem dado: nenhuma hora prevista para hoje.</p>;
  return (
    <div className="clima-horas">
      <figure className="clima-grafico">
        <figcaption>Chuva prevista por hora (mm)</figcaption>
        <div className="clima-grafico-corpo">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={horas} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis {...eixoX} />
              <YAxis {...eixoY} allowDecimals />
              <Tooltip content={<TooltipHora />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="chuva" fill={COR_CHUVA} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <figure className="clima-grafico">
        <figcaption>Temperatura prevista por hora (°C)</figcaption>
        <div className="clima-grafico-corpo">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={horas} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis {...eixoX} />
              <YAxis {...eixoY} domain={['auto', 'auto']} />
              <Tooltip content={<TooltipHora />} />
              <Line type="monotone" dataKey="temp" stroke={COR_TEMP} strokeWidth={2} dot={false}
                activeDot={{ r: 4, fill: COR_TEMP, stroke: 'transparent' }} isAnimationActive={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>
    </div>
  );
}

function DiaCard({ d }) {
  const forte = d.chuva_mm != null && d.chuva_mm >= LIMITE_CHUVA_FORTE_MM;
  return (
    <li className={`clima-dia${forte ? ' is-forte' : ''}`}>
      <span className="clima-dia-nome">{d.rotulo}</span>
      <span className={`clima-dia-chuva${d.chuva_mm == null ? ' is-vazio' : ''}`}>{formatMm(d.chuva_mm)}</span>
      {forte && <span className="clima-dia-forte"><AlertTriangle size={11} /> chuva forte</span>}
      <dl className="clima-dia-dados">
        <div><dt>prob.</dt><dd>{formatNum(d.prob_max, 0, '%')}</dd></div>
        <div><dt>temp.</dt><dd>{d.temp_min == null ? 'sem dado' : `${formatNum(d.temp_min, 0)}–${formatNum(d.temp_max, 0, '°C')}`}</dd></div>
        <div><dt>vento</dt><dd>{formatNum(d.vento_max, 0, 'km/h')}</dd></div>
        <div><dt>nuvens</dt><dd>{formatNum(d.nuvens_media, 0, '%')}</dd></div>
      </dl>
      {d.parcial && <span className="clima-dia-parcial">parcial: {d.horas} de 24 h</span>}
    </li>
  );
}

function Acumulado({ rotulo, valor }) {
  return (
    <div className="clima-acum">
      <dt>{rotulo}</dt>
      <dd className={valor == null ? 'is-vazio' : undefined}>{formatMm(valor)}</dd>
    </div>
  );
}

const TOM_CLASSE_VAZAO = { acima: 'badge-warning', normal: 'badge-online', abaixo: 'sh-info' };

/**
 * @param {{fila: Function, jobs: object[]|null|undefined, agoraMs: number}} props
 *   `fila` = fila serial da página; `jobs` = worker_jobs (undefined carregando, null falhou).
 */
export default function ClimaPanel({ fila, jobs, agoraMs }) {
  const buscas = useBuscasClima(fila);
  const m = useMemo(
    () => modeloClima({ lagoa: buscas.lagoa, bacia: buscas.bacia, ana: buscas.ana, jobs, agoraMs }),
    [buscas, jobs, agoraMs],
  );
  const { lagoa, bacia, rio, coleta, aviso } = m;
  const algumaPrevisao = lagoa.estado === 'ok' || bacia.previsto.estado === 'ok';

  return (
    <section className="dash-section glass clima" aria-labelledby="clima-titulo">
      <div className="dash-section-head">
        <h3 id="clima-titulo"><CloudRain size={18} className="text-primary" /> Clima e aporte</h3>
        <p className="clima-coleta text-muted">
          {coleta.estado === 'carregando' ? 'Previsão: lendo a hora da coleta…'
            : coleta.quando ? <>Previsão coletada {coleta.quando}</> : 'Previsão: hora da coleta sem dado'}
          {' '}<Frescor estado={coleta.estado === 'carregando' ? 'ok' : coleta.estado} />
          {coleta.falhou && <span className="badge badge-offline clima-selo">última coleta falhou</span>}
        </p>
      </div>

      {aviso && (
        <p className="clima-aviso" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            <strong>Previsão de chuva forte:</strong> {formatMm(aviso.mm)} previstos para{' '}
            {aviso.rotuloDia === 'Hoje' || aviso.rotuloDia === 'Amanhã' ? aviso.rotuloDia.toLowerCase() : aviso.rotuloDia}{' '}
            na {aviso.rotuloPonto} (limite {LIMITE_CHUVA_FORTE_MM} mm no dia).
          </span>
        </p>
      )}
      {algumaPrevisao && m.avisoSemPonto.length > 0 && (
        <p className="text-muted dash-small">
          O aviso de chuva forte considera só os pontos com previsão (sem dado: {m.avisoSemPonto.join(', ')}).
        </p>
      )}

      <div className="clima-bloco">
        <h4>Hoje e próximos dias · lagoa (CELMM) · <span className="clima-tag">previsto</span></h4>
        {lagoa.estado === 'ok' ? (
          <>
            <ul className="clima-dias">{lagoa.dias.map((d) => <DiaCard key={d.dia} d={d} />)}</ul>
            {lagoa.dias.length === 0 && <p className="text-muted clima-vazio">sem dado: nenhum dia de hoje em diante.</p>}
            <h4 className="clima-sub">Hoje, hora a hora (hora de Maceió)</h4>
            <HorasDeHoje horas={lagoa.horas} />
          </>
        ) : (
          <SemDado estado={lagoa.estado} erro={lagoa.erro} vazio="nenhuma previsão gravada para a lagoa." />
        )}
      </div>

      <div className="clima-duo">
        <div className="clima-bloco">
          <h4>Chuva na bacia do Mundaú</h4>
          <div className="clima-colunas">
            <div>
              <p className="clima-col-titulo"><span className="clima-tag">previsto</span> próximas horas</p>
              {bacia.previsto.estado === 'ok' ? (
                <dl className="clima-acums">
                  <Acumulado rotulo="24 h" valor={bacia.previsto.h24} />
                  <Acumulado rotulo="48 h" valor={bacia.previsto.h48} />
                  <Acumulado rotulo="72 h" valor={bacia.previsto.h72} />
                </dl>
              ) : (
                <SemDado estado={bacia.previsto.estado} erro={bacia.previsto.erro} vazio="nenhuma previsão gravada para a bacia." />
              )}
            </div>
            <div>
              <p className="clima-col-titulo"><span className="clima-tag is-medido">medido</span> ANA 39770000</p>
              {bacia.medido.estado === 'ok' ? (
                <>
                  <dl className="clima-acums">
                    <Acumulado rotulo="últimas 24 h" valor={bacia.medido.h24} />
                    <Acumulado rotulo="últimas 72 h" valor={bacia.medido.h72} />
                  </dl>
                  <p className="text-muted dash-small clima-leitura">
                    última leitura {bacia.medido.quando} <Frescor estado={bacia.medido.frescor} />
                  </p>
                </>
              ) : (
                <SemDado estado={bacia.medido.estado} erro={bacia.medido.erro} vazio="nenhuma leitura de chuva da estação 39770000 em 3 dias." />
              )}
            </div>
          </div>
        </div>

        <div className="clima-bloco">
          <h4><Waves size={14} aria-hidden="true" /> Rio Mundaú agora · <span className="clima-tag is-medido">medido</span></h4>
          {rio.estado === 'ok' ? (
            <>
              <p className="clima-rio">
                <span className="clima-rio-valor">{formatNum(rio.atual, 1, 'm³/s')}</span>
                {rio.rotuloClasse
                  ? <span className={`badge ${TOM_CLASSE_VAZAO[rio.classe]}`}>{rio.rotuloClasse}</span>
                  : <span className="badge badge-planejada">sem classe</span>}
              </p>
              <dl className="clima-acums">
                <div className="clima-acum">
                  <dt>mediana 30 d</dt>
                  <dd className={rio.mediana == null ? 'is-vazio' : undefined}>{formatNum(rio.mediana, 1, 'm³/s')}</dd>
                </div>
              </dl>
              {rio.mediana == null && (
                <p className="text-muted dash-small">Menos de 7 dias de vazão: sem mediana para comparar.</p>
              )}
              <p className="text-muted dash-small clima-leitura">
                vazão da estação 39770000, leitura {rio.quando} <Frescor estado={rio.frescor} />
              </p>
            </>
          ) : (
            <SemDado estado={rio.estado} erro={rio.erro} vazio="nenhuma vazão registrada pela estação em 30 dias." />
          )}
        </div>
      </div>
    </section>
  );
}
