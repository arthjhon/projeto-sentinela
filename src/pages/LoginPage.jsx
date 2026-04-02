import React, { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Droplet, Lock, User, LogIn, KeyRound, ShieldCheck } from 'lucide-react';
import './LoginPage.css';

const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  
  // States for Temporary Password Flow
  const [isResetting, setIsResetting] = useState(false);
  const [tempUser, setTempUser] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const navigate = useNavigate();
  const { login, updatePassword, isAuthenticated } = useAuth();

  if (isAuthenticated && !isResetting) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    const result = await login(username, password);
    
    if (result && result.success) {
      if (result.mustChangePassword) {
        setTempUser(result.tempUser);
        setIsResetting(true);
      } else {
        navigate('/admin/dashboard');
      }
    } else {
      // Compatibility fallback or strictly error if updated user logic fully matches
      if (!result) {
         setError('Acesso negado.');
      } else {
         setError(result.error || 'Credenciais inválidas.');
      }
    }
  };

  const handlePasswordReset = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (newPassword.length < 6) {
      setError('A nova senha deve ter no mínimo 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('As senhas digitadas não batem. Repita exatamente igual.');
      return;
    }

    const updated = await updatePassword(tempUser.id, newPassword);
    if (updated) {
      setSuccessMsg('Senha alterada com sucesso! Redirecionando...');
      setTimeout(() => {
        navigate('/admin/dashboard');
      }, 1500);
    } else {
      setError('Erro interno ao atualizar usuário.');
    }
  };

  return (
    <div className="login-container">
      <div className="bg-gradient-main"></div>
      
      <div className={`login-card glass ${isResetting ? 'reset-mode' : ''} animate-fade-in`}>
        
        {!isResetting ? (
          <>
            <div className="login-header">
              <div className="login-logo">
                <Droplet size={32} color="var(--primary)" />
              </div>
              <h2>Acesso Restrito</h2>
              <p>Painel de Controle - Projeto Sentinela</p>
            </div>

            {error && <div className="login-error">{error}</div>}

            <form onSubmit={handleLogin} className="login-form">
              <div className="input-group">
                <div className="input-icon">
                  <User size={18} />
                </div>
                <input 
                  type="text" 
                  placeholder="Usuário (Ex: admin)" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>

              <div className="input-group">
                <div className="input-icon">
                  <Lock size={18} />
                </div>
                <input 
                  type="password" 
                  placeholder="Senha" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="btn btn-primary login-btn">
                <LogIn size={18} />
                <span>Entrar no Sistema</span>
              </button>
            </form>
            
            <div className="login-footer">
              <a href="/">← Voltar para a página inicial</a>
            </div>
          </>
        ) : (
          /* TEMPORARY PASSWORD RENEWAL UI */
          <div className="reset-container animate-fade-in">
            <div className="login-header">
              <div className="login-logo warning">
                <KeyRound size={32} color="var(--warning)" />
              </div>
              <h2>Senha Temporária</h2>
              <p>Olá, {tempUser?.name}. Para sua segurança, defina uma senha definitiva antes de entrar no painel.</p>
            </div>

            {error && <div className="login-error">{error}</div>}
            {successMsg && <div className="login-success"><ShieldCheck size={18}/> {successMsg}</div>}

            <form onSubmit={handlePasswordReset} className="login-form mt-4">
              <div className="input-group">
                <div className="input-icon">
                  <Lock size={18} />
                </div>
                <input 
                  type="password" 
                  placeholder="Nova Senha Profissional" 
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>

              <div className="input-group">
                <div className="input-icon">
                  <Lock size={18} />
                </div>
                <input 
                  type="password" 
                  placeholder="Repita a Nova Senha" 
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="btn btn-warning login-btn">
                <span>Gravar Definitivo e Acessar</span>
              </button>
            </form>
          </div>
        )}

      </div>
    </div>
  );
};

export default LoginPage;
