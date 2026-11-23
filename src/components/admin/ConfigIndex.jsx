import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { destinoIndiceConfig } from '../../config/adminRoutes';

/** Índice de /admin/config: cada perfil cai na primeira aba que enxerga (operador: Auditoria). */
export default function ConfigIndex() {
  const { currentUser } = useAuth();
  return <Navigate to={destinoIndiceConfig(currentUser?.role)} replace />;
}
