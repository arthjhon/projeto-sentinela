import React from 'react';
import { Shield } from 'lucide-react';
import './AcessoNegado.css';

// Bloco "Acesso Negado" das telas de gestão. O estilo mora junto do componente
// para funcionar em qualquer tela aberta direto (cada página é um chunk lazy).
const AcessoNegado = ({ children }) => (
  <div className="dashboard-content-area">
    <div className="alert-permission glass" role="alert">
      <Shield size={32} className="text-danger mb-3" />
      <h2>Acesso Negado</h2>
      <p>{children}</p>
    </div>
  </div>
);

export default AcessoNegado;
