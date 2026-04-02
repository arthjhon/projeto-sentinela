import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { LogOut, LayoutDashboard, ActivitySquare, ShieldAlert, Users } from 'lucide-react';
import './AdminLayout.css';

const AdminLayout = () => {
  const { logout, currentUser } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <div className="admin-container">
      <div className="bg-gradient-main"></div>

      {/* Sidebar Overlay for Mobile could be added here in the future */}
      
      <aside className="admin-sidebar glass">
        <div className="sidebar-header">
          <div className="admin-logo">
            <ShieldAlert size={24} className="text-primary" />
            <span>Admin Sentinela</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <NavLink 
            to="/admin/dashboard" 
            end
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <LayoutDashboard size={20} />
            <span>Painel Geral</span>
          </NavLink>

          <NavLink 
            to="/admin/sensors" 
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <ActivitySquare size={20} />
            <span>Sensores e Bóias</span>
          </NavLink>

          {currentUser?.role === 'admin' && (
            <NavLink 
              to="/admin/users" 
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Users size={20} />
              <span>Gerenciar Usuários</span>
            </NavLink>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="avatar">{currentUser?.name?.charAt(0).toUpperCase() || 'U'}</div>
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
          <h2>Painel de Controle Restrito</h2>
          <div className="header-status">
            <span className="status-dot green"></span>
            Sistema Operacional
          </div>
        </header>

        <div className="admin-content animate-fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default AdminLayout;
