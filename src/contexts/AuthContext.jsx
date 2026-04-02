import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase, supabaseCreateUser } from '../lib/supabase';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  
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

  const fetchUserProfile = async (authUser) => {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .single();
        
      if (profile) {
        setCurrentUser(profile);
        setIsAuthenticated(true);
        if (profile.role === 'admin') fetchAdminUsersList();
      } else if (!error) {
        // Fallback: Autenticado mas ainda sem profile sync (muito rápido)
        // Isso acontece pq enviamos o form, o backend auth loga na hora, e a trigger PostgreSQL pode demorar ms.
        setTimeout(() => fetchUserProfile(authUser), 500); 
        return;
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
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
    // Exclusão Otimista: Removemos da tela instantaneamente para UX Premium
    setUsers(prev => prev.filter(u => u.id !== userId));

    // A deleção profunda bloqueada na camada auth será feita superficialmente no Profiles,
    // o que cega e remove o acesso do fulano no sistema (já que tudo bloqueia se não houver Profile)
    const { error } = await supabase.from('profiles').delete().eq('id', userId);
    
    if (!error) {
       await fetchAdminUsersList(); 
       return { success: true };
    }
    
    // Se falhar na nuvem, busca a lista original de volta (Rollback)
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
