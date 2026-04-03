import React from 'react';
import { Award, Building2, Cpu, Globe, ArrowRight } from 'lucide-react';

const SupportersPage = () => {
  return (
    <div className="public-page-container">
      <div className="text-center mb-5">
        <h1 className="gradient-text mb-3">Nossos Apoiadores</h1>
        <p className="subtitle mx-auto" style={{ maxWidth: '750px' }}>
          O Projeto Sentinela ganha vida e flutua sobre as águas devido à confiança e colaboração de instituições, universidades e mentes inovadoras.
        </p>
      </div>

      <div className="glass p-4 rounded text-center mb-5 animate-fade-in" style={{ border: '1px solid rgba(0,240,255,0.2)', background: 'linear-gradient(135deg, rgba(0,240,255,0.05) 0%, transparent 100%)' }}>
        <Building2 size={40} color="var(--primary)" className="mb-3 mx-auto" />
        <h2 className="mb-2">Centro Universitário Mário Pontes Jucá (UMJ)</h2>
        <p className="text-muted">Apoio Acadêmico Primário e base de desenvolvimento da Engenharia da Computação.</p>
      </div>

      <h3 className="mb-4 text-center">Fomentadores em Tecnologia e Infraestrutura</h3>
      
      <div className="grid-3 mt-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem' }}>
        
        <div className="glass p-4 rounded text-center animate-fade-in" style={{ animationDelay: '0.1s' }}>
           <Cpu size={36} color="var(--warning)" className="mb-3 mx-auto" />
           <h4 className="mb-2 text-white">Fabricantes IoT</h4>
           <p className="text-muted" style={{ fontSize: '0.9rem' }}>Suporte logístico nos componentes do ESP32, sensores de Turbidez DFRobot e termômetros industriais adaptados.</p>
        </div>

        <div className="glass p-4 rounded text-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
           <Globe size={36} color="var(--success)" className="mb-3 mx-auto" />
           <h4 className="mb-2 text-white">Redes e Conectividade</h4>
           <p className="text-muted" style={{ fontSize: '0.9rem' }}>Provedores de conexão móvel (4G/GSM) que permitem o ping constante do estuário para os nossos bancos de dados Cloud.</p>
        </div>

        <div className="glass p-4 rounded text-center animate-fade-in" style={{ animationDelay: '0.3s' }}>
           <Award size={36} color="var(--danger)" className="mb-3 mx-auto" />
           <h4 className="mb-2 text-white">Órgãos Ambientais Locais</h4>
           <p className="text-muted" style={{ fontSize: '0.9rem' }}>Apoio e direcionamento técnico na calibração do ph e índices ideais de respiração para o ecossistema do sururu.</p>
        </div>
      </div>

      <div className="mt-5 text-center mt-5 pt-5 border-top-dark animate-fade-in" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <h3>Sua marca pode estar aqui</h3>
        <p className="text-muted mb-4 mt-2">Torne-se um apoiador corporativo do projeto ambiental mais revolucionário da tecnologia alagoana.</p>
        <a href="/apoie" className="btn btn-primary" style={{ display: 'inline-flex', padding: '0.8rem 2rem', fontWeight: 'bold' }}>
          Junte-se à Causa <ArrowRight size={18} style={{ marginLeft: '0.5rem' }} />
        </a>
      </div>
    </div>
  );
};

export default SupportersPage;
