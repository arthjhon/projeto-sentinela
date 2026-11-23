import { supabase } from '../lib/supabase';
import { logAcao, AUDIT } from './auditLog';

// Manutenção (3.1) e calibração (3.2).
//
// boia_id é TEXT ('SM-01') e não FK: a frota mora em config/fleet.js, não no
// Postgres. Ver supabase_backlog_schema.sql.

/**
 * Nome gravado junto do registro: nome de exibição, nunca username nem e-mail
 * (o e-mail é <username>@sentinela.app e a conta demo lê estas tabelas). O
 * servidor sobrescreve o valor por trigger a partir de profiles.name; este é
 * só o valor de partida, exigido pelo NOT NULL.
 */
export function nomeDoOperador(perfil) {
  return perfil?.name || 'desconhecido';
}

async function operadorAtual() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { id: null, nome: 'desconhecido' };
  const { data: perfil } = await supabase
    .from('profiles').select('name').eq('id', user.id).single();
  return { id: user.id, nome: nomeDoOperador(perfil) };
}

/** Calibração: observação mínima (padrão/solução usada). */
export const MIN_OBSERVACAO = 10;

/** Observação obrigatória da calibração: >= 10 caracteres úteis. */
export function validarObservacaoCalibracao(texto) {
  const limpo = typeof texto === 'string' ? texto.trim() : '';
  if (limpo.length < MIN_OBSERVACAO) {
    return { ok: false, texto: limpo, erro: `Descreva o padrão ou a solução usada (mínimo ${MIN_OBSERVACAO} caracteres).` };
  }
  return { ok: true, texto: limpo, erro: null };
}

/** `error.code` de "não há manutenção aberta": a UI recarrega em vez de manter um painel velho. */
export const SEM_MANUTENCAO_ABERTA = 'SEM_MANUTENCAO_ABERTA';

// ── 3.1 Manutenção ────────────────────────────────────────────

/**
 * Abre uma manutenção. O índice único do schema garante que só exista uma
 * aberta por bóia — se já houver, o insert falha e devolvemos a mensagem.
 */
export async function iniciarManutencao(boiaId, motivo) {
  const op = await operadorAtual();
  const { data, error } = await supabase
    .from('maintenance_logs')
    .insert({
      boia_id: boiaId,
      operador_id: op.id,
      operador_nome: op.nome,
      motivo: motivo.trim(),
    })
    .select()
    .single();

  if (error) {
    // 23505 = unique_violation -> já existe manutenção aberta para esta bóia
    if (error.code === '23505') {
      throw new Error('Esta bóia já está em modo manutenção.');
    }
    throw new Error(error.message);
  }

  logAcao(AUDIT.MANUTENCAO_INICIO, boiaId, { motivo: motivo.trim() });
  return data;
}

/** Registro aberto (id, motivo) da bóia; lança se a leitura falhar ou não houver. */
async function buscarAberta(boiaId) {
  const { data: aberta, error } = await supabase
    .from('maintenance_logs')
    .select('id, motivo')
    .eq('boia_id', boiaId)
    .is('timestamp_fim', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!aberta) {
    throw Object.assign(new Error('Não há manutenção aberta para esta bóia.'), { code: SEM_MANUTENCAO_ABERTA });
  }
  return aberta;
}

