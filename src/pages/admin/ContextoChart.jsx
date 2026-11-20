import React, { useMemo } from 'react';
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

/**
 * Um gráfico do contexto ambiental. `state` = { data: [{time: Date, value}], loading, error }.
 * Todos os gráficos compartilham `syncId`, o domínio X e o arrasto de zoom (`drag`).
 */
export default function ContextoChart({
  id, title, state, kind = 'line', color, unit, domain, zoom, drag, onDragStart, onDragMove, onDragEnd,
}) {
  const rows = useMemo(() => {
    const all = state.data.map(p => ({ t: p.time.getTime(), v: p.value }));
    return zoom ? all.filter(r => r.t >= zoom[0] && r.t <= zoom[1]) : all;
  }, [state.data, zoom]);
  const hasValue = rows.some(r => r.v != null);
  const validDomain = domain.every(Number.isFinite);
  const xDomain = validDomain ? domain : ['dataMin', 'dataMax'];
  // ticks fixos e iguais em todos os gráficos (com poucos pontos o Recharts usa os próprios dados)
  const ticks = validDomain
    ? Array.from({ length: 7 }, (_, i) => Math.round(domain[0] + ((domain[1] - domain[0]) * i) / 6))
    : undefined;

  const common = {
    data: rows,
    syncId: 'contexto',
    margin: { top: 8, right: 12, left: 0, bottom: 0 },
    onMouseDown: e => e && e.activeLabel != null && onDragStart(id, e.activeLabel),
    onMouseMove: e => e && e.activeLabel != null && onDragMove(id, e.activeLabel),
    onMouseUp: onDragEnd,
  };
  const axes = [
    <CartesianGrid key="g" strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />,
    <XAxis
      key="x" dataKey="t" type="number" scale="time" domain={xDomain} ticks={ticks} allowDataOverflow
      tick={AXIS_TICK} tickLine={false} tickFormatter={t => fmtTick.format(t)}
    />,
    <YAxis key="y" tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} domain={[0, 'auto']} />,
    <Tooltip
      key="t" contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#8aa0b6' }}
      labelFormatter={t => fmtFull.format(t)}
      formatter={v => [v == null ? '—' : `${Math.round(v * 100) / 100} ${unit}`, title]}
    />,
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
              type="linear" dataKey="v" stroke={color} strokeWidth={2} dot={false}
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
    </section>
  );
}
