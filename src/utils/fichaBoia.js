import { SENSORES_BOIA } from './boiasView';
import { formatUptime, formatDataHora } from './format';
import { ultimaCalibracaoPorSensor } from '../services/maintenance';
import { estadoMeta, eventTone, healthForDevice } from '../services/sensorHealth';
import { statusEfetivo, rotuloStatusDeploy } from '../services/otaDeployState';
import { AUDIT } from '../services/auditLog';
import { ehPerfilAuditoria } from '../config/adminNav';

// Lógica pura da ficha da bóia (/admin/boias/:codigo): linha do tempo unificada,
// linhas de sensores e resolução da rota. Sem React, sem I/O; `agoraMs` vem de quem chama.

export const LIMITE_POR_FONTE = 100;
export const TIPOS = ['manutencao', 'calibracao', 'firmware', 'saude', 'cadastro'];
export const ROTULO_TIPO = {
  manutencao: 'Manutenção', calibracao: 'Calibração', firmware: 'Firmware', saude: 'Saúde', cadastro: 'Cadastro',
};
export const ACOES_CADASTRO = [AUDIT.BOIA_CRIAR, AUDIT.BOIA_EDITAR];

// ---------- fontes ----------

/** Resolve a leitura em uma Fonte; nunca rejeita (falha vira { estado: 'erro' }). */
export async function paraFonte(promessa) {
  try {
    return { estado: 'ok', linhas: await promessa };
  } catch (err) {
    return { estado: 'erro', erro: err?.message ?? String(err) };
  }
}

/** Estado antes da primeira resposta. Cadastro (audit_logs) é decidido pelo perfil, sem consulta. */
export function fonteInicial(tipo, role) {
  if (tipo === 'cadastro' && !ehPerfilAuditoria(role)) return { estado: 'sem-acesso' };
  return { estado: 'carregando' };
}

// ---------- sensores ----------

/** Chave (turbidez) ou nome (Turbidez) -> nome de exibição; desconhecido volta como veio. */
export function nomeDoSensor(chaveOuNome) {
  const s = SENSORES_BOIA.find((x) => x.key === chaveOuNome || x.name === chaveOuNome);
  return s ? s.name : chaveOuNome;
}

// ---------- itens da linha do tempo ----------

const ms = (v) => Date.parse(v);
const separar = (texto) => {
  const t = texto ?? '';
  const i = t.indexOf('\n');
  if (i < 0) return { primeira: t, resto: null };
  return { primeira: t.slice(0, i), resto: t.slice(i + 1) || null };
};
const duracao = (ini, fim) => formatUptime((ms(fim) - ms(ini)) / 1000) ?? '—';

export function itensManutencao(rows) {
  return (rows ?? []).map((r) => {
    const { primeira, resto } = separar(r.motivo);
    const cancelada = (r.motivo ?? '').includes('\n— Manutenção cancelada');
    let frase;
    let tom;
    if (!r.timestamp_fim) {
      frase = `Manutenção em andamento: ${primeira}`;
      tom = 'warn';
    } else if (cancelada) {
      frase = `Manutenção cancelada após ${duracao(r.timestamp_inicio, r.timestamp_fim)}: ${primeira}`;
      tom = 'neutral';
    } else {
      frase = `Manutenção concluída em ${duracao(r.timestamp_inicio, r.timestamp_fim)}: ${primeira}`;
      tom = 'ok';
    }
    return {
      id: `manutencao-${r.id}`, tipo: 'manutencao', emMs: ms(r.timestamp_inicio),
      frase, detalhe: resto, autor: r.operador_nome ?? null, tom,
    };
  });
}

export function itensCalibracao(rows) {
  return (rows ?? []).map((r) => ({
    id: `calibracao-${r.id}`, tipo: 'calibracao', emMs: ms(r.calibrated_at),
    frase: `Calibração registrada: ${nomeDoSensor(r.sensor_key)}`,
    detalhe: r.observacao || null, autor: r.operador_nome ?? null, tom: 'neutral',
  }));
}

