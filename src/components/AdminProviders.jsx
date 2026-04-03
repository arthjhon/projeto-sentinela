import React from 'react';
import { Outlet } from 'react-router-dom';
import { AuthProvider } from '../contexts/AuthContext';
import { ToastProvider } from '../contexts/ToastContext';

const AdminProviders = () => {
  return (
    <ToastProvider>
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    </ToastProvider>
  );
};

export default AdminProviders;
