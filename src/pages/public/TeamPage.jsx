import React from 'react';
import { Linkedin, Github, Mail, GraduationCap, Code } from 'lucide-react';
import './TeamPage.css';

const TeamPage = () => {
  const teamMembers = [
    {
      name: 'Arthur Jhonathas',
      role: 'Engenheiro de Infraestrutura & IoT',
      bio: 'Responsável pela hospedagem e manutenção da plataforma web, administração do banco de dados em nuvem e pela camada de comunicação MQTT das bóias de monitoramento.',
      image: 'https://api.dicebear.com/7.x/notionists/svg?seed=Arthur&backgroundColor=00f0ff',
      tag: 'Infraestrutura'
    },
    {
      name: 'Maycon Vinicius',
      role: 'Desenvolvedor de Firmware',
      bio: 'Responsável pela programação do microcontrolador ESP32 embarcado nas bóias, incluindo leitura de sensores, transmissão de dados e atualizações OTA.',
      image: 'https://api.dicebear.com/7.x/notionists/svg?seed=Maycon&backgroundColor=ffaa00',
      tag: 'Firmware'
    },
    {
      name: 'Anwar Quirino',
      role: 'Desenvolvedor de Firmware',
      bio: 'Atua no desenvolvimento e testes do firmware embarcado no ESP32, garantindo a confiabilidade da coleta e envio dos dados dos sensores.',
      image: 'https://api.dicebear.com/7.x/notionists/svg?seed=Anwar&backgroundColor=00f0ff',
      tag: 'Firmware'
    },
    {
      name: 'Luiz Henrique',
      role: 'Engenheiro de Hardware',
      bio: 'Responsável pela montagem e integração dos sensores nas bóias, garantindo a correta instalação dos componentes físicos do sistema de monitoramento.',
      image: 'https://api.dicebear.com/7.x/notionists/svg?seed=Luiz&backgroundColor=ff3b3b',
      tag: 'Hardware'
    },
    {
      name: 'Pedro Henrique',
      role: 'Engenheiro de Hardware',
      bio: 'Atua na montagem dos sensores e na validação física dos componentes eletrônicos das bóias de monitoramento estuarino.',
      image: 'https://api.dicebear.com/7.x/notionists/svg?seed=Pedro&backgroundColor=8800ff',
      tag: 'Hardware'
    },
    {
      name: 'Marcos Paulo',
      role: 'Analista de Documentação Técnica',
      bio: 'Responsável pelo registro e organização de toda a documentação técnica do projeto, desde especificações de hardware até fluxos de software e relatórios acadêmicos.',
      image: 'https://api.dicebear.com/7.x/notionists/svg?seed=Marcos&backgroundColor=00ff88',
      tag: 'Documentação'
    },
  ];

  return (
    <div className="public-page-container">
      <div className="team-header text-center mb-5">
        <h1 className="gradient-text mb-3">Pesquisadores do Projeto</h1>
        <p className="subtitle mx-auto" style={{ maxWidth: '700px' }}>
          Corpo acadêmico da <strong>Engenharia da Computação da UMJ</strong>. Uma equipe multidisciplinar unindo hardware, software e preservação ambiental.
        </p>
      </div>

      <div className="team-grid mt-5">
        {teamMembers.map((member, index) => (
          <div key={index} className="team-card glass animate-fade-in" style={{ animationDelay: `${index * 0.15}s` }}>
            <div className="card-top-accent"></div>
            <div className="member-avatar">
               <img src={member.image} alt={member.name} />
            </div>
            
            <span className="member-tag">{member.tag}</span>
            <h3 className="member-name">{member.name}</h3>
            <p className="member-role text-primary mb-3">
              <Code size={14} className="mr-1"/> {member.role}
            </p>
            <p className="member-bio text-muted">{member.bio}</p>
            
            <div className="member-socials mt-4">
               <a href="#" className="social-btn"><Linkedin size={18}/></a>
               <a href="#" className="social-btn"><Github size={18}/></a>
               <a href="#" className="social-btn"><Mail size={18}/></a>
            </div>
          </div>
        ))}
      </div>

      {/* Orientador */}
      <div className="advisor-card glass animate-fade-in mt-5">
        <div className="advisor-avatar">
          <img
            src="https://api.dicebear.com/7.x/notionists/svg?seed=PedroLopes&backgroundColor=0a498a"
            alt="Prof. Pedro Henrique Lopes"
          />
        </div>
        <div className="advisor-info">
          <span className="member-tag" style={{ marginBottom: '0.5rem', display: 'inline-block' }}>Orientador Acadêmico</span>
          <h3>Prof. Pedro Henrique de Meneses Bittencourt Lopes</h3>
          <p className="member-role text-primary" style={{ margin: '0.4rem 0 0.75rem' }}>
            <GraduationCap size={14} style={{ marginRight: '0.3rem' }} />
            Engenharia Mecatrônica & Matemática
          </p>
          <p className="text-muted" style={{ fontSize: '0.92rem', lineHeight: '1.6' }}>
            Responsável pela orientação acadêmica e direcionamento científico do Projeto Sentinela, assegurando o rigor técnico e a relevância ambiental da pesquisa aplicada.
          </p>
        </div>
      </div>

      <div className="umj-banner glass mt-5 text-center animate-fade-in">
        <img src="/UMJ.png" alt="Logo UMJ" className="umj-banner-logo" />
        <h2>Um projeto nascido na Academia</h2>
        <p className="text-muted mt-2">
          Orgulhosamente desenvolvido pelos laboratórios do Centro Universitário Mário Pontes Jucá (UMJ).
          Nosso compromisso é devolver o progresso tecnológico para nossa comunidade riberinha local.
        </p>
      </div>
    </div>
  );
};

export default TeamPage;
