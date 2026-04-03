import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Droplet, Menu, X, Shield, Users, HeartHandshake, Rocket, Activity } from 'lucide-react';
import './PublicNavbar.css';
import './PublicNavbar.css';

const PublicNavbar = () => {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const location = useLocation();

  const toggleMenu = () => setIsMobileOpen(!isMobileOpen);

  const isActive = (path) => {
    return location.pathname === path ? 'active' : '';
  };

  const navLinks = [
    { name: 'O Projeto', path: '/', icon: <Rocket size={18} /> },
    { name: 'Analytics', path: '/monitoramento', icon: <Activity size={18} /> },
    { name: 'A Equipe', path: '/equipe', icon: <Users size={18} /> },
    { name: 'Apoiadores', path: '/apoiadores', icon: <HeartHandshake size={18} /> },
  ];

  return (
    <nav className="public-navbar glass">
      <div className="navbar-container">
        {/* LOGO */}
        <Link to="/" className="navbar-brand">
          <div className="brand-icon">
            <Droplet size={24} color="var(--primary)" />
          </div>
          <span className="brand-text">Proj. Sentinela</span>
        </Link>

        {/* DESKTOP MENU */}
        <div className="navbar-menu desktop-only">
          <ul className="nav-links">
            {navLinks.map((link) => (
              <li key={link.path}>
                <Link to={link.path} className={`nav-link ${isActive(link.path)}`}>
                  {link.icon}
                  {link.name}
                </Link>
              </li>
            ))}
          </ul>
          
          <div className="nav-actions">
            <Link to="/apoie" className="btn btn-warning nav-btn-apoie">
              Apoie a Causa
            </Link>
            <Link to="/login" className="btn btn-outline nav-btn-admin">
              <Shield size={16} /> Acesso Restrito
            </Link>
          </div>
        </div>

        {/* MOBILE TOGGLE */}
        <div className="mobile-toggle mobile-only" onClick={toggleMenu}>
          {isMobileOpen ? <X size={28} /> : <Menu size={28} />}
        </div>
      </div>

      {/* MOBILE MENU PANEL */}
      {isMobileOpen && (
        <div className="mobile-menu glass animate-fade-in">
          <ul className="mobile-nav-links">
            {navLinks.map((link) => (
              <li key={link.path}>
                <Link to={link.path} className={`nav-link ${isActive(link.path)}`} onClick={toggleMenu}>
                  {link.icon} {link.name}
                </Link>
              </li>
            ))}
            <li>
              <Link to="/apoie" className="nav-link text-warning" onClick={toggleMenu}>
                <HeartHandshake size={18} /> Apoie a Causa
              </Link>
            </li>
            <li className="mobile-divider"></li>
            <li>
              <Link to="/login" className="nav-link text-primary" onClick={toggleMenu}>
                <Shield size={18} /> Acesso Restrito
              </Link>
            </li>
          </ul>
        </div>
      )}
    </nav>
  );
};

export default PublicNavbar;