export function itensFirmware(rows, agoraMs) {
  return (rows ?? []).map((r) => {
    const rot = rotuloStatusDeploy(statusEfetivo(r, agoraMs));
    return {
      id: `firmware-${r.id}`, tipo: 'firmware', emMs: ms(r.data_deploy),
      frase: `Firmware v${String(r.versao ?? '').replace(/^v/i, '')}: ${rot.texto}`,
      detalhe: null, autor: r.operador_nome ?? null, tom: rot.tom,
    };
  });
}

export function itensSaude(rows, { serialAtual, modo }) {
  return (rows ?? []).map((r) => {
    const label = estadoMeta(r.estado).label;
    const nome = nomeDoSensor(r.sensor);
    const frase = r.fim
      ? `${nome}: ${label} até ${formatDataHora(r.fim)}`
      : `${nome}: ${label} (em andamento)`;
    const anterior = r.device_id !== serialAtual;
    const partes = [];
    if (anterior) partes.push(`serial anterior ${r.device_id}`);
    if (r.motivo) partes.push(r.motivo);
    return {
      id: `saude-${r.id}`, tipo: 'saude', emMs: ms(r.inicio), frase,
      detalhe: partes.length ? partes.join(' · ') : null, autor: null, tom: eventTone(r.estado, modo),
    };
  });
}

const temValor = (v) => v !== undefined && v !== null && String(v).trim() !== '';
/** Serial normalizado: null/undefined/'' (após trim) = sem serial. */
const serialDe = (d) => (temValor(d?.deviceId) ? String(d.deviceId).trim() : null);
const serialTxt = (d) => (serialDe(d) ? `serial ${serialDe(d)}` : 'sem serial');
const SEM_SERIAL = 'sem serial';

// Linhas antigas de audit_logs podem não ter `modo`/`nome` e trazem chaves extras
// (ex.: status): campo ausente é omitido da frase e só se compara quando presente nos dois eventos.
const valoresTxt = (d) => [
  temValor(d.nome) ? d.nome : null,
  serialTxt(d),
  temValor(d.modo) ? d.modo : null,
].filter((x) => x !== null).join(', ');

/** `rows` do mais novo ao mais antigo (como a consulta devolve); muda = comparação com o evento anterior. */
export function itensCadastro(rows) {
  const lista = rows ?? [];
  return lista.map((r, i) => {
    const d = r.detalhes ?? {};
    const prev = lista[i + 1]?.detalhes; // o mais antigo vem depois na lista
    let frase;
    if (r.acao === AUDIT.BOIA_CRIAR) {
      frase = `Cadastrada (${valoresTxt(d)})`;
    } else if (!prev) {
      frase = `Cadastro editado (valores: ${valoresTxt(d)})`;
    } else {
      const mud = [];
      if (temValor(prev.nome) && temValor(d.nome) && prev.nome !== d.nome) mud.push(`nome ${prev.nome} → ${d.nome}`);
      if (temValor(prev.modo) && temValor(d.modo) && prev.modo !== d.modo) mud.push(`modo ${prev.modo} → ${d.modo}`);
      if (prev.deviceId !== undefined && d.deviceId !== undefined && serialDe(prev) !== serialDe(d)) {
        mud.push(`serial ${serialDe(prev) ?? SEM_SERIAL} → ${serialDe(d) ?? SEM_SERIAL}`);
      }
      frase = mud.length ? `Cadastro editado: ${mud.join('; ')}` : 'Cadastro editado (sem mudança de nome, serial ou modo)';
    }
    return {
      id: `cadastro-${r.id}`, tipo: 'cadastro', emMs: ms(r.created_at),
      frase, detalhe: null, autor: r.operador_nome ?? null, tom: 'neutral',
    };
  });
}

// ---------- linha do tempo ----------

