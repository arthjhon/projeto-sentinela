import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import './App.css';

const PublicLayout = lazy(() => import('./pages/public/PublicLayout'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const TeamPage = lazy(() => import('./pages/public/TeamPage'));
const SupportersPage = lazy(() => import('./pages/public/SupportersPage'));
const SupportUsPage = lazy(() => import('./pages/public/SupportUsPage'));
const MonitoringPage = lazy(() => import('./pages/public/MonitoringPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));

const AdminProviders = lazy(() => import('./components/AdminProviders'));
const ProtectedRoute = lazy(() => import('./components/ProtectedRoute'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const SensorsPage = lazy(() => import('./pages/admin/SensorsPage'));
const UsersPage = lazy(() => import('./pages/admin/UsersPage'));

const RouteLoader = () => (
  <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
    <span>Carregando...</span>
  </div>
);

const lazyElement = (Component) => (
  <Suspense fallback={<RouteLoader />}>
    <Component />
  </Suspense>
);

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route element={lazyElement(PublicLayout)}>
          <Route path="/" element={lazyElement(LandingPage)} />
          <Route path="/monitoramento" element={lazyElement(MonitoringPage)} />
          <Route path="/equipe" element={lazyElement(TeamPage)} />
          <Route path="/apoiadores" element={lazyElement(SupportersPage)} />
          <Route path="/apoie" element={lazyElement(SupportUsPage)} />
        </Route>

        {/* Auth and Admin Routes */}
        <Route element={lazyElement(AdminProviders)}>
          <Route path="/login" element={lazyElement(LoginPage)} />
          <Route path="/admin" element={lazyElement(ProtectedRoute)}>
            <Route element={lazyElement(AdminLayout)}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={lazyElement(AdminDashboard)} />
              <Route path="sensors" element={lazyElement(SensorsPage)} />
              <Route path="users" element={lazyElement(UsersPage)} />
            </Route>
          </Route>
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
