import React from 'react';
import { Outlet } from 'react-router-dom';
import PublicNavbar from '../../components/public/PublicNavbar';
import Footer from '../../components/public/Footer';

const PublicLayout = () => {
  return (
    <div className="app-container">
      <div className="bg-gradient-main"></div>
      <PublicNavbar />

      <div style={{ paddingTop: '75px', minHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column' }}>
        <main className="main-content animate-fade-in" style={{ flex: 1 }}>
          <Outlet />
        </main>

        <Footer />
      </div>
    </div>
  );
};

export default PublicLayout;
