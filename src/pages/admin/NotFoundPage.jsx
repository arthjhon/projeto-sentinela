import React from 'react';
import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

// 404 dentro do painel: endereço /admin/... desconhecido não joga o operador para o site público.
export default function NotFoundPage() {
  return (
    <div className="dashboard-content-area">
      <div className="alert-permission glass" role="alert">
        <Compass size={32} className="mb-3" aria-hidden="true" />
        <h2>Página não encontrada</h2>
        <p>Este endereço não existe no painel.</p>
        <Link to="/admin/dashboard" className="btn-primary">Ir para a Visão geral</Link>
      </div>
    </div>
  );
}
