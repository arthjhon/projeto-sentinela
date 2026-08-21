import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  // Lista central de usuários
  const [users, setUsers] = useState([]);

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
        setIsLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Busca o profile do usuário com até 4 tentativas (trigger PostgreSQL pode demorar ms após o signup)
  const fetchUserProfile = async (authUser, attempt = 0) => {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (profile) {
        setCurrentUser(profile);
        setIsAuthenticated(true);
        setAuthError(null);
        if (profile.role === 'admin' || profile.role === 'visualizador') fetchAdminUsersList();
      } else if (!error && attempt < 4) {
        // Profile ainda não foi criado pela trigger — aguarda e tenta novamente
        setTimeout(() => fetchUserProfile(authUser, attempt + 1), 500);
        return; // não chama setIsLoading ainda; o retry finaliza
      } else {
        setAuthError('Não foi possível carregar seu perfil. Tente fazer login novamente.');
        console.error('fetchUserProfile falhou:', error);
      }
    } catch (e) {
      setAuthError('Erro de conexão ao carregar perfil.');
      console.error('fetchUserProfile exception:', e);
    }
    setIsLoading(false);
  };

  const fetchAdminUsersList = async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
    if (data) setUsers(data);
  };

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
      if (profile.role === 'admin' || profile.role === 'visualizador') fetchAdminUsersList();
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
    if (error) {
      let serverMsg = null;
      try {
        serverMsg = (await error.context?.json())?.error;
      } catch {
        // corpo não era JSON (ex: timeout, function não encontrada) — usa error.message mesmo
      }
      return { success: false, error: serverMsg || error.message };
    }
    if (!data?.success) return { success: false, error: 'Falha ao criar usuário.' };

    fetchAdminUsersList();
    return { success: true };
  };

  const deleteAdminUser = async (userId) => {
    // Exclusão Otimista: remove da tela imediatamente para UX fluida
    setUsers(prev => prev.filter(u => u.id !== userId));

    const { error } = await supabase.from('profiles').delete().eq('id', userId);

    if (!error) return { success: true };

    // Falhou no servidor — desfaz o otimismo buscando a lista original
    await fetchAdminUsersList();
    return { success: false, error: error.message };
  };

  const editAdminUser = async (userId, payload) => {
    const updateData = { role: payload.role, name: payload.name };
    // .select().single() é proposital: sem isso, RLS bloqueando a escrita
    // retorna 200 com 0 linhas e nenhum erro — parecia "sucesso" sem gravar
    // nada. .single() força um erro real quando nenhuma linha volta.
    const { error } = await supabase.from('profiles').update(updateData).eq('id', userId).select().single();
    if (!error) {
      fetchAdminUsersList();
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
    if (error) {
      // FunctionsHttpError traz a Response original em `context` — é onde está
      // a mensagem de erro real (ex: "senha muito curta", "não é admin").
      let serverMsg = null;
      try {
        serverMsg = (await error.context?.json())?.error;
      } catch {
        // corpo não era JSON (ex: timeout, function não encontrada) — usa error.message mesmo
      }
      return { success: false, error: serverMsg || error.message };
    }
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
