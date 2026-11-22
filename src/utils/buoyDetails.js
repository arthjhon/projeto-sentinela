import { qualidadeSinal } from './dashboard';

// Formatação do modal "Detalhes da bóia". Valor ausente devolve null: quem
// renderiza decide o texto ("sem leitura"); nunca se inventa número.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Uptime em segundos -> "3 d 4 h", "2 h 5 min", "5 min". */
export function formatUptime(seg) {
  if (!isNum(seg) || seg < 0) return null;
  const d = Math.floor(seg / 86400);
  const h = Math.floor((seg % 86400) / 3600);
  const m = Math.floor((seg % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return 'menos de 1 min';
}

/** Bytes -> "512 B", "124 KB", "2,0 MB". */
export function formatBytes(bytes) {
  if (!isNum(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** Memória livre/total do heap. */
export function formatMemoria(free, total) {
  const f = formatBytes(free);
  if (!f) return null;
  const t = formatBytes(total);
  return t ? `${f} livres de ${t}` : `${f} livres`;
}

/** RSSI + qualidade em texto. */
export function formatRssi(rssi) {
  if (!isNum(rssi)) return null;
  return `${Math.round(rssi)} dBm (${qualidadeSinal(rssi)})`;
}

/**
 * Firmware: o da mensagem de status (fonte 'status'); sem ela, o do último
 * deploy com sucesso (fonte 'deploy', a UI avisa "segundo o último deploy").
 */
export function escolherFirmware(statusMsg, deploy) {
  const fw = statusMsg?.firmware;
  if (typeof fw === 'string' && fw.trim()) return { texto: fw, fonte: 'status' };
  if (deploy?.versao) return { texto: deploy.versao, fonte: 'deploy' };
  return null;
}
