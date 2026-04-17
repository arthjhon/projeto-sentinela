import React from 'react';
import { Award, Cpu, Globe, ArrowRight } from 'lucide-react';
import './SupportersPage.css';

const SupportersPage = () => {
  return (
    <div className="supporters-page">
      <div className="text-center mb-5">
        <h1 className="gradient-text mb-3">Nossos Apoiadores</h1>
        <p className="subtitle mx-auto" style={{ maxWidth: '650px' }}>
          O Projeto Sentinela ganha vida e flutua sobre as águas devido à confiança e colaboração de
          instituições, universidades e mentes inovadoras.
        </p>
      </div>

      {/* UMJ — apoio primário */}
      <div className="umj-card glass animate-fade-in">
        <img src="/UMJ.png" alt="Logotipo do Centro Universitário Mário Pontes Jucá" className="umj-logo" />
        <div className="umj-info">
          <h2>Centro Universitário Mário Pontes Jucá (UMJ)</h2>
          <p>Apoio Acadêmico Primário e base de desenvolvimento da Engenharia da Computação. A UMJ fornece a infraestrutura laboratorial, mentoria técnica e fomento à pesquisa aplicada que tornam o projeto viável.</p>
        </div>
      </div>

      {/* Teranex — parceiro tecnológico */}
      <div className="umj-card glass animate-fade-in" style={{ animationDelay: '0.15s' }}>
        <img src="/teranex.svg" alt="Logotipo da Teranex" className="umj-logo teranex-logo" />
        <div className="umj-info">
          <h2>Teranex</h2>
          <p>Parceira tecnológica no fornecimento de infraestrutura, soluções de conectividade e suporte ao desenvolvimento de hardware embarcado para as bóias de monitoramento.</p>
        </div>
      </div>

      <h3 className="mb-4 text-center">Fomentadores em Tecnologia e Infraestrutura</h3>

      <div className="supporters-grid">
        <div className="supporter-card glass animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <Cpu size={36} color="var(--warning)" />
          <h4>Fabricantes IoT</h4>
          <p>Suporte logístico nos componentes do ESP32, sensores de Turbidez DFRobot e termômetros industriais adaptados.</p>
        </div>

        <div className="supporter-card glass animate-fade-in" style={{ animationDelay: '0.2s' }}>
          <Globe size={36} color="var(--success)" />
          <h4>Redes e Conectividade</h4>
          <p>Provedores de conexão móvel (4G/GSM) que permitem o ping constante do estuário para os nossos bancos de dados Cloud.</p>
        </div>

        <div className="supporter-card glass animate-fade-in" style={{ animationDelay: '0.3s' }}>
          <Award size={36} color="var(--danger)" />
          <h4>Órgãos Ambientais Locais</h4>
          <p>Apoio e direcionamento técnico na calibração do pH e índices ideais de respiração para o ecossistema do sururu.</p>
        </div>
      </div>

      <div className="supporters-cta animate-fade-in">
        <h3>Sua marca pode estar aqui</h3>
        <p>Torne-se um apoiador corporativo do projeto ambiental mais revolucionário da tecnologia alagoana.</p>
        <a href="/apoie" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', padding: '0.8rem 2rem', fontWeight: 'bold' }}>
          Junte-se à Causa <ArrowRight size={18} style={{ marginLeft: '0.5rem' }} />
        </a>
      </div>
    </div>
  );
};

export default SupportersPage;
