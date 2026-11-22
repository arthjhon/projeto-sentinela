import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { LogOut, Eye } from 'lucide-react';
import { navParaPerfil } from '../../config/adminNav';
import { SystemStatusProvider } from '../../contexts/SystemStatusContext';
import StatusBadge from '../../components/admin/StatusBadge';
import './AdminLayout.css';

const AdminLayout = () => {
  const { logout, currentUser } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <SystemStatusProvider>
      <div className="admin-container">
        <div className="bg-gradient-main"></div>

        {/* Sidebar Overlay for Mobile could be added here in the future */}
      
        <aside className="admin-sidebar glass">
          <div className="sidebar-header">
            <div className="admin-logo">
              <img src="/sentinela-escudo.svg" alt="Sentinela" className="sidebar-logo-img" />
              <span>Sentinela</span>
            </div>
          </div>

          <nav className="sidebar-nav" aria-label="Menu do painel">
            {navParaPerfil(currentUser?.role).map((secao) => (
              <div key={secao.titulo} className="nav-section">
                <p className="nav-section-title">{secao.titulo}</p>
                {secao.itens.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/admin/dashboard'}
                      className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    >
                      <Icon size={20} />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="sidebar-footer">
            <div className="user-profile">
              <div className="avatar">{currentUser?.name?.charAt(0)?.toUpperCase() || 'U'}</div>
              <div className="user-info">
                <span className="user-name">{currentUser?.name || 'Usuário'}</span>
                <span className="user-role" style={{textTransform: 'capitalize'}}>{currentUser?.role || 'Visitante'}</span>
              </div>
            </div>
            <button onClick={handleLogout} className="logout-btn">
              <LogOut size={18} />
              Sair
            </button>
          </div>
        </aside>

        <main className="admin-main">
          <header className="admin-header glass">
            <h2>Centro de Comando</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              {currentUser?.role === 'visualizador' && (
                <span className="badge badge-warning">
                  <Eye size={14} /> Modo Demonstração — Somente Leitura
                </span>
              )}
              <StatusBadge />
            </div>
          </header>

          <div className="admin-content animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </SystemStatusProvider>
  );
};

export default AdminLayout;
