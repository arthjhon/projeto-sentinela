// Marcos automáticos de "dias monitorando" (changelog público). Puramente
// funções de data — sem I/O, sem Supabase — para poderem ser testadas
// isoladamente e para o cálculo nunca depender de rede.
//
// A data-âncora vem de app_settings.monitoramento_inicio (definida pelo
// admin), não de telemetria: ver
// docs/superpowers/specs/2026-07-20-changelog-publico-design.md.

const UM_DIA_MS = 86_400_000;

// Marcos de dias "redondos" — independem de calendário/ano bissexto.
const DIAS_REDONDOS = [100, 500, 1000, 2000, 5000, 10000];

// Aniversários anuais são calculados por calendário (setFullYear), e não por
// múltiplos de 365 dias — assim não desalinham por causa de anos bissextos.
const MAX_ANOS_ANIVERSARIO = 50;

/** 'YYYY-MM-DD' → Date à meia-noite local (mesmo fuso usado em toIso). */
function parseIso(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date local → 'YYYY-MM-DD', via getters locais (evita virar o dia via UTC). */
function toIso(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function rotuloAnos(anos) {
  return `${anos} ${anos === 1 ? 'ano' : 'anos'} de monitoramento`;
}

function rotuloDias(dias) {
  return `${dias.toLocaleString('pt-BR')} dias de monitoramento`;
}

/**
 * Dias corridos entre a data-âncora e `hoje` (ambas à meia-noite local).
 * @param {string|null|undefined} dataInicioIso  'YYYY-MM-DD'
 * @param {Date} [hoje]
 * @returns {number|null} null se a data-âncora for inválida/ausente
 */
export function diasDesde(dataInicioIso, hoje = new Date()) {
  const inicio = parseIso(dataInicioIso);
  if (!inicio) return null;
  return Math.max(0, Math.floor((hoje.getTime() - inicio.getTime()) / UM_DIA_MS));
}

/**
 * Marcos JÁ atingidos (data <= hoje), ordenados por data crescente. Mistura
 * dias redondos (100/500/1000/...) com aniversários de calendário (1 ano,
 * 2 anos, ...). Cada item tem o mesmo formato de uma entrada de
 * changelog_entries (`data`, `categoria`, `titulo`), mais `auto: true` — para
 * a timeline pública (EvolucaoPage) tratar os dois tipos de forma uniforme.
 *
 * @param {string|null|undefined} dataInicioIso  'YYYY-MM-DD'
 * @param {Date} [hoje]
 * @returns {Array<{data: string, categoria: 'Marco', titulo: string, auto: true}>}
 */
export function marcosDeDias(dataInicioIso, hoje = new Date()) {
  const inicio = parseIso(dataInicioIso);
  if (!inicio) return [];

  const marcos = [];

  for (const n of DIAS_REDONDOS) {
    const dataMarco = new Date(inicio.getTime() + n * UM_DIA_MS);
    if (dataMarco > hoje) break; // DIAS_REDONDOS está em ordem crescente
    marcos.push({ data: toIso(dataMarco), categoria: 'Marco', titulo: rotuloDias(n), auto: true });
  }

  for (let anos = 1; anos <= MAX_ANOS_ANIVERSARIO; anos++) {
    const aniversario = new Date(inicio);
    aniversario.setFullYear(aniversario.getFullYear() + anos);
    if (aniversario > hoje) break;
    marcos.push({ data: toIso(aniversario), categoria: 'Marco', titulo: rotuloAnos(anos), auto: true });
  }

  return marcos.sort((a, b) => a.data.localeCompare(b.data));
}
