import React, { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Filter, X, Calendar, MapPin, Target, Activity } from 'lucide-react';
import './DashboardPreview.css';

const DashboardPreview = () => {
  const [activeArea, setActiveArea] = useState('mundau');
  const [timeRange, setTimeRange] = useState('7dias');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [dataPoints, setDataPoints] = useState([]);
  
  // Filter States
  const [filterSensor, setFilterSensor] = useState('todos');
  const [filterBuoy, setFilterBuoy] = useState('todas');
  const [filterDateBase, setFilterDateBase] = useState('');
  const [filterLagoon, setFilterLagoon] = useState('ambas');

  const generateData = (area, range) => {
    let points = [];
    let labels = [];
    
    // Config labels and variation based on time range
    if (range === 'agora') {
      labels = ['10:00', '10:05', '10:10', '10:15', '10:20', '10:25'];
    } else if (range === '7dias') {
      labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
    } else if (range === '30dias') {
      labels = ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4'];
    } else if (range === '90dias') {
      labels = ['Mês 1', 'Mês 2', 'Mês 3'];
    } else if (range === '1ano') {
      labels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    }

    // Config values based on area
    labels.forEach((label) => {
      let baseVal = 50;
      if (area === 'mundau') baseVal = 40;
      if (area === 'manguaba') baseVal = 60;
      if (area === 'comparativo') baseVal = 70; // Higher representation

      points.push({
        label,
        value: Math.max(10, Math.min(100, baseVal + (Math.random() * 40 - 20)))
      });
    });

    return points;
  };

  useEffect(() => {
    setDataPoints(generateData(activeArea, timeRange));
  }, [activeArea, timeRange]);

  useEffect(() => {
    // Real-time jitter only if 'agora' is selected to show live feed
    if (timeRange === 'agora') {
      const interval = setInterval(() => {
        setDataPoints((prev) => 
          prev.map(point => ({
            ...point,
            value: Math.max(10, Math.min(100, point.value + (Math.random() * 10 - 5)))
          }))
        );
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [timeRange]);

  const getTimeRangeText = () => {
    switch(timeRange) {
      case 'agora': return 'Visualização: Agora (Ao Vivo)';
      case '7dias': return 'Últimos 7 dias';
      case '30dias': return 'Últimos 30 dias';
      case '90dias': return 'Últimos 90 dias';
      case '1ano': return 'Último Ano';
      default: return '';
    }
  };

  return (
    <section id="dashboard" className="dashboard-section section-container">
      <div className="section-header text-center">
        <div className="inline-flex align-center gap-2 mb-4 text-primary">
          <BarChart3 size={24} />
          <span className="font-semibold uppercase tracking-wider text-sm">Painel de Dados</span>
        </div>
        <h2 className="section-title">Análise em Tempo Real</h2>
        <p className="section-subtitle">
          Visualize os índices de saúde da água coletados por nossas estações de monitoramento.
        </p>
      </div>

      <div className="dashboard-mockup glass animate-fade-in delay-200 relative">
        <div className="dashboard-header">
          <div className="dashboard-dots">
            <span className="dot red"></span>
            <span className="dot yellow"></span>
            <span className="dot green"></span>
          </div>
          <div className="dashboard-title">Sentinela Analytics v1.5</div>
          <div className="dashboard-actions">
            
            <div className="time-selector">
              <select 
                value={timeRange} 
                onChange={(e) => setTimeRange(e.target.value)}
                className="time-dropdown"
              >
                <option value="agora">Agora</option>
                <option value="7dias">Últimos 7 dias</option>
                <option value="30dias">30 dias</option>
                <option value="90dias">90 dias</option>
                <option value="1ano">1 Ano</option>
              </select>
            </div>
            
            <div 
              className={`dashboard-controls ${isFilterOpen ? 'active' : ''}`}
              onClick={() => setIsFilterOpen(!isFilterOpen)}
            >
              <Filter size={16} />
              <span>Filtros</span>
            </div>
          </div>
        </div>

        {/* Filter Modal / Dropdown */}
        {isFilterOpen && (
          <div className="filter-dropdown-panel animate-fade-in">
            <div className="filter-panel-header">
              <h4>Filtro Avançado de Dados</h4>
              <button className="close-filter" onClick={() => setIsFilterOpen(false)}>
                <X size={18} />
              </button>
            </div>
            
            <div className="filter-grid">
              <div className="filter-group">
                <label><Activity size={14} /> Sensores</label>
                <select value={filterSensor} onChange={(e) => setFilterSensor(e.target.value)}>
                  <option value="todos">Todos os Sensores</option>
                  <option value="od">Oxigênio Dissolvido (OD)</option>
                  <option value="ph">Nível de pH</option>
                  <option value="temp">Temperatura</option>
                </select>
              </div>

              <div className="filter-group">
                <label><Target size={14} /> Bóias</label>
                <select value={filterBuoy} onChange={(e) => setFilterBuoy(e.target.value)}>
                  <option value="todas">Todas as Bóias</option>
                  <option value="sm-01">SM-01 (Mundaú Centro)</option>
                  <option value="mg-01">MG-01 (Manguaba Norte)</option>
                </select>
              </div>

              <div className="filter-group">
                <label><MapPin size={14} /> Lagoa Alvo</label>
                <select value={filterLagoon} onChange={(e) => setFilterLagoon(e.target.value)}>
                  <option value="ambas">Ambas as Lagoas</option>
                  <option value="mundau">Complexo Mundaú</option>
                  <option value="manguaba">Complexo Manguaba</option>
                </select>
              </div>

              <div className="filter-group">
                <label><Calendar size={14} /> Data Específica</label>
                <input 
                  type="date" 
                  value={filterDateBase}
                  onChange={(e) => setFilterDateBase(e.target.value)}
                />
              </div>
            </div>
            
            <div className="filter-actions-row">
              <button 
                className="btn-filter-apply"
                onClick={() => {
                  setIsFilterOpen(false);
                  /* In a real scenario, this would trigger an API fetch with the filters */
                  setDataPoints(generateData(activeArea, timeRange));
                }}
              >Aplicar Filtros</button>
            </div>
          </div>
        )}

        <div className="dashboard-body">
          <div className="dashboard-sidebar">
            <div 
              className={`sidebar-item ${activeArea === 'mundau' ? 'active' : ''}`}
              onClick={() => setActiveArea('mundau')}
            >
              Área: Mundaú
            </div>
            <div 
              className={`sidebar-item ${activeArea === 'manguaba' ? 'active' : ''}`}
              onClick={() => setActiveArea('manguaba')}
            >
              Área: Manguaba
            </div>
            <div 
              className={`sidebar-item ${activeArea === 'comparativo' ? 'active' : ''}`}
              onClick={() => setActiveArea('comparativo')}
            >
              Comparativo
            </div>
            <div className="sidebar-item mt-auto">
              <TrendingUp size={16} /> Relatórios
            </div>
          </div>

          <div className="dashboard-content">
            <div className="chart-container">
              <div className="chart-header">
                <h3>Variação de Qualidade (Índice Geral) - {activeArea === 'mundau' ? 'Mundaú' : activeArea === 'manguaba' ? 'Manguaba' : 'Ambas as Lagoas'}</h3>
                <span className="chart-badge">{getTimeRangeText()}</span>
              </div>
              <div className="bar-chart">
                {dataPoints.map((point, index) => (
                  <div key={index} className="bar-wrapper">
                    <div 
                      className={`bar ${activeArea === 'comparativo' ? 'bar-comparative' : ''}`} 
                      style={{ height: `${point.value}%` }}
                    >
                      <div className="bar-tooltip">{point.value.toFixed(1)}</div>
                    </div>
                    <span className="bar-label">{point.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mini-cards-grid">
              <div className="mini-card tech-border">
                <span className="mini-label">Sensores Ativos ({activeArea})</span>
                <span className="mini-value text-success">{activeArea === 'mundau' ? 14 : activeArea === 'manguaba' ? 12 : 26}</span>
              </div>
              <div className="mini-card tech-border">
                <span className="mini-label">Amostras Filtradas</span>
                <span className="mini-value">
                  {timeRange === 'agora' ? '128' : timeRange === '7dias' ? '8.4k' : '36.2k'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default DashboardPreview;
