import React, { useMemo } from 'react';
import { comLacunas, indiceMaisProximo, intervalosSemLeitura } from '../../services/contextoAmbiental';
import {
  ResponsiveContainer, LineChart, BarChart, Line, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceArea,
} from 'recharts';

const fmtTick = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Maceio', day: '2-digit', month: '2-digit' });
const fmtFull = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Maceio', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const AXIS_TICK = { fill: '#94a3b8', fontSize: 11 };
const TOOLTIP_STYLE = {
  background: '#0D141F', color: '#e6f0fa', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 13,
};

// ponto sem vizinho válido não forma segmento: sem marcador ele sumiria
const isolatedDot = (rows, color) => ({ cx, cy, index, value }) => {
  if (value == null || cx == null || cy == null) return <g key={index} />;
  const alone = rows[index - 1]?.v == null && rows[index + 1]?.v == null;
  return alone ? <circle key={index} cx={cx} cy={cy} r={3} fill={color} /> : <g key={index} />;
};

// cursor do tooltip; sem linha casada (índice -1 vindo de indiceMaisProximo) não desenha
// nada, em vez do cursor padrão do Recharts na origem do gráfico
function CursorSincronizado({ payloadIndex, points, x, y, width, height, className }) {
  if (payloadIndex == null || payloadIndex < 0) return null;
  if (points) {
    return (
      <line
        className={className} x1={points[0].x} y1={points[0].y} x2={points[1].x} y2={points[1].y}
        stroke="#94a3b8" strokeOpacity={0.6} pointerEvents="none"
      />
    );
  }
  return <rect className={className} x={x} y={y} width={width} height={height} fill="rgba(148,163,184,0.15)" pointerEvents="none" />;
}

/**
 * Um gráfico do contexto ambiental. `state` = { data: [{time: Date, value}], loading, error }.
 * Todos os gráficos compartilham `syncId`, o domínio X e o arrasto de zoom (`drag`).
 * O cursor sincroniza por tempo (syncMethod), não por índice: cada gráfico tem
 * suas próprias linhas, então o índice do vizinho é outra data.
 */
export default function ContextoChart({
  id, title, state, passoMs, kind = 'line', color, unit, domain, zoom, drag, onDragStart, onDragMove, onDragEnd, onDragCancel,
}) {
  const rows = useMemo(() => {
    const all = (kind === 'bar' ? state.data : comLacunas(state.data, passoMs)).map(p => ({ t: p.time.getTime(), v: p.value }));
    return zoom ? all.filter(r => r.t >= zoom[0] && r.t <= zoom[1]) : all;
  }, [state.data, zoom, kind, passoMs]);
  const hasValue = rows.some(r => r.v != null);
  const validDomain = domain.every(Number.isFinite);
  // chuva: faixa cinza onde não há leitura (sem barra = seco ou sem leitura, sem a faixa não dá para saber)
  const semLeitura = kind === 'bar' && validDomain ? intervalosSemLeitura(state.data, passoMs, domain) : [];
  const xDomain = validDomain ? domain : ['dataMin', 'dataMax'];
  // ticks fixos e iguais em todos os gráficos (com poucos pontos o Recharts usa os próprios dados)
  const ticks = validDomain
    ? Array.from({ length: 7 }, (_, i) => Math.round(domain[0] + ((domain[1] - domain[0]) * i) / 6))
    : undefined;

  const common = {
    data: rows,
    syncId: 'contexto',
    syncMethod: (_ticks, e) => indiceMaisProximo(rows, e.activeLabel, passoMs),
    margin: { top: 8, right: 12, left: 0, bottom: 0 },
    onMouseDown: e => e && e.activeLabel != null && onDragStart(id, e.activeLabel),
    onMouseMove: e => e && e.activeLabel != null && onDragMove(id, e.activeLabel),
    onMouseUp: onDragEnd,
    onMouseLeave: onDragCancel,
  };
  const axes = [
    <CartesianGrid key="g" strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />,
    <XAxis
      key="x" dataKey="t" type="number" scale="time" domain={xDomain} ticks={ticks} allowDataOverflow
      tick={AXIS_TICK} tickLine={false} tickFormatter={t => fmtTick.format(t)}
    />,
    <YAxis key="y" tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} domain={[0, 'auto']} />,
    <Tooltip
      key="t" contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#8aa0b6' }} cursor={<CursorSincronizado />}
      labelFormatter={t => fmtFull.format(t)}
      formatter={v => [v == null ? '—' : `${Math.round(v * 100) / 100} ${unit}`, title]}
    />,
    ...semLeitura.map(([x1, x2]) => (
      <ReferenceArea key={`s${x1}`} x1={x1} x2={x2} fill="#94a3b8" fillOpacity={0.2} ifOverflow="hidden" />
    )),
    drag && drag.id === id && drag.a != null && drag.b != null
      ? <ReferenceArea key="r" x1={drag.a} x2={drag.b} fill={color} fillOpacity={0.15} />
      : null,
  ];

  let body;
  if (state.loading) body = <div className="ctx-state text-muted">Carregando…</div>;
  else if (state.error) body = <div className="ctx-state ctx-error">{state.error}</div>;
  else if (!hasValue) body = <div className="ctx-state text-muted">Sem dados neste período</div>;
  else {
    body = (
      <ResponsiveContainer width="100%" height={200}>
        {kind === 'bar' ? (
          <BarChart {...common}>
            {axes}
            <Bar dataKey="v" fill={color} isAnimationActive={false} maxBarSize={6} />
          </BarChart>
        ) : (
          <LineChart {...common}>
            {axes}
            <Line
              type="linear" dataKey="v" stroke={color} strokeWidth={2} dot={isolatedDot(rows, color)}
              connectNulls={false} isAnimationActive={false}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    );
  }

  return (
    <section className="ctx-chart glass">
      <h2>{title}</h2>
      {body}
      {kind === 'bar' && hasValue && !state.loading && !state.error && (
        <p className="text-muted ctx-legenda">faixa cinza = sem leitura</p>
      )}
    </section>
  );
}
