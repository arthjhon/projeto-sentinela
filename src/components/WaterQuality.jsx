import React from 'react';
import { Thermometer, Beaker, CloudFog, Wind, Waves, AlertTriangle } from 'lucide-react';
import { WATER_PARAMS } from '../config/waterQuality';
import './WaterQuality.css';

// Secao explicativa: o que importa na saude do estuario e por que. Nao mostra
// leitura nem status — a telemetria real fica em /monitoramento. As faixas e
// as cores dos parametros monitorados vem de src/config/waterQuality.js
// (CONAMA 357, aguas salobras), as mesmas do painel; os demais sao planejados.
const paramColor = (key) => WATER_PARAMS.find(p => p.key === key)?.color;
const PLANNED_COLOR = '#64748b';

const WaterQuality = () => {
  const parameters = [
    {
      id: 'temperatura',
      title: 'Temperatura',
      monitored: true,
      color: paramColor('temperatura'),
      range: '22 – 30 °C',
      icon: <Thermometer />,
      desc: 'Regula o metabolismo do sururu e quanto oxigênio a água consegue reter. Acima de 30 °C, o estresse da fauna aumenta.'
    },
    {
      id: 'ph',
      title: 'pH da Água',
      monitored: true,
      color: paramColor('ph'),
      range: '6,5 – 8,5',
      icon: <Beaker />,
      desc: 'Fora dessa faixa, a formação das conchas dos moluscos e o equilíbrio químico da água ficam comprometidos.'
    },
    {
      id: 'turbidez',
      title: 'Turbidez',
      monitored: true,
      color: paramColor('turbidez'),
      range: 'até 40 NTU',
      icon: <CloudFog />,
      desc: 'Partículas em suspensão bloqueiam a luz e denunciam assoreamento, chuvas intensas ou despejos nas lagoas.'
    },
    {
      id: 'od',
      title: 'Oxigênio Dissolvido (OD)',
      monitored: false,
      color: PLANNED_COLOR,
      range: '≥ 5 mg/L',
      icon: <Wind />,
      desc: 'Abaixo disso a fauna aquática sufoca. Quedas de oxigênio apontam poluição orgânica e eutrofização.'
    },
    {
      id: 'salinidade',
      title: 'Salinidade',
      monitored: false,
      color: PLANNED_COLOR,
      range: '0,5 – 30 ‰',
      icon: <Waves />,
      desc: 'A mistura de água doce e do mar define o estuário; o sururu depende dessa faixa salobra para se desenvolver.'
    },
    {
      id: 'contaminacao',
      title: 'Contaminação',
      monitored: false,
      color: PLANNED_COLOR,
      range: '≤ 43 coliformes/100 mL',
      icon: <AlertTriangle />,
      desc: 'Limite para cultivo de moluscos. Esgoto sem tratamento e indústria trazem coliformes e metais pesados que chegam ao sururu e a quem o consome.'
    }
  ];

  return (
    <section id="water-quality" className="water-quality-section section-container">
      <div className="section-header">
        <h2 className="section-title">O que observamos no estuário</h2>
        <p className="section-subtitle">
          Os indicadores que definem a saúde das lagoas e do sururu. Três deles já são medidos pela bóia em tempo real;
          os demais estão planejados para as próximas etapas do projeto.
        </p>
      </div>

      <div className="parameters-grid">
        {parameters.map((param) => (
          <div
            key={param.id}
            className={`parameter-card glass ${param.monitored ? 'param-monitored' : 'param-planned'} animate-fade-in`}
            style={{ '--c': param.color }}
          >
            <div className="param-header">
              <div className="param-icon">{param.icon}</div>
              <span className={`status-badge ${param.monitored ? 'badge-monitored' : 'badge-planned'}`}>
                {param.monitored ? 'Monitorado pela bóia' : 'Planejado'}
              </span>
            </div>

            <div className="param-body">
              <h3 className="param-title">{param.title}</h3>
              <div className="param-range">
                <span className="param-range-label">Faixa de referência</span>
                <span className="param-range-value">{param.range}</span>
              </div>
              <p className="param-desc">{param.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="param-source">
        Faixas de referência: Resolução CONAMA 357/2005, águas salobras.
      </p>
    </section>
  );
};

export default WaterQuality;
