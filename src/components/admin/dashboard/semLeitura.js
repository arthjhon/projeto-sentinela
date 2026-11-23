import { formatData, formatDiaMes, formatHora } from '../../../utils/format';

/**
 * Linha do sensor sem valor: "sem leitura desde HH:MM" (mesmo dia em Maceió),
 * "sem leitura desde DD/MM às HH:MM" (outro dia) ou só "sem leitura" quando não
 * há última leitura conhecida. Nunca inventa hora.
 */
export function rotuloSemLeitura(emMs, agoraMs) {
  if (emMs == null || !Number.isFinite(emMs)) return 'sem leitura';
  const hora = formatHora(emMs);
  return formatData(emMs) === formatData(agoraMs)
    ? `sem leitura desde ${hora}`
    : `sem leitura desde ${formatDiaMes(emMs)} às ${hora}`;
}
