import { useAuth } from '../contexts/AuthContext';

/**
 * true quando o usuário logado é a conta demo (role 'visualizador').
 * Usado para desabilitar (nunca esconder) controles de escrita nas páginas
 * admin — a proteção real é a RLS, isto é só a experiência de uso.
 */
export function useReadOnly() {
  const { currentUser } = useAuth();
  return currentUser?.role === 'visualizador';
}
