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
        if (profile.role === 'admin') fetchAdminUsersList();
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
      return { success: false, error: 'Credenciais inválidas no servidor NUVEM.' };
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
      if (profile.role === 'admin') fetchAdminUsersList();
    }

    setIsLoading(false);

    if (profile?.must_change_password) {
      return { success: true, mustChangePassword: true, tempUser: profile };
    }

    return { success: true, mustChangePassword: false };
  };

  // Criação exclusiva por Administradores logados usando o cliente paralelo
  const createAdminUser = async (formData, tempPassword) => {
    const email = formData.username.includes('@') ? formData.username : `${formData.username}@sentinela.app`;

    const { data, error } = await supabaseCreateUser.auth.signUp({
      email,
      password: tempPassword,
      options: {
        data: {
          name: formData.name,
          username: formData.username,
          role: formData.role
        }
      }
    });

    if (error) return { success: false, error: error.message };

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
    const { error } = await supabase.from('profiles').update(updateData).eq('id', userId);
    if (!error) {
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