async function fecharRegistro(id, campos) {
  const { data, error } = await supabase
    .from('maintenance_logs')
    .update(campos)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** Fecha a manutenção aberta da bóia (preenche timestamp_fim). */
export async function finalizarManutencao(boiaId, observacao) {
  const aberta = await buscarAberta(boiaId);
  const data = await fecharRegistro(aberta.id, {
    timestamp_fim: new Date().toISOString(),
    // observação do fechamento é anexada ao motivo: a tabela guarda um
    // registro por manutenção, não um por evento
    motivo: observacao?.trim()
      ? `${aberta.motivo}\n— Conclusão: ${observacao.trim()}`
      : aberta.motivo,
  });
  logAcao(AUDIT.MANUTENCAO_FIM, boiaId, { observacao: observacao?.trim() || null });
  return data;
}

/** Campos do UPDATE que cancela: fecha o registro (timestamp_fim), anota "cancelada" e as notas digitadas, se houver. */
export function montarCancelamento(aberta, fimIso, notas) {
  const extra = notas?.trim() ? `\n— Notas: ${notas.trim()}` : '';
  return { timestamp_fim: fimIso, motivo: `${aberta.motivo}\n— Manutenção cancelada${extra}` };
}

/**
 * Cancela a manutenção aberta de verdade: fecha o registro (timestamp_fim = agora)
 * com a nota "cancelada" (mais as notas já digitadas, se houver; não exige notas).
 * A bóia sai de "em manutenção" no painel e no worker; o registro fica no histórico.
 */
export async function cancelarManutencao(boiaId, notas) {
  const aberta = await buscarAberta(boiaId);
  const data = await fecharRegistro(aberta.id, montarCancelamento(aberta, new Date().toISOString(), notas));
  logAcao(AUDIT.MANUTENCAO_CANCELAR, boiaId, { cancelada: true, notas: notas?.trim() || null });
  return data;
}

/** Histórico de manutenções da bóia, mais recente primeiro. */
export async function listarManutencoes(boiaId) {
  const { data, error } = await supabase
    .from('maintenance_logs')
    .select('*')
    .eq('boia_id', boiaId)
    .order('timestamp_inicio', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Manutenção aberta da bóia, se houver (para a UI saber o estado real). Com
 * mais de uma aberta (maybeSingle lançaria), vale a mais recente: continua "aberta".
 */
export async function manutencaoAberta(boiaId) {
  const { data, error } = await supabase
    .from('maintenance_logs')
    .select('*')
    .eq('boia_id', boiaId)
    .is('timestamp_fim', null)
    .order('timestamp_inicio', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Manutenção aberta de várias bóias numa só consulta (timestamp_fim nulo).
 * @returns {Promise<Record<string, object|null>>} codigo -> registro mais recente aberto | null
 */
export async function manutencoesAbertas(codigos) {
  const { data, error } = await supabase
    .from('maintenance_logs')
    .select('*')
    .is('timestamp_fim', null)
    .order('timestamp_inicio', { ascending: false });
  if (error) throw new Error(error.message);
  const porBoia = Object.fromEntries(codigos.map((c) => [c, null]));
  for (const m of data ?? []) {
    const atual = porBoia[m.boia_id];
    if (m.boia_id in porBoia && (!atual || Date.parse(m.timestamp_inicio) > Date.parse(atual.timestamp_inicio))) porBoia[m.boia_id] = m;
  }
  return porBoia;
}

// ── 3.2 Calibração ────────────────────────────────────────────

/**
 * Registra que uma calibração foi realizada (não calibra nada: o protocolo é
 * feito na bancada). A observação (padrão/solução usada, >= 10 caracteres) é obrigatória.
 */
export async function registrarCalibracao(boiaId, sensorKey, observacao) {
  const valida = validarObservacaoCalibracao(observacao);
  if (!valida.ok) throw new Error(valida.erro);
  const op = await operadorAtual();
  const { data, error } = await supabase
    .from('sensor_calibrations')
    .insert({
      boia_id: boiaId,
      sensor_key: sensorKey,
      operador_id: op.id,
      operador_nome: op.nome,
      observacao: valida.texto,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  logAcao(AUDIT.SENSOR_CALIBRAR, boiaId, { sensor: sensorKey, observacao: valida.texto });
  return data;
}

/**
 * Última calibração de cada sensor da bóia.
 * @returns {Promise<Record<string, object>>} sensor_key -> registro
 */
export async function ultimasCalibracoes(boiaId) {
  const { data, error } = await supabase
    .from('sensor_calibrations')
    .select('*')
    .eq('boia_id', boiaId)
    .order('calibrated_at', { ascending: false });
  if (error) throw new Error(error.message);

  // primeira ocorrência de cada sensor = a mais recente (já vem ordenado)
  const porSensor = {};
  for (const c of data ?? []) {
    if (!porSensor[c.sensor_key]) porSensor[c.sensor_key] = c;
  }
  return porSensor;
}
