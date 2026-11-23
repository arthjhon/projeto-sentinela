// Formatadores de exibição do painel admin, em um lugar só. Ausente/inválido
// devolve null (idade, uptime, RSSI: quem renderiza escolhe o texto) ou '—'
// (datas). Nunca se inventa número. Datas sempre no fuso de Maceió.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Idade em ms: "há 4 s", "há 3 min", "há 2 h", "há 3 d" (floor); negativa = "agora"; inválida = null. */
export function formatIdade(ms) {
  if (!isNum(ms)) return null;
  if (ms < 0) return 'agora'; // relógio do navegador atrás do device
  const s = Math.floor(ms / 1000);
  if (s < 60) return `há ${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

/** Uptime em segundos -> "3 d 4 h", "2 h 5 min", "5 min", "menos de 1 min"; inválido = null. */
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

const TZ = 'America/Maceio';
const PARTES = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const PARTES_SEG = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const SO_DATA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const VAZIO = '—';

function partes(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'string') {
    const m = SO_DATA_RE.exec(valor);
    if (m) return { dia: m[3], mes: m[2], ano: m[1], hora: null, minuto: null }; // dia do calendário, sem fuso
  }
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(PARTES.formatToParts(d).map((x) => [x.type, x.value]));
  return { dia: p.day, mes: p.month, ano: p.year, hora: p.hour, minuto: p.minute };
}

/** "DD/MM/AAAA" (Maceió). Aceita ISO, Date, ms ou "AAAA-MM-DD" (dia do calendário); inválido = "—". */
export function formatData(valor) {
  const p = partes(valor);
  return p ? `${p.dia}/${p.mes}/${p.ano}` : VAZIO;
}

/** "DD/MM/AAAA HH:MM" (Maceió); "AAAA-MM-DD" sem hora vira só a data; inválido = "—". */
export function formatDataHora(valor) {
  const p = partes(valor);
  if (!p) return VAZIO;
  return p.hora == null ? `${p.dia}/${p.mes}/${p.ano}` : `${p.dia}/${p.mes}/${p.ano} ${p.hora}:${p.minuto}`;
}

/** "DD/MM/AAAA HH:MM:SS" (Maceió); "AAAA-MM-DD" sem hora vira só a data; inválido = "—". */
export function formatDataHoraSeg(valor) {
  const p = partes(valor);
  if (!p) return VAZIO;
  if (p.hora == null) return `${p.dia}/${p.mes}/${p.ano}`;
  const d = valor instanceof Date ? valor : new Date(valor);
  const seg = PARTES_SEG.formatToParts(d).find((x) => x.type === 'second').value;
  return `${p.dia}/${p.mes}/${p.ano} ${p.hora}:${p.minuto}:${seg}`;
}

/** "HH:MM" (Maceió); sem hora (ou inválido) = "—". */
export function formatHora(valor) {
  const p = partes(valor);
  return p && p.hora != null ? `${p.hora}:${p.minuto}` : VAZIO;
}

/** "DD/MM" (Maceió); inválido = "—". */
export function formatDiaMes(valor) {
  const p = partes(valor);
  return p ? `${p.dia}/${p.mes}` : VAZIO;
}

/** Qualidade do RSSI (dBm). */
export function qualidadeSinal(rssi) {
  if (!isNum(rssi)) return 'sem leitura';
  if (rssi >= -60) return 'ótimo';
  if (rssi >= -70) return 'bom';
  if (rssi >= -80) return 'fraco';
  return 'muito fraco';
}

/** "-65 dBm (bom)"; ausente = null. */
export function formatRssi(rssi) {
  if (!isNum(rssi)) return null;
  return `${Math.round(rssi)} dBm (${qualidadeSinal(rssi)})`;
}
