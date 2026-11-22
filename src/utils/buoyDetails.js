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

const bloco = (r) => (r.status === 'fulfilled'
  ? { ok: true, valor: r.value }
  : { ok: false, erro: r.reason?.message ?? String(r.reason) });

/**
 * Resultados de Promise.allSettled das 4 leituras do modal, na ordem
 * [listarManutencoes, manutencaoAberta, ultimasCalibracoes, ultimoDeploy],
 * em blocos independentes {ok:true, valor} | {ok:false, erro}. Uma leitura
 * que falha nunca vira "nenhuma registrada": o bloco fica em erro.
 */
export function blocosDetalhes([manutencoes, aberta, calibracoes, deploy]) {
  const m = bloco(manutencoes);
  const c = bloco(calibracoes);
  return {
    manutencoes: m.ok ? { ok: true, valor: (m.valor ?? []).slice(0, 3) } : m,
    aberta: bloco(aberta),
    calibracoes: c.ok
      ? {
          ok: true,
          valor: Object.values(c.valor ?? {})
            .sort((a, b) => new Date(b.calibrated_at) - new Date(a.calibrated_at))
            .slice(0, 3),
        }
      : c,
    deploy: bloco(deploy),
  };
}

/**
 * Linha "Firmware": o do /status da sessão; sem ele, o do último deploy.
 * `deployBloco` undefined = carregando. Falha na leitura do deploy é 'falha'
 * (não "sem leitura"): a UI diz que a leitura falhou.
 */
export function estadoFirmware(statusMsg, deployBloco) {
  const doStatus = escolherFirmware(statusMsg, null);
  if (doStatus) return { tipo: 'valor', ...doStatus };
  if (!deployBloco) return { tipo: 'carregando' };
  if (!deployBloco.ok) return { tipo: 'falha' };
  const doDeploy = escolherFirmware(null, deployBloco.valor);
  return doDeploy ? { tipo: 'valor', ...doDeploy } : { tipo: 'ausente' };
}

/** Linha "Manutenção aberta": carregando | falha | nao | aberta (com o registro). */
export function estadoManutencao(abertaBloco) {
  if (!abertaBloco) return { tipo: 'carregando' };
  if (!abertaBloco.ok) return { tipo: 'falha' };
  return abertaBloco.valor ? { tipo: 'aberta', registro: abertaBloco.valor } : { tipo: 'nao' };
}
