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
  BOIA_REINICIAR:    'boia.reiniciar',
  MANUTENCAO_INICIO: 'manutencao.iniciar',
  MANUTENCAO_FIM:    'manutencao.finalizar',
  MANUTENCAO_CANCELAR: 'manutencao.cancelar',
  SENSOR_CALIBRAR:   'sensor.calibrar',
  FIRMWARE_DEPLOY:   'firmware.deploy',
  CONFIG_ALTERAR:    'config.alterar',
  USUARIO_CRIAR:     'usuario.criar',
  USUARIO_EDITAR:    'usuario.editar',
  USUARIO_REMOVER:   'usuario.remover',
  USUARIO_RESET_SENHA: 'usuario.reset_senha',
  CHANGELOG_CRIAR:   'changelog.criar',
  CHANGELOG_EDITAR:  'changelog.editar',
  CHANGELOG_REMOVER: 'changelog.remover',
};

/** Teto de linhas de uma consulta; a tela avisa quando ele é atingido. */
export const LIMITE_AUDITORIA = 200;

/** Rótulos legíveis para a UI de filtro. */
export const AUDIT_LABELS = {
  [AUDIT.BOIA_CRIAR]:        'Bóia criada',
  [AUDIT.BOIA_EDITAR]:       'Bóia editada',
  [AUDIT.BOIA_REMOVER]:      'Bóia removida',
  [AUDIT.BOIA_REINICIAR]:    'Placa reiniciada (comando remoto)',
  [AUDIT.MANUTENCAO_INICIO]: 'Manutenção iniciada',
  [AUDIT.MANUTENCAO_FIM]:    'Manutenção finalizada',
  [AUDIT.MANUTENCAO_CANCELAR]: 'Manutenção cancelada',
  [AUDIT.SENSOR_CALIBRAR]:   'Sensor calibrado',
  [AUDIT.FIRMWARE_DEPLOY]:   'Firmware implantado',
  [AUDIT.CONFIG_ALTERAR]:    'Configuração alterada',
  [AUDIT.USUARIO_CRIAR]:     'Usuário criado',
  [AUDIT.USUARIO_EDITAR]:    'Usuário editado',
  [AUDIT.USUARIO_REMOVER]:   'Usuário removido',
  [AUDIT.USUARIO_RESET_SENHA]: 'Senha resetada por admin',
  [AUDIT.CHANGELOG_CRIAR]:   'Entrada de changelog criada',
  [AUDIT.CHANGELOG_EDITAR]:  'Entrada de changelog editada',
  [AUDIT.CHANGELOG_REMOVER]: 'Entrada de changelog removida',
};

/**
 * Monta a linha de audit_logs. NÃO leva `operador_nome`: o servidor (trigger
 * audit_logs_set_operador) preenche a partir de profiles, e a policy exige
 * operador_id = auth.uid(). Nome vindo do cliente seria forjável.
 * Devolve null sem usuário logado.
 */
export function montarRegistro(user, acao, entidadeAfetada, detalhes) {
  if (!user) return null;
  return {
    operador_id: user.id,
    acao,
    entidade_afetada: entidadeAfetada ?? null,
    detalhes: detalhes ?? {},
  };
}

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
    const registro = montarRegistro(user, acao, entidadeAfetada, detalhes);
    if (!registro) throw new Error('sem sessão');

    const { error } = await supabase.from('audit_logs').insert(registro);
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
export async function listarAuditoria({ operador, acao, limite = LIMITE_AUDITORIA } = {}) {
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

/**
 * Eventos de uma entidade (ex.: código da bóia) para as ações dadas, mais
 * recente primeiro. Lança em erro de leitura.
 */
export async function listarAuditoriaDaEntidade(entidade, acoes, limite) {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('entidade_afetada', entidade)
    .in('acao', acoes)
    .order('created_at', { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);
  return data ?? [];
}
