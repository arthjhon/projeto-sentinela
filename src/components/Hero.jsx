import React from 'react';
import { Link } from 'react-router-dom';
import { Droplet, Activity } from 'lucide-react';
import './Hero.css';

const Hero = () => {
  return (
    <section className="hero-section">
      <div className="hero-content section-container">
        <div className="hero-badge animate-fade-in">
          <Droplet size={18} className="badge-icon" />
          <span>Monitoramento Ambiental</span>
        </div>
        
        <h1 className="hero-title animate-fade-in delay-100">
          Projeto Sentinela
          <span className="hero-title-highlight"> Conservação Mundaú & Manguaba</span>
        </h1>
        
        <p className="hero-description animate-fade-in delay-200">
          Analisando a qualidade da água e o impacto vital na vida marinha do complexo estuarino-lagunar. Dados precisos para preservar nossa biodiversidade e economia local.
        </p>
        
        <div className="hero-actions animate-fade-in delay-300" style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
          <Link to="/monitoramento" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.8rem 2rem', fontSize: '1.1rem' }}>
             <Activity size={20} /> Acessar Analytics
          </Link>
          <a href="#about" className="btn btn-secondary">
            Conheça o Projeto
          </a>
        </div>
      </div>
      
      {/* Decorative Elements */}
      <div className="hero-blob blob-1"></div>
      <div className="hero-blob blob-2"></div>
    </section>
  );
};

export default Hero;
