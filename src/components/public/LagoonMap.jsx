import React, { useState } from 'react';
import { Settings, Activity, Droplets } from 'lucide-react';
import './LagoonMap.css';

const LagoonMap = ({ activeArea }) => {
  const [activePin, setActivePin] = useState(null);

  // Coordenadas fictícias X e Y percentuais para o mapa
  const buoys = [
    { id: 1, area: 'mundau', name: 'Bóia Norte - Pontal', x: '25%', y: '35%', temp: '26.4', ph: '7.2', turb: '15' },
    { id: 2, area: 'mundau', name: 'Bóia Sul - Canal', x: '45%', y: '65%', temp: '27.1', ph: '6.9', turb: '42' },
    { id: 3, area: 'mundau', name: 'Bóia Leste - Trapiche', x: '70%', y: '45%', temp: '26.8', ph: '7.0', turb: '22' },
    { id: 4, area: 'manguaba', name: 'Manguaba - Centro', x: '35%', y: '50%', temp: '28.0', ph: '7.8', turb: '10' },
    { id: 5, area: 'manguaba', name: 'Manguaba - Foz', x: '65%', y: '30%', temp: '27.5', ph: '7.5', turb: '18' },
  ];

  const visibleBuoys = activeArea === 'comparativo' ? buoys : buoys.filter(b => b.area === activeArea);

  return (
    <div className="radar-map-container" onClick={(e) => {
      // Fecha o tooltip se clicar fora de um pin
      if(e.target.className.includes('radar-map-container') || e.target.className.includes('radar-grid')) {
        setActivePin(null);
      }
    }}>
      <div className="radar-grid">
         {/* Linhas transversais decorativas */}
         <div className="grid-line horizontal"></div>
         <div className="grid-line vertical"></div>
      </div>
      
      {/* O Scanner rotativo */}
      <div className="radar-sweep"></div>
      
      {visibleBuoys.map(buoy => (
        <div 
          key={buoy.id} 
          className={`map-pin ${activePin === buoy.id ? 'active' : ''}`}
          style={{ left: buoy.x, top: buoy.y }}
          onClick={(e) => {
            e.stopPropagation();
            setActivePin(activePin === buoy.id ? null : buoy.id);
          }}
        >
          <div className="pin-core"></div>
          <div className="pin-pulse"></div>
          
          {activePin === buoy.id && (
            <div className="pin-tooltip glass animate-fade-in">
              <div className="tooltip-header">
                <h5>{buoy.name}</h5>
                <span className="live-badge">Ao Vivo</span>
              </div>
              <div className="tooltip-metrics">
                 <div className="metric">
                   <Activity size={14} color="var(--primary)"/> 
                   <span>{buoy.temp}°C</span>
                   <small>Temp</small>
                 </div>
                 <div className="metric">
                   <Droplets size={14} color="var(--warning)"/> 
                   <span>{buoy.ph}</span>
                   <small>pH</small>
                 </div>
                 <div className="metric">
                   <Settings size={14} color="var(--success)"/> 
                   <span>{buoy.turb}</span>
                   <small>NTU</small>
                 </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default LagoonMap;
