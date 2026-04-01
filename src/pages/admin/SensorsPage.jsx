import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Wifi, WifiOff, MapPin, Search, ChevronDown, ChevronUp, Activity, Droplet, Thermometer, Wrench, FileText, CheckCircle2, RotateCw, History, Plus, Edit2, Trash2, X } from 'lucide-react';
import './SensorsPage.css';

const SensorsPage = () => {
  const [expandedId, setExpandedId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Maintenance & History
  const [activeMaintenanceId, setActiveMaintenanceId] = useState(null);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [testStatuses, setTestStatuses] = useState({});
  const [maintenanceNotes, setMaintenanceNotes] = useState('');

  // CRUD States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBuoy, setEditingBuoy] = useState(null);
  
  const initialFormData = {
    id: '', name: '', status: 'online', location: 'Lagoa Mundaú', battery: 100, coordinates: ''
  };
  const [formData, setFormData] = useState(initialFormData);

  const [buoys, setBuoys] = useState([
    { 
      id: 'SM-01', name: 'Bóia Mundaú Centro', status: 'online', battery: 85, lastPing: 'Agora', location: 'Lagoa Mundaú',
      details: { coordinates: "9°39'21.1\"S 35°46'12.4\"W", installedAt: '12/05/2023', lastMaintenance: '01/03/2024', collectionRate: '1 leitur/min' },
      sensors: [
        { name: 'Sensor de OD', icon: Activity, status: 'online', value: '4.5 mg/L' },
        { name: 'Sensor de pH', icon: Droplet, status: 'online', value: '7.8' },
        { name: 'Termômetro', icon: Thermometer, status: 'online', value: '28.5 °C' }
      ]
    },
    { 
      id: 'SM-02', name: 'Bóia Mundaú Sul', status: 'online', battery: 60, lastPing: '2 min', location: 'Lagoa Mundaú',
      details: { coordinates: "9°41'10.5\"S 35°47'05.2\"W", installedAt: '20/08/2023', lastMaintenance: '15/02/2024', collectionRate: '1 leitur/min' },
      sensors: [
        { name: 'Sensor de OD', icon: Activity, status: 'online', value: '5.1 mg/L' },
        { name: 'Sensor de pH', icon: Droplet, status: 'warning', value: '8.2' },
        { name: 'Termômetro', icon: Thermometer, status: 'online', value: '27.9 °C' }
      ]
    },
    { 
      id: 'MG-01', name: 'Bóia Manguaba Norte', status: 'online', battery: 92, lastPing: 'Agora', location: 'Lagoa Manguaba',
      details: { coordinates: "9°35'14.2\"S 35°50'22.1\"W", installedAt: '10/01/2024', lastMaintenance: '10/01/2024', collectionRate: '1 leitur/min' },
      sensors: [
        { name: 'Sensor de OD', icon: Activity, status: 'online', value: '6.0 mg/L' },
        { name: 'Sensor de pH', icon: Droplet, status: 'online', value: '7.2' },
        { name: 'Termômetro', icon: Thermometer, status: 'online', value: '26.8 °C' }
      ]
    }
  ]);

  // CRUD Functions
  const handleOpenCreate = () => {
    setEditingBuoy(null);
    setFormData(initialFormData);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (buoy) => {
    setEditingBuoy(buoy);
    setFormData({
      id: buoy.id,
      name: buoy.name,
      status: buoy.status,
      location: buoy.location,
      battery: buoy.battery,
      coordinates: buoy.details.coordinates
    });
    setIsModalOpen(true);
  };

  const handleDelete = (id) => {
    if(window.confirm(`Tem certeza que deseja remover permanentemente o sistema de bóia ${id}?`)) {
      setBuoys(buoys.filter(b => b.id !== id));
      if(expandedId === id) setExpandedId(null);
    }
  };

  const handleSaveForm = (e) => {
    e.preventDefault();
    
    if(editingBuoy) {
      // Edit
      setBuoys(buoys.map(b => {
        if(b.id === editingBuoy.id) {
          return {
            ...b,
            id: formData.id,
            name: formData.name,
            status: formData.status,
            location: formData.location,
            battery: Number(formData.battery),
            details: { ...b.details, coordinates: formData.coordinates }
          };
        }
        return b;
      }));
    } else {
      // Create
      const newBuoy = {
        id: formData.id,
        name: formData.name,
        status: formData.status,
        battery: Number(formData.battery),
        lastPing: 'Agora',
        location: formData.location,
        details: {
          coordinates: formData.coordinates || 'N/A',
          installedAt: new Date().toLocaleDateString('pt-BR'),
          lastMaintenance: 'Recém Instalada',
          collectionRate: '1 leitur/min'
        },
        sensors: [
          { name: 'Sensor G', icon: Activity, status: 'online', value: '--' }
        ]
      };
      setBuoys([...buoys, newBuoy]);
    }
    
    setIsModalOpen(false);
  };

  const toggleRow = (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      setActiveMaintenanceId(null);
      setActiveHistoryId(null);
    } else {
      setExpandedId(id);
      setActiveMaintenanceId(null);
      setActiveHistoryId(null);
    }
  };

  const startTest = (buoyId, sensorName) => {
    const key = `${buoyId}-${sensorName}`;
    setTestStatuses(prev => ({ ...prev, [key]: 'testing' }));
    setTimeout(() => setTestStatuses(prev => ({ ...prev, [key]: 'success' })), 2000 + Math.random() * 1000);
  };

  const testAllSensors = (buoyId, sensors) => {
    sensors.forEach(s => startTest(buoyId, s.name));
  };

  const handleSaveMaintenance = (buoyId) => {
    alert(`Relatório de manutenção para ${buoyId} salvo com sucesso!`);
    setActiveMaintenanceId(null);
    setMaintenanceNotes('');
    const newStatuses = { ...testStatuses };
    Object.keys(newStatuses).forEach(k => { if (k.startsWith(buoyId)) delete newStatuses[k]; });
    setTestStatuses(newStatuses);
  };

  const generateMockHistory = (buoy) => {
    const coords = buoy.details.coordinates;
    const history = [];
    for(let i=0; i<5; i++) {
        const time = new Date();
        time.setMinutes(time.getMinutes() - (i * 15));
        const sensor = buoy.sensors[i % buoy.sensors.length];
        let valueStr = sensor.value;
        if(valueStr === '--' || sensor.status === 'offline') valueStr = 'Falha/Timeout';
        history.push({
            date: time.toLocaleDateString('pt-BR'),
            time: time.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'}),
            sensorName: sensor.name,
            value: valueStr,
            location: coords
        });
    }
    return history;
  };

  const filteredBuoys = buoys.filter(b => 
    b.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    b.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="dashboard-content-area">
      <div className="page-header d-flex-between">
        <div>
          <h1>Gerenciamento de Bóias e Sensores</h1>
          <p>Visão detalhada do hardware alocado nas margens das lagoas.</p>
        </div>
        
        <div className="header-actions">
          <div className="search-bar glass">
            <Search size={18} className="text-muted" />
            <input 
              type="text" 
              placeholder="Buscar bóia..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button className="btn-primary" onClick={handleOpenCreate}>
            <Plus size={18} /> Nova Bóia
          </button>
        </div>
      </div>

      {/* CRUD Modal rendered via Portal to escape CSS stacking contexts */}
      {isModalOpen && createPortal(
        <div className="crud-modal-overlay">
          <div className="crud-modal animate-fade-in">
            <div className="crud-modal-header">
              <h3>{editingBuoy ? 'Editar Registros da Bóia' : 'Cadastrar Novo Sistema (Bóia)'}</h3>
              <button className="btn-close" onClick={() => setIsModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSaveForm} className="crud-modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label>Identificação de Frota (ID)</label>
                  <input type="text" required value={formData.id} onChange={e => setFormData({...formData, id: e.target.value})} placeholder="Ex: SM-09" />
                </div>
                <div className="form-group">
                  <label>Nome Comercial/Apelido</label>
                  <input type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Ponto Canal A" />
                </div>
                <div className="form-group">
                  <label>Lagoa / Área de Atuação</label>
                  <select value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})}>
                    <option value="Lagoa Mundaú">Lagoa Mundaú</option>
                    <option value="Lagoa Manguaba">Lagoa Manguaba</option>
                    <option value="Transição">Canal de Transição</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Coordenadas (GPS)</label>
                  <input type="text" required value={formData.coordinates} onChange={e => setFormData({...formData, coordinates: e.target.value})} placeholder="9°XX'XX S 35°XX'XX W" />
                </div>
                <div className="form-group">
                  <label>Status Operacional</label>
                  <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
                    <option value="online">Online / Operando</option>
                    <option value="warning">Atenção / Parcial</option>
                    <option value="offline">Offline / Pane</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Bateria Reportada (%)</label>
                  <input type="number" min="0" max="100" required value={formData.battery} onChange={e => setFormData({...formData, battery: e.target.value})} />
                </div>
              </div>
              <div className="crud-modal-footer">
                <button type="button" className="btn-table" onClick={() => setIsModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">
                  {editingBuoy ? 'Salvar Modificações' : 'Implantar Bóia'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      <div className="sensors-list glass">
        <table className="sensors-table">
          <thead>
            <tr>
              <th className="expand-column"></th>
              <th>Identificação</th>
              <th>Localização</th>
              <th>Status Geral</th>
              <th>Bateria</th>
              <th>Último Ping</th>
            </tr>
          </thead>
          <tbody>
            {filteredBuoys.map(buoy => (
              <React.Fragment key={buoy.id}>
                <tr className={`buoy-row ${expandedId === buoy.id ? 'expanded' : ''}`}>
                  <td className="expand-cell" onClick={() => toggleRow(buoy.id)}>
                    {expandedId === buoy.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </td>
                  <td className="sensor-id-cell" onClick={() => toggleRow(buoy.id)}>
                    <div className={`status-indicator ${buoy.status}`}></div>
                    <span className="sc-id">{buoy.id}</span>
                    <span className="sc-name">{buoy.name}</span>
                  </td>
                  <td onClick={() => toggleRow(buoy.id)}>
                    <span className="sc-location"><MapPin size={14} /> {buoy.location}</span>
                  </td>
                  <td onClick={() => toggleRow(buoy.id)}>
                    <span className={`badge badge-${buoy.status}`}>
                      {buoy.status === 'online' ? <Wifi size={14} /> : <WifiOff size={14} />}
                      {buoy.status.toUpperCase()}
                    </span>
                  </td>
                  <td onClick={() => toggleRow(buoy.id)}>
                    <div className="battery-bar-container">
                      <div 
                        className={`battery-bar ${buoy.battery > 20 ? 'bg-success' : 'bg-danger'}`}
                        style={{ width: `${buoy.battery}%` }}
                      ></div>
                    </div>
                    <span className="battery-text">{buoy.battery}%</span>
                  </td>
                  <td className="sc-ping" onClick={() => toggleRow(buoy.id)}>{buoy.lastPing}</td>
                </tr>

                {expandedId === buoy.id && (
                  <tr className="details-row">
                    <td colSpan="6">
                      <div className="details-container animate-fade-in">
                        
                        {/* Info Header Row moved up since Control Actions is removed */}

                        <div className="details-info-grid mt-2">
                          <div className="info-block">
                            <span className="info-label">Coordenadas GPS</span>
                            <span className="info-value">{buoy.details.coordinates}</span>
                          </div>
                          <div className="info-block">
                            <span className="info-label">Taxa de Coleta</span>
                            <span className="info-value">{buoy.details.collectionRate}</span>
                          </div>
                          <div className="info-block">
                            <span className="info-label">Data de Instalação</span>
                            <span className="info-value">{buoy.details.installedAt}</span>
                          </div>
                          <div className="info-block">
                            <span className="info-label">Última Manutenção</span>
                            <span className="info-value">{buoy.details.lastMaintenance}</span>
                          </div>
                        </div>

                        {activeMaintenanceId === buoy.id ? (
                          <div className="maintenance-panel animate-fade-in">
                            <div className="maintenance-header">
                              <h4><Wrench size={18} className="text-warning" /> Painel de Diagnóstico Técnico: {buoy.id}</h4>
                              <button className="btn-table action-btn btn-sm" onClick={() => setActiveMaintenanceId(null)}>
                                Cancelar Manutenção
                              </button>
                            </div>
                            <div className="maintenance-body">
                              <div className="maintenance-test-section glass">
                                <div className="test-header d-flex-between">
                                  <span>Testes de Hardware</span>
                                  <button className="btn-primary btn-sm" onClick={() => testAllSensors(buoy.id, buoy.sensors)}>
                                    Testar Todos
                                  </button>
                                </div>
                                <div className="test-list">
                                  {buoy.sensors.map((sensor, idx) => {
                                    const testStatus = testStatuses[`${buoy.id}-${sensor.name}`];
                                    return (
                                      <div key={idx} className="test-item">
                                        <div className="test-item-info">
                                          <sensor.icon size={16} className="text-muted" />
                                          <span>Ping: {sensor.name}</span>
                                        </div>
                                        <div className="test-item-action">
                                          {testStatus === 'testing' ? (
                                            <span className="status-testing"><RotateCw size={14} className="spin" /> Verificando...</span>
                                          ) : testStatus === 'success' ? (
                                            <span className="status-success"><CheckCircle2 size={14} /> OK</span>
                                          ) : (
                                            <button className="btn-table action-btn btn-sm" onClick={() => startTest(buoy.id, sensor.name)}>
                                              Executar Teste
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="maintenance-report-section glass">
                                <div className="test-header">
                                  <span><FileText size={16} /> Registro Oficial de Intervenção</span>
                                </div>
                                <div className="report-input">
                                  <textarea 
                                    className="maintenance-textarea" 
                                    placeholder="Descreva as peças substituídas, limpeza realizada, recalibração ou quaisquer anomalias..."
                                    value={maintenanceNotes}
                                    onChange={(e) => setMaintenanceNotes(e.target.value)}
                                  ></textarea>
                                </div>
                                <div className="report-footer">
                                  <button className="btn-primary" onClick={() => handleSaveMaintenance(buoy.id)} disabled={!maintenanceNotes.trim()}>
                                    Salvar e Concluir
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : activeHistoryId === buoy.id ? (
                          <div className="history-panel animate-fade-in">
                            <div className="history-header">
                              <h4><History size={18} className="text-primary" /> Histórico Bruto de Coletas: {buoy.id}</h4>
                              <button className="btn-table action-btn btn-sm" onClick={() => setActiveHistoryId(null)}>
                                Fechar Tabela de Histórico
                              </button>
                            </div>
                            <div className="history-body">
                              <table className="history-data-table">
                                <thead>
                                  <tr>
                                    <th>Data</th>
                                    <th>Hora</th>
                                    <th>Sensor</th>
                                    <th>Dado Aficionado</th>
                                    <th>Localização (GPS)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {generateMockHistory(buoy).map((record, index) => (
                                    <tr key={index}>
                                      <td className="date-col">{record.date}</td>
                                      <td className="time-col">{record.time}</td>
                                      <td className="sensor-col">{record.sensorName}</td>
                                      <td className={`val-col ${record.value === 'Falha/Timeout' ? 'text-danger' : 'text-success'}`}>{record.value}</td>
                                      <td className="gps-col">{record.location}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <div className="history-footer-actions mt-3 text-right">
                                <button className="btn-table action-btn">Exportar CSV</button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="attached-sensors-section mt-2">
                              <h4 className="attached-sensors-title">Sensores Acoplados</h4>
                              <div className="attached-sensors-grid">
                                {buoy.sensors.map((sensor, idx) => (
                                  <div key={idx} className="sub-sensor-card glass">
                                    <div className="sub-sensor-header">
                                      <div className={`sub-sensor-icon ${sensor.status}`}><sensor.icon size={18} /></div>
                                      <span className={`status-indicator mini ${sensor.status}`}></span>
                                    </div>
                                    <div className="sub-sensor-body">
                                      <span className="sub-sensor-name">{sensor.name}</span>
                                      <span className={`sub-sensor-val ${sensor.status === 'offline' ? 'text-muted' : ''}`}>{sensor.value}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="details-footer" style={{ flexWrap: 'wrap' }}>
                              <button className="btn-table action-btn" onClick={() => handleOpenEdit(buoy)}>
                                <Edit2 size={16} /> Editar
                              </button>
                              <button className="btn-table action-btn danger-btn" onClick={() => handleDelete(buoy.id)}>
                                <Trash2 size={16} /> Remover
                              </button>
                              <button className="btn-table action-btn" onClick={() => setActiveHistoryId(buoy.id)}>
                                <History size={16} /> Histórico de Coletas
                              </button>
                              <button className="btn-table action-btn maintenance-trigger-btn" onClick={() => setActiveMaintenanceId(buoy.id)}>
                                <Wrench size={16} /> Entrar em Modo Manutenção
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SensorsPage;
