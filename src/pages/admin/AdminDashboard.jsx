import React from 'react';
import { 
  ShieldCheck, 
  Target, 
  AlertTriangle, 
  TrendingDown, 
  Wrench, 
  ActivitySquare,
  BarChart,
  PieChart,
  Thermometer,
  Droplet,
  Activity
} from 'lucide-react';
import './AdminDashboard.css';

const AdminDashboard = () => {
  // Mock Data for Charts
  const collectionData = [
    { month: 'Jan', value: 4500 },
    { month: 'Fev', value: 5200 },
    { month: 'Mar', value: 5800 },
    { month: 'Abr', value: 4900 },
    { month: 'Mai', value: 6100 },
    { month: 'Jun', value: 6800 },
  ];
  const maxCollection = Math.max(...collectionData.map(d => d.value));

  // Fleet Status Data for Doughnut Chart
  const fleetStatus = { active: 14, maintenance: 3, alert: 5 };
  const totalFleet = fleetStatus.active + fleetStatus.maintenance + fleetStatus.alert;
  
  // Dashboard Metrics
  const metrics = [
    { title: 'Sensores Ativos', value: '38', icon: ActivitySquare, color: 'success', desc: '+2 esta semana' },
    { title: 'Bóias Ativas', value: '14', icon: ShieldCheck, color: 'success', desc: '100% Cobertura Área A' },
    { title: 'Precisam de Mnt.', value: '5', icon: AlertTriangle, color: 'warning', desc: '4 Mundaú / 1 Manguaba' },
    { title: 'Em Manutenção', value: '3', icon: Wrench, color: 'danger', desc: 'Previsão: 48 horas' },
  ];

  // Sensor Averages
  const sensorAverages = [
    { name: 'Temperatura da Água', value: '27.4', unit: '°C', icon: Thermometer, trend: '+0.2', color: 'var(--danger)' },
    { name: 'Turbidez Média', value: '12.5', unit: 'NTU', icon: Activity, trend: '-1.5', color: 'var(--warning)' },
    { name: 'Nível de pH (Médio)', value: '7.6', unit: '', icon: Droplet, trend: '+0.1', color: 'var(--primary)' }
  ];

  return (
    <div className="dashboard-content-area">
      <div className="page-header">
        <h1>Centro de Comando | Múltiplas Bóias</h1>
        <p>Acompanhamento estatístico centralizado de medições ecológicas e saúde da frota.</p>
      </div>

      <div className="metrics-grid">
        {metrics.map((m, idx) => (
          <div key={idx} className={`metric-card glass ${m.color === 'warning' ? 'metric-warning-bg' : ''}`}>
            <div className="metric-header">
              <h4>{m.title}</h4>
              <m.icon className={`text-${m.color}`} size={24} />
            </div>
            <div className="metric-value">{m.value}</div>
            <p className={`metric-trend text-${m.color}`}>{m.desc}</p>
          </div>
        ))}
      </div>

      <div className="averages-grid">
        {sensorAverages.map((sensor, idx) => (
          <div key={idx} className="avg-card glass">
            <div className="avg-icon-wrapper" style={{ color: sensor.color, backgroundColor: `color-mix(in srgb, ${sensor.color} 15%, transparent)` }}>
              <sensor.icon size={28} />
            </div>
            <div className="avg-data">
              <span className="avg-title">{sensor.name}</span>
              <div className="avg-value-row">
                <span className="avg-value">{sensor.value}</span>
                <span className="avg-unit">{sensor.unit}</span>
              </div>
              <span className="avg-trend">Variação 24h: <strong style={{ color: sensor.trend.startsWith('+') ? 'var(--warning)' : 'var(--success)'}}>{sensor.trend} {sensor.unit}</strong></span>
            </div>
          </div>
        ))}
      </div>

      <div className="charts-grid">
        {/* Bar Chart: Coletas de Dados */}
        <div className="chart-panel glass">
          <div className="chart-panel-header">
            <div className="chart-title">
              <BarChart size={20} className="text-primary" />
              <h3>Coletas de Dados (Últimos 6 Meses)</h3>
            </div>
            <span className="badge badge-online">Total: 33.3k</span>
          </div>
          <div className="css-bar-chart">
            {collectionData.map((d, i) => (
              <div key={i} className="css-bar-wrapper">
                <div className="css-bar-tooltip">{d.value} leituras</div>
                <div 
                  className="css-bar"
                  style={{ height: `${(d.value / maxCollection) * 100}%` }}
                ></div>
                <span className="css-bar-label">{d.month}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Fleet Composition Dashboard */}
        <div className="chart-panel glass fleet-panel">
          <div className="chart-panel-header">
            <div className="chart-title">
              <PieChart size={20} className="text-success" />
              <h3>Status da Frota (Bóias)</h3>
            </div>
            <span className="badge">Total: {totalFleet} un</span>
          </div>
          
          <div className="fleet-stats-container">
            <div className="fleet-ring-chart">
              {/* Simple CSS-based Ring representation */}
              <svg viewBox="0 0 36 36" className="circular-chart">
                <path className="circle-bg"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                
                <path className="circle alert-stroke"
                  strokeDasharray={`${(fleetStatus.alert / totalFleet) * 100}, 100`}
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                
                <path className="circle maint-stroke"
                  strokeDasharray={`${(fleetStatus.maintenance / totalFleet) * 100}, 100`}
                  strokeDashoffset={`-${(fleetStatus.alert / totalFleet) * 100}`}
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                  
                <path className="circle active-stroke"
                  strokeDasharray={`${(fleetStatus.active / totalFleet) * 100}, 100`}
                  strokeDashoffset={`-${((fleetStatus.alert + fleetStatus.maintenance) / totalFleet) * 100}`}
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                  
                <text x="18" y="20.35" className="percentage">{Math.round((fleetStatus.active/totalFleet)*100)}%</text>
              </svg>
            </div>
            
            <div className="fleet-legends">
              <div className="legend-item">
                <span className="legend-color bg-success"></span>
                <span>Ativas / Operando</span>
                <span className="legend-val">{fleetStatus.active}</span>
              </div>
              <div className="legend-item">
                <span className="legend-color bg-warning"></span>
                <span>Sob Atenção</span>
                <span className="legend-val">{fleetStatus.alert}</span>
              </div>
              <div className="legend-item">
                <span className="legend-color bg-danger"></span>
                <span>Em Manutenção</span>
                <span className="legend-val">{fleetStatus.maintenance}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="recent-alerts view-panel glass">
        <h3>Últimos Alertas Reportados</h3>
        <ul className="alert-list">
          <li className="alert-item warning-item">
            <span className="alert-time">Hoje, 08:30</span>
            <span className="alert-msg">Baixo nível de OD (3.1 mg/L) detectado no Sensor B-04 (Mundaú)</span>
          </li>
          <li className="alert-item error-item text-danger">
            <span className="alert-time">Ontem, 22:15</span>
            <span className="alert-msg">Falha de comunicação no Sensor M-02 (Manguaba). <b>Equipe de manutenção acionada.</b></span>
          </li>
          <li className="alert-item success-item">
            <span className="alert-time">12 Jun, 14:00</span>
            <span className="alert-msg">Retorno à operação da Bóia SM-08 após calibração preventiva.</span>
          </li>
        </ul>
      </div>
    </div>
  );
};

export default AdminDashboard;
