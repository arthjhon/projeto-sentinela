import React from 'react';
import { Link } from 'react-router-dom';
import { Mail, Instagram, Github } from 'lucide-react';
import './Footer.css';

const Footer = () => {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="footer-top">
        {/* Brand */}
        <div className="footer-brand">
          <img src="/Sentinela%20LOGO.svg" alt="Projeto Sentinela" className="footer-logo" />
          <p className="footer-tagline">
            Monitoramento inteligente da qualidade da água para proteger os ecossistemas da lagoa Mundaú e Manguaba.
          </p>
        </div>

        {/* Nav */}
        <div className="footer-nav-group">
          <h5>Navegação</h5>
          <ul>
            <li><Link to="/">Início</Link></li>
            <li><Link to="/monitoramento">Monitoramento</Link></li>
            <li><Link to="/equipe">Equipe</Link></li>
            <li><Link to="/apoiadores">Apoiadores</Link></li>
            <li><Link to="/evolucao">Evolução</Link></li>
            <li><Link to="/apoie">Apoie o Projeto</Link></li>
          </ul>
        </div>

        {/* Contato */}
        <div className="footer-nav-group">
          <h5>Contato</h5>
          <ul className="footer-contact-list">
            <li>
              <a href="mailto:contato@projetosentinela.com.br">
                <Mail size={16} /> contato@projetosentinela.com.br
              </a>
            </li>
            <li>
              <a href="https://instagram.com/proj.sentinela" target="_blank" rel="noopener noreferrer">
                <Instagram size={16} /> @proj.sentinela
              </a>
            </li>
            <li>
              <a href="https://github.com/arthjhon/projeto-sentinela" target="_blank" rel="noopener noreferrer">
                <Github size={16} /> GitHub
              </a>
            </li>
          </ul>
        </div>

        {/* Instituição */}
        <div className="footer-credit-col">
          <h5>Instituição</h5>
          <div className="footer-partners-row">
            <img src="/kodelab-white.png" alt="Kode.Lab" className="footer-partner-logo footer-partner-kodelab" />
            <img src="/teranex.svg" alt="TeraNex" className="footer-partner-logo footer-partner-teranex" />
            <img src="/UMJ.svg" alt="UMJ" className="footer-partner-logo footer-partner-umj" />
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <div className="footer-bottom-inner">
          <span className="footer-copy">&copy; {year} Projeto Sentinela. Todos os direitos reservados.</span>
          <span className="footer-lagoon">Protegendo a lagoa Mundaú e Manguaba.</span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
