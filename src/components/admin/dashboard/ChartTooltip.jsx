import React from 'react';

/** Tooltip dos gráficos da visão geral: hora completa e valor já formatado. */
export default function ChartTooltip({ active, payload, label, formatar }) {
  if (!active || !payload?.length || payload[0].value == null) return null;
  return (
    <div className="chart-tooltip">
      <span className="chart-tooltip-time">
        {new Date(label).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
      <span className="chart-tooltip-value">{formatar(payload[0].value)}</span>
    </div>
  );
}
