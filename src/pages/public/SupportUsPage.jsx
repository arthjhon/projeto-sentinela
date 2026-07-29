import React, { useState, useEffect } from 'react';
import { Heart, Mail, TrendingUp, Cpu, Cloud, Wrench, Copy, CheckCircle2, Waves, Wifi, Building2, ArrowRight } from 'lucide-react';
import { getSetting, FUNDING_GOAL_KEY } from '../../services/settings';
import { useDiasMonitorados } from '../../hooks/useDiasMonitorados';
import './SupportUsPage.css';

const IMPACT_STATS = [
  { value: 'P&D',  label: 'Fase Atual' },
  { value: '1',    label: 'Bóia Protótipo' },
  { value: '5',    label: 'Parâmetros Planejados' },
];

const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const FUNDING_ITEMS = [
  {
    icon: <Cpu size={22} />,
    color: 'var(--warning)',
    title: 'Hardware & Sensores',
    desc: 'ESP32, sensores de pH, turbidez, temperatura, oxigênio dissolvido e componentes eletrônicos.',
  },
  {
    icon: <Wifi size={22} />,
    color: 'var(--primary)',
    title: 'Conectividade IoT',
    desc: 'Chips 4G/LTE (SIM7600) e planos de dados para transmissão contínua das bóias em campo.',
  },
  {
    icon: <Cloud size={22} />,
    color: '#818cf8',
    title: 'Infraestrutura Cloud',
    desc: 'Hospedagem, banco de dados em nuvem (Supabase / InfluxDB) e broker MQTT.',
  },
  {
    icon: <Wrench size={22} />,
    color: 'var(--success)',
    title: 'Manutenção de Campo',
    desc: 'Baterias, case IP67, deslocamentos para instalação e substituição de componentes nas lagoas.',
  },
];

