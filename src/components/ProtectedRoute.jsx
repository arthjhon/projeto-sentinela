import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const ProtectedRoute = () => {
  const { isAuthenticated, isLoading, authError } = useAuth();

  if (isLoading) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '1rem', color: '#94a3b8' }}>
        <span>Carregando sessão...</span>
      </div>
    );
  }

  if (authError) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '1rem', color: '#f87171', textAlign: 'center', padding: '2rem' }}>
        <span style={{ fontSize: '1.1rem' }}>{authError}</span>
        <a href="/login" style={{ color: '#00f0ff', fontSize: '0.9rem' }}>Voltar ao login</a>
      </div>
    );
  }

  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
};

export default ProtectedRoute;
