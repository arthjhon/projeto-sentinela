// Regras puras da tela de Operadores: máscara por perfil, guardas de role e de
// exclusão (M2) e guarda de envio duplo (M3). Sem React, testável em Node.

/** Só o admin vê a credencial (username) e o estado de troca de senha. Falha fechado. */
export function mascararOperadores(users, role) {
  if (role === 'admin') return users;
  return users.map(({ id, name, role: r }) => ({ id, name, role: r }));
}

export const contarAdmins = (users) => users.filter((u) => u.role === 'admin').length;

/** Alterar a própria role ou rebaixar o último admin é bloqueado. */
export function validarMudancaRole({ alvoId, novaRole, usuarioAtualId, users }) {
  const alvo = users.find((u) => u.id === alvoId);
  if (!alvo || alvo.role === novaRole) return { ok: true };
  if (alvoId === usuarioAtualId) {
    return { ok: false, motivo: 'Você não pode alterar o seu próprio nível de acesso.' };
  }
  if (alvo.role === 'admin' && contarAdmins(users) <= 1) {
    return { ok: false, motivo: 'Não é possível rebaixar o último administrador.' };
  }
  return { ok: true };
}

/** Excluir a si mesmo ou o último admin é bloqueado. */
export function validarExclusao({ alvoId, usuarioAtualId, users }) {
  if (alvoId === usuarioAtualId) {
    return { ok: false, motivo: 'Você não pode excluir a sua própria conta.' };
  }
  const alvo = users.find((u) => u.id === alvoId);
  if (alvo?.role === 'admin' && contarAdmins(users) <= 1) {
    return { ok: false, motivo: 'Não é possível excluir o último administrador.' };
  }
  return { ok: true };
}

/**
 * Guarda de envio duplo: enquanto uma tarefa roda, novas chamadas são ignoradas
 * (devolvem undefined). Libera ao terminar, inclusive se lançar.
 */
export function criarGuardaEnvio() {
  let ocupado = false;
  const guarda = async (tarefa) => {
    if (ocupado) return undefined;
    ocupado = true;
    try {
      return await tarefa();
    } finally {
      ocupado = false;
    }
  };
  guarda.ocupado = () => ocupado;
  return guarda;
}
