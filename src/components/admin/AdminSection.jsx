import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { abasDaSecao } from '../../config/adminNav';
import './AdminSection.css';

/**
 * Seção do painel com abas que são rotas (Bóias, Configurações): faixa de abas
 * sob o cabeçalho + a aba atual. Com menos de 2 abas visíveis para o perfil, a
 * faixa não aparece.
 */
const AdminSection = ({ secao, rotulo }) => {
  const { currentUser } = useAuth();
  const abas = abasDaSecao(secao, currentUser?.role);

  return (
    <>
      {abas.length > 1 && (
        <nav className="section-tabs" aria-label={rotulo}>
          {abas.map((aba) => (
            <NavLink
              key={aba.to}
              to={aba.to}
              className={({ isActive }) => `section-tab ${isActive ? 'active' : ''}`}
            >
              {aba.label}
            </NavLink>
          ))}
        </nav>
      )}
      <Outlet />
    </>
  );
};

export default AdminSection;
