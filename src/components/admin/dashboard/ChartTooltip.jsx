import React from 'react';
import { formatDataHoraSeg } from '../../../utils/format';

/** Tooltip dos gráficos da visão geral: hora completa e valor já formatado. */
export default function ChartTooltip({ active, payload, label, formatar }) {
  if (!active || !payload?.length || payload[0].value == null) return null;
  return (
    <div className="chart-tooltip">
      <span className="chart-tooltip-time">
        {formatDataHoraSeg(label)}
      </span>
      <span className="chart-tooltip-value">{formatar(payload[0].value)}</span>
    </div>
  );
}
