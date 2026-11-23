import { formatIdade, formatUptime, formatRssi } from './format';

// formatUptime e formatRssi vivem em format.js; reexportados para quem já importa daqui.
export { formatUptime, formatRssi };

// Formatação do modal "Detalhes da bóia". Valor ausente devolve null: quem
// renderiza decide o texto ("sem leitura"); nunca se inventa número.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

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

/** Rótulos do motivo do último reset da placa (campo `reset_reason`, firmware >= 5.2.0). */
export const ROTULO_REINICIO = {
  poweron: 'Energia ligada',
  external: 'Botão de reset',
  brownout: 'Queda de tensão',
  panic: 'Falha do firmware (panic)',
  task_wdt: 'Watchdog (tarefa travada)',
  int_wdt: 'Watchdog (interrupção)',
  other_wdt: 'Watchdog',
  deepsleep: 'Saída do sono profundo',
  ota: 'Atualização de firmware (OTA)',
  rollback: 'Volta automática (rollback)',
  offline: 'Sem broker por 10 min',
  remote: 'Comando remoto',
  console: 'Console serial',
  software: 'Reinício pelo firmware',
  unknown: 'Desconhecido',
};

export function rotuloReinicio(codigo) {
  if (codigo === undefined || codigo === null || codigo === '') return null;
  return Object.hasOwn(ROTULO_REINICIO, codigo) ? ROTULO_REINICIO[codigo] : `Desconhecido (${codigo})`;
}

/** Memória com mínimo desde o boot e maior bloco contíguo, quando a placa os informa. */
export function formatMemoriaDetalhada(statusMsg) {
  const base = formatMemoria(statusMsg?.free_heap, statusMsg?.total_heap);
  if (!base) return null;
  const min = formatBytes(statusMsg.min_free_heap);
  const bloco = formatBytes(statusMsg.max_alloc_heap);
  return base + (min ? ` · mínimo ${min} desde o boot` : '') + (bloco ? ` · maior bloco ${bloco}` : '');
}

/** "recebido há X" de um valor de /status da sessão (`_recebidoEm`); sem hora = null. */
export function rotuloRecebido(recebidoEm, agoraMs) {
  const idade = typeof recebidoEm === 'number' && Number.isFinite(recebidoEm) ? formatIdade(agoraMs - recebidoEm) : null;
  return idade ? `recebido ${idade}` : null;
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
 * Resultados de Promise.allSettled das 2 leituras do modal, na ordem
 * [manutencaoAberta, ultimoDeploy], em blocos independentes
 * {ok:true, valor} | {ok:false, erro}. Uma leitura que falha nunca vira
 * "nenhuma registrada": o bloco fica em erro. O histórico mora na ficha da bóia.
 */
export function blocosDetalhes([aberta, deploy]) {
  return { aberta: bloco(aberta), deploy: bloco(deploy) };
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
