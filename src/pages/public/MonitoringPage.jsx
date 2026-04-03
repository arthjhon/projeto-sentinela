import React, { useState } from 'react';
import { Filter, TrendingUp, MapPin } from 'lucide-react';
import LagoonMap from '../../components/public/LagoonMap';
import './MonitoringPage.css';

const MonitoringPage = () => {
  const [activeTab, setActiveTab] = useState('mundau');

  const chartData = [
    { day: 'Seg', height: '30%' },
    { day: 'Ter', height: '40%' },
    { day: 'Qua', height: '70%' },
    { day: 'Qui', height: '65%' },
    { day: 'Sex', height: '55%' },
    { day: 'Sáb', height: '35%' },
    { day: 'Dom', height: '50%' },
  ];

  return (
    <div className="public-page-container flex-centered">
      <div className="analytics-window animate-fade-in">
        
        {/* HEADER */}
        <div className="analytics-header">
          <div className="mac-dots">
            <div className="dot red"></div>
            <div className="dot yellow"></div>
            <div className="dot green"></div>
          </div>
          <div className="header-title">Sentinela Analytics v1.5</div>
          <div className="header-actions">
            <select className="select-dark">
              <option>Últimos 7 dias</option>
              <option>Últimos 30 dias</option>
            </select>
            <button className="btn-filter">
              <Filter size={16} /> Filtros
            </button>
          </div>
        </div>

        {/* BODY */}
        <div className="analytics-body">
          
          {/* SIDEBAR */}
          <aside className="analytics-sidebar">
            <nav className="sidebar-nav">
              <button 
                className={`side-link ${activeTab === 'mundau' ? 'active' : ''}`}
                onClick={() => setActiveTab('mundau')}
              >
                Área: Mundaú
              </button>
              <button 
                className={`side-link ${activeTab === 'manguaba' ? 'active' : ''}`}
                onClick={() => setActiveTab('manguaba')}
              >
                Área: Manguaba
              </button>
              <button 
                className={`side-link ${activeTab === 'comparativo' ? 'active' : ''}`}
                onClick={() => setActiveTab('comparativo')}
              >
                Comparativo
              </button>
            </nav>
            <div className="sidebar-footer">
              <button className="side-link reports-btn">
                <TrendingUp size={16} /> Relatórios
              </button>
            </div>
          </aside>

          {/* MAIN CONTENT */}
          <main className="analytics-content scrollable">
            
            <div className="top-dashboard-section">
              {/* CHART CARD */}
              <div className="analytics-card chart-card">
                <div className="card-header-flex">
                  <h3 className="text-white">Variação de Qualidade (Índice Geral) - {activeTab === 'mundau' ? 'Mundaú' : 'Manguaba'}</h3>
                  <span className="badge-dark">Últimos 7 dias</span>
                </div>
                
                <div className="bar-chart-container">
                  {chartData.map((data, index) => (
                    <div key={index} className="bar-wrapper">
                      <div className="bar-fill" style={{ height: data.height }}></div>
                      <span className="bar-label">{data.day}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* STATS ROW */}
              <div className="stats-row">
                <div className="stat-box box-cyan-edge">
                  <span className="stat-label-upper">SENSORES ATIVOS ({activeTab.toUpperCase()})</span>
                  <div className="stat-value text-success">
                    {activeTab === 'mundau' ? '14' : '8'}
                  </div>
                </div>
                
                <div className="stat-box box-cyan-fade">
                  <span className="stat-label-upper">AMOSTRAS FILTRADAS</span>
                  <div className="stat-value text-white">
                    {activeTab === 'mundau' ? '8.4k' : '3.1k'}
                  </div>
                </div>
              </div>
            </div>

            {/* MAP SECTION */}
            <div className="map-section mt-5">
               <div className="map-header mb-3 d-flex-align gap-2 text-white">
                  <MapPin size={20} color="var(--primary)" /> 
                  <h3 className="m-0">Mapa de Telemetria e Coleta</h3>
               </div>
               <p className="text-muted mb-4" style={{fontSize: '0.9rem'}}>Monitore em tempo real as boias ativas espalhadas pelo complexo estuarino.</p>
               <LagoonMap activeArea={activeTab} />
            </div>

          </main>
        </div>
      </div>
    </div>
  );
};

export default MonitoringPage;
