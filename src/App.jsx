import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { REDIRECTS_LEGADOS, legacyTarget, ehPerfilAuditoria } from './config/adminNav';

import './App.css';

const PublicLayout = lazy(() => import('./pages/public/PublicLayout'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const TeamPage = lazy(() => import('./pages/public/TeamPage'));
const SupportersPage = lazy(() => import('./pages/public/SupportersPage'));
const SupportUsPage = lazy(() => import('./pages/public/SupportUsPage'));
const MonitoringPage = lazy(() => import('./pages/public/MonitoringPage'));
const EvolucaoPage = lazy(() => import('./pages/public/EvolucaoPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));

const AdminProviders = lazy(() => import('./components/AdminProviders'));
const ProtectedRoute = lazy(() => import('./components/ProtectedRoute'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const SensorsPage = lazy(() => import('./pages/admin/SensorsPage'));
const StatusPage = lazy(() => import('./pages/admin/StatusPage'));
const ContextoPage = lazy(() => import('./pages/admin/ContextoPage'));
const UsersPage = lazy(() => import('./pages/admin/UsersPage'));
const OtaPage = lazy(() => import('./pages/admin/OtaPage'));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage'));
const ChangelogPage = lazy(() => import('./pages/admin/ChangelogPage'));
const AuditoriaPage = lazy(() => import('./pages/admin/AuditoriaPage'));
const ConfigIndex = lazy(() => import('./components/admin/ConfigIndex'));
const NotFoundPage = lazy(() => import('./pages/admin/NotFoundPage'));
const AdminSection = lazy(() => import('./components/admin/AdminSection'));
const RequireGestao = lazy(() => import('./components/admin/RequireGestao'));

const RouteLoader = () => (
  <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
    <span>Carregando...</span>
  </div>
);

const lazyElement = (Component, props = {}) => (
  <Suspense fallback={<RouteLoader />}>
    <Component {...props} />
  </Suspense>
);

// Endereço antigo do admin -> novo, mantendo ?query e #hash (favoritos, links em e-mail).
function LegacyRedirect({ antigo }) {
  const { search, hash } = useLocation();
  return <Navigate to={legacyTarget(antigo, search, hash)} replace />;
}

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
          <Route path="/evolucao" element={lazyElement(EvolucaoPage)} />
        </Route>

        {/* Auth and Admin Routes */}
        <Route element={lazyElement(AdminProviders)}>
          <Route path="/login" element={lazyElement(LoginPage)} />
          <Route path="/admin" element={lazyElement(ProtectedRoute)}>
            <Route element={lazyElement(AdminLayout)}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={lazyElement(AdminDashboard)} />
              <Route path="boias" element={lazyElement(AdminSection, { secao: 'boias', rotulo: 'Seções de Bóias' })}>
                <Route index element={<Navigate to="frota" replace />} />
                <Route path="frota" element={lazyElement(SensorsPage)} />
                <Route element={lazyElement(RequireGestao)}>
                  <Route path="firmware" element={lazyElement(OtaPage)} />
                </Route>
              </Route>
              <Route path="status" element={lazyElement(StatusPage)} />
              <Route path="contexto" element={lazyElement(ContextoPage)} />
              <Route path="config" element={lazyElement(AdminSection, { secao: 'config', rotulo: 'Seções de Configurações' })}>
                <Route index element={lazyElement(ConfigIndex)} />
                {/* Telas de gestão: o guarda único mora aqui (páginas ainda têm o próprio, redundante) */}
                <Route element={lazyElement(RequireGestao)}>
                  <Route path="site" element={lazyElement(SettingsPage)} />
                  <Route path="changelog" element={lazyElement(ChangelogPage)} />
                  <Route path="operadores" element={lazyElement(UsersPage)} />
                </Route>
                {/* Auditoria: admin e operador (a conta demo, visualizador, não lê o log) */}
                <Route element={lazyElement(RequireGestao, { permitido: ehPerfilAuditoria, mensagem: 'O log de auditoria é restrito a administradores e operadores.' })}>
                  <Route path="auditoria" element={lazyElement(AuditoriaPage)} />
                </Route>
              </Route>
              {/* Endereços antigos (antes de 2026-11-22) */}
              {Object.keys(REDIRECTS_LEGADOS).map((antigo) => (
                <Route key={antigo} path={antigo} element={<LegacyRedirect antigo={antigo} />} />
              ))}
              {/* Endereço desconhecido sob /admin: 404 do painel, não a landing pública */}
              <Route path="*" element={lazyElement(NotFoundPage)} />
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