const ordem = (a, b) => {
  const va = Number.isFinite(a.emMs);
  const vb = Number.isFinite(b.emMs);
  if (va !== vb) return va ? -1 : 1;
  if (va && a.emMs !== b.emMs) return b.emMs - a.emMs;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

export function montarLinhaDoTempo({ fontes, filtro, agoraMs, serialAtual, modo }) {
  const visiveis = TIPOS.filter((t) => filtro === 'tudo' || filtro === t);
  const construtores = {
    manutencao: itensManutencao,
    calibracao: itensCalibracao,
    firmware: (l) => itensFirmware(l, agoraMs),
    saude: (l) => itensSaude(l, { serialAtual, modo }),
    cadastro: itensCadastro,
  };
  const itens = [];
  const avisos = [];
  const limitesAtingidos = [];
  for (const tipo of visiveis) {
    const fonte = fontes[tipo] ?? { estado: 'carregando' };
    if (fonte.estado !== 'ok') {
      const aviso = { tipo, estado: fonte.estado };
      if (fonte.estado === 'erro') aviso.erro = fonte.erro;
      avisos.push(aviso);
      continue;
    }
    itens.push(...construtores[tipo](fonte.linhas));
    if (fonte.linhas.length >= LIMITE_POR_FONTE) limitesAtingidos.push(tipo);
  }
  itens.sort(ordem);
  return { itens, avisos, limitesAtingidos };
}

// ---------- linhas de sensores ----------

function saudeDoSensor(saudeAtual, key, serial, modo) {
  if (!serial) return { tipo: 'sem-serial' };
  if (saudeAtual.estado === 'carregando') return { tipo: 'carregando' };
  if (saudeAtual.estado !== 'ok') return { tipo: 'erro', erro: saudeAtual.erro };
  const s = healthForDevice(saudeAtual.linhas, serial, modo).sensores.find((x) => x.sensor === key);
  if (!s) return { tipo: 'sem-avaliacao' };
  return {
    tipo: 'valor', estado: s.estado, label: estadoMeta(s.estado).label,
    tom: eventTone(s.estado, modo), motivo: s.motivo, desde: s.desde,
  };
}

function calibracaoDoSensor(calibracoes, sensor) {
  if (calibracoes.estado === 'carregando') return { tipo: 'carregando' };
  if (calibracoes.estado !== 'ok') return { tipo: 'erro', erro: calibracoes.erro };
  const mapa = ultimaCalibracaoPorSensor(calibracoes.linhas);
  const registro = mapa[sensor.name] ?? mapa[sensor.key];
  return registro ? { tipo: 'valor', registro } : { tipo: 'nenhuma' };
}

export function linhasSensores({ saudeAtual, calibracoes, serial, modo, firmwareCalibrado }) {
  return SENSORES_BOIA.map((s) => ({
    key: s.key,
    nome: s.name,
    saude: saudeDoSensor(saudeAtual, s.key, serial, modo),
    calibracao: calibracaoDoSensor(calibracoes, s),
    avisoFirmware: firmwareCalibrado === false,
  }));
}

// ---------- rota ----------

/** Estado da ficha: "não encontrada" só depois do cadastro carregar; fallback sem a bóia = indisponível. */
export function resolverFicha({ codigo, buoys, loading, isFallback }) {
  const buoy = (buoys ?? []).find((b) => b.codigo === codigo);
  if (buoy) return { tipo: 'encontrada', buoy };
  if (loading) return { tipo: 'carregando' };
  if (isFallback) return { tipo: 'indisponivel' };
  return { tipo: 'nao-encontrada' };
}

export const hrefFicha = (codigo) => `/admin/boias/${encodeURIComponent(codigo)}`;

// ---------- derivações das fontes ----------

/** Manutenção aberta (primeira sem timestamp_fim) da fonte: undefined (carregando) | 'erro' | registro | null. */
export function manutencaoAbertaDaFonte(fonte) {
  if (fonte?.estado === 'ok') return fonte.linhas.find((r) => !r.timestamp_fim) ?? null;
  return fonte?.estado === 'erro' ? 'erro' : undefined;
}

/** Último deploy com sucesso da fonte, no formato de estadoFirmware: undefined | {ok:false,erro} | {ok:true,valor}. */
export function ultimoDeploySucessoDaFonte(fonte) {
  if (fonte?.estado === 'ok') return { ok: true, valor: fonte.linhas.find((r) => r.status === 'sucesso') ?? null };
  return fonte?.estado === 'erro' ? { ok: false, erro: fonte.erro } : undefined;
}
