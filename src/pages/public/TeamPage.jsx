import React from 'react';
import { Github, Linkedin, Mail } from 'lucide-react';
import './TeamPage.css';

const teamMembers = [
  {
    name: 'Arthur Jhonathas',
    role: 'Desenvolvimento Full Stack',
    tag: 'Coordenacao Tecnica',
    bio: 'Responsavel pela arquitetura da plataforma, integracao entre dashboard, sensores e experiencia publica do Projeto Sentinela.',
  },
  {
    name: 'Equipe de Campo',
    role: 'Coleta e Monitoramento',
    tag: 'Operacoes',
    bio: 'Atua na instalacao das boias, manutencao dos dispositivos e acompanhamento das medicoes no complexo estuarino.',
  },
  {
    name: 'Pesquisadores Parceiros',
    role: 'Analise Ambiental',
    tag: 'Pesquisa',
    bio: 'Transformam os dados capturados em insumos para estudos, validacao tecnica e apoio a decisoes sobre a saude das lagoas.',
  },
];

const socialLinks = [
  { icon: Github, href: 'https://github.com/', label: 'GitHub' },
  { icon: Linkedin, href: 'https://www.linkedin.com/', label: 'LinkedIn' },
  { icon: Mail, href: 'mailto:contato@projetosentinela.com.br', label: 'Email' },
];

const createAvatar = (name) => {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
      <rect width="120" height="120" rx="60" fill="#0f172a" />
      <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="40" font-weight="700">
        ${initials}
      </text>
    </svg>
  `;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const TeamPage = () => {
  return (
    <div className="public-page-container">
      <div className="text-center mb-5">
        <h1 className="gradient-text mb-3">Quem Move o Projeto</h1>
        <p className="subtitle mx-auto" style={{ maxWidth: '760px' }}>
          O Sentinela une desenvolvimento, pesquisa e operacao em campo para acompanhar a qualidade ambiental das lagoas e fortalecer a preservacao do sururu.
        </p>
      </div>

      <div className="team-grid">
        {teamMembers.map((member, index) => (
          <article
            key={member.name}
            className="team-card animate-fade-in"
            style={{ animationDelay: `${0.1 * (index + 1)}s` }}
          >
            <div className="card-top-accent" />
            <div className="member-avatar" aria-hidden="true">
              <img
                src={createAvatar(member.name)}
                alt={member.name}
              />
            </div>
            <span className="member-tag">{member.tag}</span>
            <h2 className="member-name">{member.name}</h2>
            <p className="member-role text-primary mb-3">{member.role}</p>
            <p className="member-bio text-muted mb-4">{member.bio}</p>

            <div className="member-socials">
              {socialLinks.map(({ icon: Icon, href, label }) => (
                <a
                  key={`${member.name}-${label}`}
                  className="social-btn"
                  href={href}
                  target={href.startsWith('http') ? '_blank' : undefined}
                  rel={href.startsWith('http') ? 'noreferrer' : undefined}
                  aria-label={`${label} de ${member.name}`}
                >
                  <Icon size={18} />
                </a>
              ))}
            </div>
          </article>
        ))}
      </div>

      <section className="umj-banner mt-5 text-center animate-fade-in" style={{ animationDelay: '0.4s' }}>
        <h3 className="text-white mb-2">Base academica e colaborativa</h3>
        <p className="text-muted mb-0" style={{ maxWidth: '820px', margin: '0 auto' }}>
          O projeto se desenvolve com apoio de parceiros, estudantes e pesquisadores comprometidos com tecnologia aplicada a impacto ambiental real em Alagoas.
        </p>
      </section>
    </div>
  );
};

export default TeamPage;
