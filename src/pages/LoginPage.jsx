import React, { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Droplet, Lock, User, LogIn } from 'lucide-react';
import './LoginPage.css';

const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuth();

  // Se já estiver logado, manda direto pro painel
  if (isAuthenticated) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  const handleLogin = (e) => {
    e.preventDefault();
    const success = login(username, password);
    if (success) {
      navigate('/admin/dashboard');
    } else {
      setError('Credenciais inválidas. Tente admin / admin123');
    }
  };

  return (
    <div className="login-container">
      <div className="bg-gradient-main"></div>
      
      <div className="login-card glass animate-fade-in">
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
              placeholder="Usuário" 
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
      </div>
    </div>
  );
};

export default LoginPage;
