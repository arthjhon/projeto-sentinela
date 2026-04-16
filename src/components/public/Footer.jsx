import React from 'react';
import { Link } from 'react-router-dom';
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
            <li><Link to="/apoie">Apoie o Projeto</Link></li>
          </ul>
        </div>

        {/* Instituição */}
        <div className="footer-credit-col">
          <h5>Instituição</h5>
          <div className="footer-umj-row">
            <img src="/UMJ.png" alt="UMJ" className="footer-umj-logo" />
            <div className="footer-umj-info">
              <strong>UMJ</strong>
              <span>Engenharia da Computação</span>
            </div>
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
