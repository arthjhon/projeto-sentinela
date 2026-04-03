import React from 'react';
import { Outlet } from 'react-router-dom';
import PublicNavbar from '../../components/public/PublicNavbar';

const PublicLayout = () => {
  return (
    <div className="app-container">
      <div className="bg-gradient-main"></div>
      <PublicNavbar />
      
      <div style={{ paddingTop: '75px', minHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column' }}>
        <main className="main-content animate-fade-in" style={{ flex: 1 }}>
          <Outlet />
        </main>

        <footer style={{ marginTop: '4rem', borderTop: '1px solid rgba(255,255,255,0.1)', padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', background: 'rgba(5, 8, 15, 0.8)' }}>
          <p>&copy; {new Date().getFullYear()} Projeto Sentinela. Protegendo a lagoa Mundaú e Manguaba.</p>
          <p style={{ fontSize: '0.85rem', marginTop: '0.5rem', color: 'var(--primary)' }}>Engenharia da Computação - UMJ</p>
        </footer>
      </div>
    </div>
  );
};

export default PublicLayout;
