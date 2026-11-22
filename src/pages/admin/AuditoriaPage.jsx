import React from 'react';
import { Shield } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import AuditLogPanel from '../../components/admin/AuditLogPanel';
import { PERFIS_GESTAO } from '../../config/adminNav';

// Aba Auditoria de Configurações (/admin/config/auditoria). Mesma guarda de
// perfil da tela de operadores, de onde ela saiu.
const AuditoriaPage = () => {
  const { users, currentUser } = useAuth();

  if (!PERFIS_GESTAO.includes(currentUser?.role)) {
    return (
      <div className="dashboard-content-area">
        <div className="alert-permission glass mt-4">
          <Shield size={32} className="text-danger mb-3" />
          <h2>Acesso Negado</h2>
          <p>Você não possui privilégios de Administrador para consultar o log de auditoria.</p>
        </div>
      </div>
    );
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
