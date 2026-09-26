/** Média de um array de leituras, ignorando null/undefined. null se nenhuma sobrar. */
export function computeFleetAverage(readings) {
  const vals = readings.filter(v => v != null);
  if (!vals.length) return null;
  return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
}
