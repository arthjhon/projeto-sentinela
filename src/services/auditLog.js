import { supabase } from '../lib/supabase';

// Log de auditoria (backlog 6.1).
//
// Regra de ouro: auditar NUNCA pode derrubar a ação auditada. Se o insert
// falhar (rede, RLS, tabela ausente), a função engole o erro e devolve false —
// perder um registro de log é ruim, mas impedir o operador de trabalhar por
// causa do log é pior. A falha vai para o console para não sumir em silêncio.
//
// A tabela é append-only por RLS: não há policy de UPDATE nem de DELETE, nem
// para admin. Log que o próprio operador apaga não é auditoria.

/** Ações instrumentadas. Usar as constantes evita divergência de grafia
 *  entre quem escreve e quem filtra na listagem. */
export const AUDIT = {
  BOIA_CRIAR:        'boia.criar',
  BOIA_EDITAR:       'boia.editar',
  BOIA_REMOVER:      'boia.remover',
  MANUTENCAO_INICIO: 'manutencao.iniciar',
  MANUTENCAO_FIM:    'manutencao.finalizar',
  SENSOR_CALIBRAR:   'sensor.calibrar',
  FIRMWARE_DEPLOY:   'firmware.deploy',
  CONFIG_ALTERAR:    'config.alterar',
  USUARIO_CRIAR:     'usuario.criar',
  USUARIO_EDITAR:    'usuario.editar',
  USUARIO_REMOVER:   'usuario.remover',
};

/** Rótulos legíveis para a UI de filtro. */
export const AUDIT_LABELS = {
  [AUDIT.BOIA_CRIAR]:        'Bóia criada',
  [AUDIT.BOIA_EDITAR]:       'Bóia editada',
  [AUDIT.BOIA_REMOVER]:      'Bóia removida',
  [AUDIT.MANUTENCAO_INICIO]: 'Manutenção iniciada',
  [AUDIT.MANUTENCAO_FIM]:    'Manutenção finalizada',
  [AUDIT.SENSOR_CALIBRAR]:   'Sensor calibrado',
  [AUDIT.FIRMWARE_DEPLOY]:   'Firmware implantado',
  [AUDIT.CONFIG_ALTERAR]:    'Configuração alterada',
  [AUDIT.USUARIO_CRIAR]:     'Usuário criado',
  [AUDIT.USUARIO_EDITAR]:    'Usuário editado',
  [AUDIT.USUARIO_REMOVER]:   'Usuário removido',
};

/**
 * Registra uma ação. Nunca lança.
 * @param {string} acao              uma das constantes AUDIT
 * @param {string} entidadeAfetada   alvo da ação (ex: 'SM-01')
 * @param {object} detalhes          contexto livre (vai para JSONB)
 * @returns {Promise<boolean>}       true se gravou
 */
export async function logAcao(acao, entidadeAfetada, detalhes = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    let nome = 'desconhecido';
    if (user) {
      const { data: perfil } = await supabase
        .from('profiles').select('username').eq('id', user.id).single();
      nome = perfil?.username ?? user.email ?? 'desconhecido';
    }

    const { error } = await supabase.from('audit_logs').insert({
      operador_id: user?.id ?? null,
      operador_nome: nome,
      acao,
      entidade_afetada: entidadeAfetada ?? null,
      detalhes,
    });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[auditoria] não foi possível registrar a ação:', acao, err?.message ?? err);
    return false;
  }
}

/**
 * Lista o log, mais recente primeiro.
 * @param {{operador?: string, acao?: string, limite?: number}} filtros
 */
export async function listarAuditoria({ operador, acao, limite = 200 } = {}) {
  let q = supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limite);

  if (operador) q = q.eq('operador_id', operador);
  if (acao) q = q.eq('acao', acao);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}