const SupportUsPage = () => {
  const [copied, setCopied] = useState(false);
  const pixKey = 'apoio@projetosentinela.com.br';

  // 5.3 — dias monitorados (mock persistente ou dado real do Influx)
  const { dias, fonte } = useDiasMonitorados();

  // 5.4 — meta de financiamento, configurada no painel admin
  const [funding, setFunding] = useState(null);
  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const v = await getSetting(FUNDING_GOAL_KEY, null);
        if (ativo) setFunding(v);
      } catch {
        // meta é opcional: se falhar, a página segue sem a barra
        if (ativo) setFunding(null);
      }
    })();
    return () => { ativo = false; };
  }, []);

  const metaPct = funding?.meta > 0
    ? Math.min(100, Math.round((funding.arrecadado / funding.meta) * 100))
    : 0;

  // dias entra como stat dinâmica junto das fixas
  const stats = [
    ...IMPACT_STATS,
    {
      value: dias == null ? '—' : dias.toLocaleString('pt-BR'),
      label: fonte === 'real' ? 'Dias Monitorados' : 'Dias de Monitoramento',
    },
  ];

  const handleCopy = () => {
    navigator.clipboard.writeText(pixKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="support-page">

      {/* ── Hero ─────────────────────────────── */}
      <div className="support-hero text-center animate-fade-in">
        <div className="support-heart-wrap">
          <Heart size={36} fill="rgba(239,68,68,0.25)" color="var(--danger)" />
        </div>
        <h1 className="gradient-text">Apoie a Proteção das Lagoas</h1>
        <p className="support-subtitle">
          O Projeto Sentinela é mantido por pesquisadores acadêmicos com recursos limitados.
          Cada contribuição é convertida diretamente em mais sensores, conectividade e presença nas lagoas Mundaú e Manguaba.
        </p>

        <div className="impact-stats">
          {stats.map((s, i) => (
            <div key={i} className="impact-stat glass">
              <span className="impact-value">{s.value}</span>
              <span className="impact-label">{s.label}</span>
            </div>
          ))}
        </div>

        {/* 5.4 — barra de meta; só aparece quando o admin definiu uma meta > 0 */}
        {funding?.meta > 0 && (
          <div className="funding-goal glass">
            <div className="funding-goal-head">
              <span className="funding-goal-raised">{brl(funding.arrecadado)}</span>
              <span className="funding-goal-target">de {brl(funding.meta)}</span>
            </div>
            <div className="funding-goal-bar">
              <div className="funding-goal-fill" style={{ width: `${metaPct}%` }} />
            </div>
            <span className="funding-goal-pct">{metaPct}% da meta alcançada</span>
          </div>
        )}
      </div>

      {/* ── O que financia ───────────────────── */}
      <div className="funding-section animate-fade-in">
        <h2 className="section-subtitle text-center">O que seu apoio viabiliza</h2>
        <div className="funding-grid">
          {FUNDING_ITEMS.map((item, i) => (
            <div key={i} className="funding-card glass">
              <div className="funding-icon" style={{ color: item.color, background: `${item.color}18` }}>
                {item.icon}
              </div>
              <div>
                <h4>{item.title}</h4>
                <p>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Formas de apoiar ─────────────────── */}
      <div className="support-ways">

        {/* PIX */}
        <div className="support-panel glass animate-fade-in">
          <div className="panel-badge pix-badge">Contribuição Direta</div>
          <Waves size={32} color="var(--primary)" style={{ marginBottom: '1rem' }} />
          <h2>Doação via PIX</h2>
          <p className="panel-desc">
            Ajude a custear sensores, chips de dados e manutenções mecânicas nas bóias.
            Qualquer valor faz diferença.
          </p>

          <div className="pix-qr-placeholder">
            <div className="qr-corners">
              <span className="qr-corner tl" /><span className="qr-corner tr" />
              <span className="qr-corner bl" /><span className="qr-corner br" />
            </div>
            <div className="qr-inner">
              <Waves size={48} color="rgba(0,240,255,0.25)" />
              <span>QR Code em breve</span>
            </div>
          </div>

          <div className="copy-pix-box">
            <span className="pix-key-text">{pixKey}</span>
            <button className="btn-copy" onClick={handleCopy} title="Copiar chave PIX">
              {copied
                ? <CheckCircle2 size={17} color="var(--success)" />
                : <Copy size={17} />}
            </button>
          </div>
          {copied && <p className="copy-feedback">Chave copiada!</p>}
        </div>

        {/* Parceria */}
        <div className="support-panel glass animate-fade-in" style={{ animationDelay: '0.15s' }}>
          <div className="panel-badge corp-badge">Patrocínio</div>
          <Building2 size={32} color="var(--warning)" style={{ marginBottom: '1rem' }} />
          <h2>Parceria Corporativa</h2>
          <p className="panel-desc">
            Empresas parceiras têm visibilidade na plataforma, nos materiais acadêmicos e nos relatórios técnicos publicados pela UMJ.
          </p>

          <ul className="benefits-list">
            <li>
              <div className="benefit-icon" style={{ color: 'var(--success)', background: 'rgba(16,185,129,0.1)' }}>
                <TrendingUp size={18} />
              </div>
              <div>
                <strong>Logo na página de Apoiadores</strong>
                <p>Visibilidade permanente na plataforma pública do projeto.</p>
              </div>
            </li>
            <li>
              <div className="benefit-icon" style={{ color: 'var(--warning)', background: 'rgba(245,158,11,0.1)' }}>
                <Cpu size={18} />
              </div>
              <div>
                <strong>Doação de Hardware</strong>
                <p>Empresas de IoT, energia solar ou eletrônica podem apoiar fornecendo componentes.</p>
              </div>
            </li>
          </ul>

          <a
            href="mailto:contato@projetosentinela.com.br"
            className="contact-cta"
          >
            <Mail size={16} />
            contato@projetosentinela.com.br
            <ArrowRight size={15} />
          </a>
        </div>

      </div>
    </div>
  );
};

export default SupportUsPage;
