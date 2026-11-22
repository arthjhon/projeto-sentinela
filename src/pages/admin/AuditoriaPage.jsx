import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import AuditLogPanel from '../../components/admin/AuditLogPanel';
import { ehPerfilGestao } from '../../config/adminNav';
import AcessoNegado from '../../components/admin/AcessoNegado';

// Aba Auditoria de Configurações (/admin/config/auditoria). Mesma guarda de
// perfil da tela de operadores, de onde ela saiu.
const AuditoriaPage = () => {
  const { users, currentUser } = useAuth();

  if (!ehPerfilGestao(currentUser?.role)) {
    return <AcessoNegado>Você não possui privilégios de Administrador para consultar o log de auditoria.</AcessoNegado>;
  }

  return (
    <div className="dashboard-content-area">
      <div className="page-header">
        <h1>Log de Auditoria</h1>
        <p>Quem fez o quê no painel, com data e detalhes.</p>
      </div>
      <AuditLogPanel operadores={users} />
    </div>
  );
};

export default AuditoriaPage;
