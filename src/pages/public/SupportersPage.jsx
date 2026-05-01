import React from 'react';
import { ArrowRight, FlaskConical, Cpu, Wifi, Leaf, Laptop, DollarSign, Building2, GraduationCap } from 'lucide-react';
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

      {/* KodeLab UMJ — laboratório de desenvolvimento */}
      <div className="umj-card glass animate-fade-in" style={{ animationDelay: '0.3s' }}>
        <div className="kodelab-logo-wrap">
          <img src="/kodelab-white.png" alt="Ícone do KodeLab UMJ" className="kodelab-icon-img" />
          <img src="/kodelab-text-white.png" alt="Nome do KodeLab UMJ" className="kodelab-text-img" />
        </div>
        <div className="umj-info">
          <h2>Kode.Lab UMJ</h2>
          <p>Laboratório de pesquisa e desenvolvimento da UMJ, responsável pelo suporte técnico no desenvolvimento da plataforma web e integração dos sistemas embarcados do Projeto Sentinela.</p>
        </div>
      </div>

      {/* Impacto dos Apoiadores */}
      <section className="sp-section animate-fade-in">
        <h3 className="sp-section-title">Impacto dos Apoiadores</h3>
        <div className="impact-grid">
          <div className="impact-card glass">
            <span className="impact-number">3</span>
            <span className="impact-label">Bóias Ativas</span>
          </div>
          <div className="impact-card glass">
            <span className="impact-number">+500</span>
            <span className="impact-label">Leituras por Dia</span>
          </div>
          <div className="impact-card glass">
            <span className="impact-number">6+</span>
            <span className="impact-label">Meses de Monitoramento</span>
          </div>
          <div className="impact-card glass">
            <span className="impact-number">1</span>
            <span className="impact-label">Ecossistema Protegido</span>
          </div>
        </div>
      </section>

      {/* Áreas de Atuação */}
      <section className="sp-section animate-fade-in">
        <h3 className="sp-section-title">Áreas de Atuação</h3>
        <div className="areas-grid">
          <div className="area-card glass">
            <FlaskConical size={32} color="var(--primary)" />
            <h4>Pesquisa Acadêmica</h4>
            <p>Desenvolvimento de metodologias, análise dos dados e publicação dos resultados científicos obtidos pelo monitoramento contínuo do estuário.</p>
          </div>
          <div className="area-card glass">
            <Cpu size={32} color="var(--warning)" />
            <h4>Hardware & Sensoriamento</h4>
            <p>Projeto e montagem das bóias com ESP32, sensores de turbidez, temperatura e pH calibrados para o ambiente estuarino alagoano.</p>
          </div>
          <div className="area-card glass">
            <Wifi size={32} color="var(--success)" />
            <h4>Conectividade & Cloud</h4>
            <p>Transmissão 4G/GSM dos dados coletados em campo e armazenamento seguro em bancos de dados na nuvem em tempo real.</p>
          </div>
          <div className="area-card glass">
            <Leaf size={32} color="#4ade80" />
            <h4>Monitoramento Ambiental</h4>
            <p>Acompanhamento contínuo das condições do estuário para preservação do ecossistema e sustentabilidade da cultura do sururu.</p>
          </div>
        </div>
      </section>

      {/* Como Apoiar */}
      <section className="sp-section animate-fade-in">
        <h3 className="sp-section-title">Como Apoiar</h3>
        <div className="areas-grid">
          <div className="area-card glass">
            <Laptop size={32} color="var(--primary)" />
            <h4>Parceria Tecnológica</h4>
            <p>Contribua com hardware, software ou infraestrutura para a expansão e manutenção das bóias de monitoramento em campo.</p>
          </div>
          <div className="area-card glass">
            <DollarSign size={32} color="var(--warning)" />
            <h4>Patrocínio Financeiro</h4>
            <p>Financie a pesquisa, aquisição de componentes e manutenção contínua do sistema de monitoramento ambiental do estuário.</p>
          </div>
          <div className="area-card glass">
            <Building2 size={32} color="var(--success)" />
            <h4>Apoio Institucional</h4>
            <p>Empresas e órgãos governamentais podem endossar e ampliar o alcance do projeto junto à comunidade e aos órgãos ambientais.</p>
          </div>
          <div className="area-card glass">
            <GraduationCap size={32} color="#4ade80" />
            <h4>Mentoria Técnica</h4>
            <p>Profissionais especializados em IoT, ciência de dados ou ecologia podem contribuir com conhecimento e orientação estratégica.</p>
          </div>
        </div>
      </section>

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
