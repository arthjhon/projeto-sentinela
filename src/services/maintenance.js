import { supabase } from '../lib/supabase';
import { logAcao, AUDIT } from './auditLog';

// Manutenção (3.1) e calibração (3.2).
//
// boia_id é TEXT ('SM-01') e não FK: a frota mora em config/fleet.js, não no
// Postgres. Ver supabase_backlog_schema.sql.

/** Nome do operador logado, para gravar junto do registro. */
async function operadorAtual() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { id: null, nome: 'desconhecido' };
  const { data: perfil } = await supabase
    .from('profiles').select('username').eq('id', user.id).single();
  return { id: user.id, nome: perfil?.username ?? user.email ?? 'desconhecido' };
}

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

/** Fecha a manutenção aberta da bóia (preenche timestamp_fim). */
export async function finalizarManutencao(boiaId, observacao) {
  const { data: aberta, error: errBusca } = await supabase
    .from('maintenance_logs')
    .select('id, motivo')
    .eq('boia_id', boiaId)
    .is('timestamp_fim', null)
    .maybeSingle();

  if (errBusca) throw new Error(errBusca.message);
  if (!aberta) throw new Error('Não há manutenção aberta para esta bóia.');

  const fim = new Date().toISOString();
  const { data, error } = await supabase
    .from('maintenance_logs')
    .update({
      timestamp_fim: fim,
      // observação do fechamento é anexada ao motivo: a tabela guarda um
      // registro por manutenção, não um por evento
      motivo: observacao?.trim()
        ? `${aberta.motivo}\n— Conclusão: ${observacao.trim()}`
        : aberta.motivo,
    })
    .eq('id', aberta.id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  logAcao(AUDIT.MANUTENCAO_FIM, boiaId, { observacao: observacao?.trim() || null });
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

/** Manutenção aberta da bóia, se houver (para a UI saber o estado real). */
export async function manutencaoAberta(boiaId) {
  const { data, error } = await supabase
    .from('maintenance_logs')
    .select('*')
    .eq('boia_id', boiaId)
    .is('timestamp_fim', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// ── 3.2 Calibração ────────────────────────────────────────────

/** Registra uma calibração de sensor. */
export async function registrarCalibracao(boiaId, sensorKey, observacao) {
  const op = await operadorAtual();
  const { data, error } = await supabase
    .from('sensor_calibrations')
    .insert({
      boia_id: boiaId,
      sensor_key: sensorKey,
      operador_id: op.id,
      operador_nome: op.nome,
      observacao: observacao?.trim() || null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  logAcao(AUDIT.SENSOR_CALIBRAR, boiaId, { sensor: sensorKey });
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
