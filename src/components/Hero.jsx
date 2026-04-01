import React from 'react';
import { Droplet } from 'lucide-react';
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
        
        <div className="hero-actions animate-fade-in delay-300">
          <a href="#water-quality" className="btn btn-primary">
            Ver Indicadores
          </a>
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
