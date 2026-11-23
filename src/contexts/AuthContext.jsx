import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

// FunctionsHttpError traz a Response original em `context` — é onde está a
// mensagem real (ex: "senha muito curta", "não é admin").
async function mensagemDaFuncao(error) {
  try {
    return (await error.context?.json())?.error || error.message;
  } catch {
    // corpo não era JSON (ex: timeout, function não encontrada)
    return error.message;
  }
}

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  // Lista central de usuários
  const [users, setUsers] = useState([]);
  // true quando a lista não pôde ser lida: a UI mostra "indisponível", não uma lista vazia.
  const [usersError, setUsersError] = useState(false);

  // Admin lê a tabela inteira (RLS: profiles só abre outras linhas para admin).
  // Operador e visualizador recebem só id, nome e papel pela RPC operadores_lista:
  // o username é parte da credencial e não sai do servidor para eles.
  const fetchAdminUsersList = useCallback(async (role) => {
    try {
      const { data, error } = role === 'admin'
        ? await supabase.from('profiles').select('*').order('created_at', { ascending: true })
        : await supabase.rpc('operadores_lista');
      if (error || !data) throw error ?? new Error('sem dados');
      setUsers(data);
      setUsersError(false);
    } catch (e) {
      console.error('lista de operadores indisponível:', e?.message ?? e);
      setUsersError(true);
    }
  }, []);

  // Busca o profile do usuário com até 4 tentativas (trigger PostgreSQL pode demorar ms após o signup)
  const fetchUserProfile = useCallback(async (authUser) => {
    try {
      for (let attempt = 0; ; attempt++) {
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', authUser.id)
          .single();

        if (profile) {
          setCurrentUser(profile);
          setIsAuthenticated(true);
          setAuthError(null);
          fetchAdminUsersList(profile.role);
          break;
        }
        if (!error && attempt < 4) {
          // Profile ainda não foi criado pela trigger — aguarda e tenta novamente
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
        setAuthError('Não foi possível carregar seu perfil. Tente fazer login novamente.');
        console.error('fetchUserProfile falhou:', error);
        break;
      }
    } catch (e) {
      setAuthError('Erro de conexão ao carregar perfil.');
      console.error('fetchUserProfile exception:', e);
    }
    setIsLoading(false);
  }, [fetchAdminUsersList]);

  useEffect(() => {
    // Apenas dois eventos precisam de ação:
    //   INITIAL_SESSION — sessão persistida no localStorage (F5 / reload)
    //   SIGNED_OUT      — logout ou sessão expirada
    // SIGNED_IN é ignorado aqui pois login() já busca e seta o profile diretamente.
    // TOKEN_REFRESHED e USER_UPDATED não exigem re-fetch do profile.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        if (session) {
          fetchUserProfile(session.user);
        } else {
          setIsLoading(false);
        }
      } else if (event === 'SIGNED_OUT') {
        setIsAuthenticated(false);
        setCurrentUser(null);
        setUsers([]);
        setUsersError(false);
        setIsLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchUserProfile]);

  const login = async (username, password) => {
    const normalizedInput = username.toLowerCase().trim();
    const isEmail = normalizedInput.includes('@');
    const primaryEmail = isEmail ? normalizedInput : `${normalizedInput}@sentinela.app`;

    let authData = null;
    let signInError = null;

    const primary = await supabase.auth.signInWithPassword({ email: primaryEmail, password });

    if (primary.error) {
      // Fallback para contas legadas: só tenta @sentinela.local se o input foi
      // um username (sem @) E o erro foi de credencial (status 400), não de rede
      const isCredentialError = primary.error.status === 400;
      if (!isEmail && isCredentialError) {
        const legacyEmail = `${normalizedInput}@sentinela.local`;
        const fallback = await supabase.auth.signInWithPassword({ email: legacyEmail, password });
        if (!fallback.error) {
          authData = fallback.data;
        } else {
          signInError = primary.error;
        }
      } else {
        signInError = primary.error;
      }
    } else {
      authData = primary.data;
    }

    if (signInError || !authData) {
      return { success: false, error: 'ERRO: Credenciais inválidas.' };
    }

    // Fetch do profile feito aqui — onAuthStateChange está bloqueado pelo pendingLoginRef
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (profile) {
      setCurrentUser(profile);
      setIsAuthenticated(true);
      setAuthError(null);
      fetchAdminUsersList(profile.role);
    }

    setIsLoading(false);

    if (profile?.must_change_password) {
      return { success: true, mustChangePassword: true, tempUser: profile };
    }

    return { success: true, mustChangePassword: false };
  };

  // Criação de usuário — via Edge Function (admin-create-user): o role nunca
  // pode ser decidido a partir de metadata que um signup público aceitaria de
  // qualquer chamador. A function confirma server-side que quem chama é admin
  // antes de criar a conta e promover o role pedido.
  const createAdminUser = async (formData, tempPassword) => {
    const { data, error } = await supabase.functions.invoke('admin-create-user', {
      body: {
        name: formData.name,
        username: formData.username,
        password: tempPassword,
        role: formData.role,
      },
    });
    if (error) return { success: false, error: await mensagemDaFuncao(error) };
    if (!data?.success) return { success: false, error: 'Falha ao criar usuário.' };

    fetchAdminUsersList(currentUser?.role);
    return { success: true };
  };

  // Exclusão via Edge Function (admin-delete-user): apaga a conta em auth.users
  // (o cascade remove o profile), o que de fato revoga o acesso. Apagar só a
  // linha de profiles deixava login e senha válidos. Sem remoção otimista: a
  // linha só some da tela quando o servidor confirmou.
  const deleteAdminUser = async (userId) => {
    const { data, error } = await supabase.functions.invoke('admin-delete-user', {
      body: { userId },
    });
    if (error) return { success: false, error: await mensagemDaFuncao(error) };
    if (!data?.success) return { success: false, error: 'Falha ao excluir usuário.' };
    setUsers(prev => prev.filter(u => u.id !== userId));
    return { success: true };
  };

  const editAdminUser = async (userId, payload) => {
    const updateData = { role: payload.role, name: payload.name };
    // .select().single() é proposital: sem isso, RLS bloqueando a escrita
    // retorna 200 com 0 linhas e nenhum erro — parecia "sucesso" sem gravar
    // nada. .single() força um erro real quando nenhuma linha volta.
    const { error } = await supabase.from('profiles').update(updateData).eq('id', userId).select().single();
    if (!error) {
      fetchAdminUsersList(currentUser?.role);
      return { success: true };
    }
    return { success: false, error: error.message };
  };

  // Reset de senha de OUTRO usuário — chamado pelo admin em /admin/operadores.
  // Roda via Edge Function (admin-reset-password): a API Admin do Auth exige a
  // service_role key, que nunca pode chegar ao bundle do navegador.
  const resetUserPassword = async (userId, newPassword) => {
    const { data, error } = await supabase.functions.invoke('admin-reset-password', {
      body: { userId, newPassword },
    });
    if (error) return { success: false, error: await mensagemDaFuncao(error) };
    return { success: true, ...data };
  };

  const updatePassword = async (userId, newPassword) => {
    const { error: authError } = await supabase.auth.updateUser({ password: newPassword });
    if (authError) return false;

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ must_change_password: false })
      .eq('id', userId);

    if (profileError) return false;

    fetchUserProfile({ id: userId });
    return true;
  };

  const logout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{
      isAuthenticated,
      currentUser,
      isLoading,
      authError,
      login,
      logout,
      users,
      usersError,
      setUsers,
      updatePassword,
      resetUserPassword,
      fetchAdminUsersList,
      createAdminUser,
      deleteAdminUser,
      editAdminUser
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
