import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase, supabaseCreateUser } from '../lib/supabase';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  // Lista central de usuários
  const [users, setUsers] = useState([]);

  useEffect(() => {
    // 1. Pega a sessão ativa caso de F5
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        fetchUserProfile(session.user);
      } else {
        setIsLoading(false);
      }
    });

    // 2. Escuta mudanças na autenticação
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        if (!currentUser || currentUser.id !== session.user.id) {
           fetchUserProfile(session.user);
        }
      } else {
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
        if (profile.role === 'admin') fetchAdminUsersList();
      } else if (!error && attempt < 4) {
        // Profile ainda não foi criado pela trigger — aguarda e tenta novamente
        setTimeout(() => fetchUserProfile(authUser, attempt + 1), 500);
        return; // não chama setIsLoading ainda; o retry finaliza
      } else {
        // Esgotou tentativas ou erro real no banco
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
    if(data) setUsers(data);
  };

  const login = async (username, password) => {
    const normalizedInput = username.toLowerCase().trim();
    let email = normalizedInput.includes('@') ? normalizedInput : `${normalizedInput}@sentinela.app`;
    
    // Conecta no Supabase Auth
    let { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    
    // Fallback para contas legadas criadas antes da mudança de domínio
    if (authError && !normalizedInput.includes('@')) {
      const legacyEmail = `${normalizedInput}@sentinela.local`;
      const fallbackAttempt = await supabase.auth.signInWithPassword({ email: legacyEmail, password });
      if (!fallbackAttempt.error) {
         authData = fallbackAttempt.data;
         authError = null;
      }
    }

    if (authError) {
      return { success: false, error: 'Credenciais inválidas no servidor NUVEM.' };
    }
    
    // Observa o profile pra ver se deve trocar a senha provisória
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', authData.user.id).single();
    
    if (profile?.must_change_password) {
      return { success: true, mustChangePassword: true, tempUser: profile };
    }

    return { success: true, mustChangePassword: false };
  };

  // Criação exclusiva por Administradores logados usando o cliente paralelo
  const createAdminUser = async (formData, tempPassword) => {
    const email = formData.username.includes('@') ? formData.username : `${formData.username}@sentinela.app`;
    
    // Cria sem derrubar a auth local
    const { data, error } = await supabaseCreateUser.auth.signUp({
      email: email,
      password: tempPassword,
      options: {
        data: {
          name: formData.name,
          username: formData.username,
          role: formData.role
        }
      }
    });

    if (error) {
      return { success: false, error: error.message };
    }

    // Refresh na lista de usuários pro Dashboard
    fetchAdminUsersList();
    return { success: true };
  };

  const deleteAdminUser = async (userId) => {
    // Exclusão Otimista: remove da tela imediatamente para UX fluida
    setUsers(prev => prev.filter(u => u.id !== userId));

    const { error } = await supabase.from('profiles').delete().eq('id', userId);

    if (!error) {
      return { success: true };
    }

    // Falhou no servidor — desfaz o otimismo buscando a lista original
    await fetchAdminUsersList();
    return { success: false, error: error.message };
  };

  const editAdminUser = async (userId, payload) => {
    // Altera Role do profile (apenas Admin pode)
    let updateData = { role: payload.role, name: payload.name };
    const { error } = await supabase.from('profiles').update(updateData).eq('id', userId);
    if (!error) {
      // Se tiver payload.password, tenta mudar pela admin API ou diz que precisa forçar email?
      // O Supabase impede alteração da senha de terceiros no panel public. Então a mudança de senha 
      // debaixo dos panos exigiria uma Cloud Function. Vamos apenas atualizar o profile.
       fetchAdminUsersList();
       return { success: true };
    }
    return { success: false, error: error.message };
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
