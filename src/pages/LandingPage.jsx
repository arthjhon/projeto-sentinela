import React from 'react';
import Hero from '../components/Hero';
import About from '../components/About';
import WaterQuality from '../components/WaterQuality';
import MarineLife from '../components/MarineLife';
import DashboardPreview from '../components/DashboardPreview';
import '../App.css';

const LandingPage = () => {
  return (
    <div className="app-container">
      <div className="bg-gradient-main"></div>
      <main className="main-content">
        <Hero />
        <About />
        <WaterQuality />
        <MarineLife />
        <DashboardPreview />
      </main>
      <footer className="footer">
        <p>&copy; {new Date().getFullYear()} Projeto Sentinela. Protegendo a lagoa Mundaú e Manguaba.</p>
      </footer>
    </div>
  );
};

export default LandingPage;
