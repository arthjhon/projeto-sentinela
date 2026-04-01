import React from 'react';
import { Activity, Beaker, Waves, AlertTriangle } from 'lucide-react';
import './WaterQuality.css';

const WaterQuality = () => {
  const parameters = [
    {
      id: 1,
      title: 'Oxigênio Dissolvido (OD)',
      value: '4.5',
      unit: 'mg/L',
      status: 'warning',
      icon: <Activity />,
      desc: 'Níveis críticos para a maioria da fauna aquática, indicando poluição orgânica e eutrofização.'
    },
    {
      id: 2,
      title: 'pH da Água',
      value: '7.8',
      unit: '',
      status: 'normal',
      icon: <Beaker />,
      desc: 'Dentro do limite aceitável, mas com flutuações dependendo das marés e chuvas.'
    },
    {
      id: 3,
      title: 'Salinidade',
      value: '15',
      unit: 'ppt',
      status: 'normal',
      icon: <Waves />,
      desc: 'Salinidade estuarina típica, vital para o desenvolvimento ótimo do Sururu.'
    },
    {
      id: 4,
      title: 'Contaminação',
      value: 'Alta',
      unit: 'Presença',
      status: 'danger',
      icon: <AlertTriangle />,
      desc: 'Coliformes fecais e metais pesados oriundos de esgotos sem tratamento e indústria.'
    }
  ];

  return (
    <section id="water-quality" className="water-quality-section section-container">
      <div className="section-header">
        <h2 className="section-title">Parâmetros Analisados</h2>
        <p className="section-subtitle">
          Monitoramento contínuo dos indicadores vitais que determinam a saúde das lagoas.
        </p>
      </div>

      <div className="parameters-grid">
        {parameters.map((param) => (
          <div key={param.id} className={`parameter-card glass param-${param.status} animate-fade-in`}>
            <div className="param-header">
              <div className="param-icon">{param.icon}</div>
              <span className={`status-badge badge-${param.status}`}>
                {param.status === 'normal' ? 'Estável' : param.status === 'warning' ? 'Atenção' : 'Crítico'}
              </span>
            </div>
            
            <div className="param-body">
              <h3 className="param-title">{param.title}</h3>
              <div className="param-value-container">
                <span className="param-value">{param.value}</span>
                <span className="param-unit">{param.unit}</span>
              </div>
              <p className="param-desc">{param.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default WaterQuality;
