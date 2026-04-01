import React from 'react';
import { Map, Info } from 'lucide-react';
import './About.css';

const About = () => {
  return (
    <section id="about" className="about-section section-container">
      <div className="section-header">
        <h2 className="section-title">O Coração de Alagoas</h2>
        <p className="section-subtitle">
          Entenda a importância vital do complexo estuarino-lagunar Mundaú-Manguaba.
        </p>
      </div>

      <div className="about-grid">
        <div className="about-card glass animate-fade-in">
          <div className="card-icon-wrapper">
            <Info className="card-icon" />
          </div>
          <h3>Nossa Missão</h3>
          <p>
            O Projeto Sentinela dedica-se a monitorar, analisar e relatar a qualidade da água das lagoas Mundaú e Manguaba, protegendo o ecossistema e assegurando o sustento de milhares de famílias que dependem da pesca e da cata do sururu.
          </p>
        </div>

        <div className="about-card glass animate-fade-in delay-100">
          <div className="card-icon-wrapper map-icon">
            <Map className="card-icon" />
          </div>
          <h3>O Complexo Estuarino</h3>
          <p>
            Localizado no litoral de Alagoas, este ecossistema abriga uma biodiversidade única. A interação entre as águas doces dos rios e a água salgada do oceano cria o habitat perfeito para o desenvolvimento do sururu (Mytella charruana).
          </p>
        </div>
      </div>

      <div className="about-stats glass">
        <div className="stat-item">
          <span className="stat-value">2</span>
          <span className="stat-label">Lagoas Monitoradas</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">Constante</span>
          <span className="stat-label">Análise de Qualidade</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">Milhares</span>
          <span className="stat-label">Vidas Impactadas</span>
        </div>
      </div>
    </section>
  );
};

export default About;
