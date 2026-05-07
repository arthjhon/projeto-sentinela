import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMqtt } from '../../hooks/useMqtt';
import { useAuth } from './../../contexts/AuthContext';
import { useToast } from './../../contexts/ToastContext';
import ConfirmModal from './../../components/ConfirmModal';
import { Wifi, WifiOff, MapPin, Search, ChevronDown, ChevronUp, Activity, Droplet, Thermometer, Wrench, FileText, CheckCircle2, RotateCw, History, Plus, Edit2, Trash2, X } from 'lucide-react';
import { FLEET, getMqttTopics } from '../../config/fleet';
import './SensorsPage.css';

// Mapa de ícones por nome de sensor — usado para reidratar dados do localStorage
const SENSOR_ICONS = {
  'Turbidez':     Activity,
  'Sensor de pH': Droplet,
  'Termômetro':   Thermometer,
  'Sensor de OD': Activity,
};

// Remove funções React (icons) antes de serializar para localStorage
const dehydrate = (buoys) => buoys.map(({ sensors, ...rest }) => ({
  ...rest,
  sensors: sensors.map(({ icon, ...s }) => s),
}));

// Reinsere os ícones após carregar do localStorage
const rehydrate = (raw) => raw.map(b => ({
  ...b,
  sensors: b.sensors.map(s => ({ ...s, icon: SENSOR_ICONS[s.name] ?? Activity })),
}));

// Dados iniciais construídos a partir da frota centralizada (fleet.js)
const INITIAL_BUOYS = FLEET.map(b => ({
  ...b,
  deviceId: b.deviceId ?? '',
  status: 'online',
  lastPing: b.id === 'SM-02' ? '2 min' : 'Agora',
  details: {
    coordinates: b.coordinates,
    installedAt: b.installedAt,
    lastMaintenance: b.lastMaintenance,
    collectionRate: '1 leitur/min',
  },
  sensors: b.id === 'SM-01'
    ? [
        { name: 'Turbidez',     icon: Activity,   status: 'online', value: '-- NTU' },
        { name: 'Sensor de pH', icon: Droplet,     status: 'online', value: '--'     },
        { name: 'Termômetro',   icon: Thermometer, status: 'online', value: '-- °C'  },
      ]
    : [
        { name: 'Sensor de OD', icon: Activity,   status: 'online', value: b.id === 'SM-02' ? '5.1 mg/L' : '6.0 mg/L' },
        { name: 'Sensor de pH', icon: Droplet,     status: b.id === 'SM-02' ? 'warning' : 'online', value: b.id === 'SM-02' ? '8.2' : '7.2' },
        { name: 'Termômetro',   icon: Thermometer, status: 'online', value: b.id === 'SM-02' ? '27.9 °C' : '26.8 °C'  },
      ],
}));

const STORAGE_KEY = 'sentinela_buoys_v1';

const getInitialBuoys = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return rehydrate(JSON.parse(stored));
  } catch {}
  return INITIAL_BUOYS;
};

const SensorsPage = () => {
  const [expandedId, setExpandedId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Maintenance & History
  const [activeMaintenanceId, setActiveMaintenanceId] = useState(null);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [testStatuses, setTestStatuses] = useState({});
  const [maintenanceNotes, setMaintenanceNotes] = useState('');

  // Access Auth Profile & Contexts
  const { currentUser } = useAuth();
  const { addToast } = useToast();

  const { messages, connected, addTopics } = useMqtt(getMqttTopics());

  // Declarado antes dos useEffects que dependem de buoys
  const [buoys, setBuoys] = useState(getInitialBuoys);

  // CRUD States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBuoy, setEditingBuoy] = useState(null);

  // Confirmation state
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [buoyToDelete, setBuoyToDelete] = useState(null);

  // Validation State
  const [formErrors, setFormErrors] = useState({});

  const initialFormData = {
    id: '', deviceId: '', name: '', status: 'online', location: 'Lagoa Mundaú', battery: 100, coordinates: ''
  };
  const [formData, setFormData] = useState(initialFormData);

  // Persiste bóias no localStorage sempre que o estado mudar
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dehydrate(buoys)));
    } catch {}
  }, [buoys]);

  // Atualiza sensores e status de todas as bóias com deviceId vinculado
  useEffect(() => {
    const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setBuoys(prev => prev.map(b => {
      if (!b.deviceId) return b;
      const sData = messages[`${b.deviceId}/sensores`];
      const stData = messages[`${b.deviceId}/status`];
      if (!sData && !stData) return b;
      return {
        ...b,
        ...(sData ? {
          status: 'online',
          lastPing: now,
          sensors: b.sensors.map(s => {
            if (s.name === 'Termômetro')
              return { ...s, value: sData.temperatura != null ? `${sData.temperatura.toFixed(1)} °C` : '-- °C', status: 'online' };
            if (s.name === 'Sensor de pH')
              return { ...s, value: sData.ph != null ? `${sData.ph.toFixed(2)}` : '--', status: 'online' };
            if (s.name === 'Turbidez')
              return { ...s, value: sData.turbidez != null ? `${sData.turbidez.toFixed(2)} NTU` : '-- NTU', status: 'online' };
            return s;
          }),
        } : {}),
        ...(stData ? {
          details: {
            ...b.details,
            rssi:        `${stData.rssi} dBm`,
            uptime:      `${Math.floor(stData.uptime / 60)} min`,
            mqttLatency: `${stData.mqtt_latency} ms`,
          },
        } : {}),
      };
    }));
  }, [messages]);

  // CRUD Functions
  const handleOpenCreate = () => {
    setEditingBuoy(null);
    setFormData(initialFormData);
    setFormErrors({});
    setIsModalOpen(true);
  };

  const handleOpenEdit = (buoy) => {
    setEditingBuoy(buoy);
    setFormData({
      id: buoy.id,
      deviceId: buoy.deviceId || '',
      name: buoy.name,
      status: buoy.status,
      location: buoy.location,
      battery: buoy.battery,
      coordinates: buoy.details.coordinates
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const requestDelete = (id) => {
    setBuoyToDelete(id);
    setConfirmDeleteOpen(true);
  };

  const confirmDeleteAction = () => {
    setBuoys(buoys.filter(b => b.id !== buoyToDelete));
    if(expandedId === buoyToDelete) setExpandedId(null);
    addToast("Bóia desconectada e deletada permanentemente da nuvem.", "success");
    setConfirmDeleteOpen(false);
    setBuoyToDelete(null);
  };

  const handleSaveForm = (e) => {
    e.preventDefault();
    
    // Custom Validation
    const errors = {};
    if (!formData.id.trim()) errors.id = true;
    if (!formData.name.trim()) errors.name = true;
    if (!formData.coordinates.trim()) errors.coordinates = true;
    if (formData.battery === '' || formData.battery === null) errors.battery = true;

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      addToast("Preencha todos os campos destacados em vermelho.", "error");
      return;
    }

    if(editingBuoy) {
      // Edit
      const newDeviceId = formData.deviceId.trim();
      if (newDeviceId && newDeviceId !== editingBuoy.deviceId) {
        addTopics([`${newDeviceId}/sensores`, `${newDeviceId}/status`]);
      }
      setBuoys(buoys.map(b => {
        if(b.id === editingBuoy.id) {
          return {
            ...b,
            id: formData.id,
            deviceId: newDeviceId,
            name: formData.name,
            status: formData.status,
            location: formData.location,
            battery: Number(formData.battery),
            details: { ...b.details, coordinates: formData.coordinates }
          };
        }
        return b;
      }));
      addToast("Parâmetros operacionais da bóia alterados.", "success");
    } else {
      // Create
      const newDeviceId = formData.deviceId.trim();
      if (newDeviceId) {
        addTopics([`${newDeviceId}/sensores`, `${newDeviceId}/status`]);
      }
      const newBuoy = {
        id: formData.id,
        deviceId: newDeviceId,
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
          { name: 'Sensor de OD', icon: Activity, status: 'online', value: '--' },
          { name: 'Sensor de pH', icon: Droplet, status: 'online', value: '--' },
          { name: 'Termômetro', icon: Thermometer, status: 'online', value: '--' }
        ]
      };
      setBuoys([...buoys, newBuoy]);
      addToast("Bóia de Sensoriamento registrada e conectada na rede.", "success");
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
    addToast(`Log salvo! A bóia ${buoyId} voltou a operar em modo normal.`, "success");
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
          <span className={`badge badge-${connected ? 'online' : 'offline'}`} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
            MQTT {connected ? 'Online' : 'Offline'}
          </span>
          <div className="search-bar glass">
            <Search size={18} className="text-muted" />
            <input
              type="text"
              placeholder="Buscar bóia..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          {currentUser?.role === 'admin' && (
            <button className="btn-primary" onClick={handleOpenCreate}>
              <Plus size={18} /> Nova Bóia
            </button>
          )}
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
            <form onSubmit={handleSaveForm} className="crud-modal-body" noValidate>
              <div className="form-grid">
                <div className="form-group">
                  <label>Identificação de Frota (ID)</label>
                  <input type="text" className={`w-100 ${formErrors.id ? 'input-error' : ''}`} value={formData.id} onChange={e => {setFormData({...formData, id: e.target.value}); setFormErrors({...formErrors, id: false})}} placeholder="Ex: SM-09" />
                </div>
                <div className="form-group">
                  <label>Número de Série do Dispositivo</label>
                  <input type="text" className="w-100" value={formData.deviceId} onChange={e => setFormData({...formData, deviceId: e.target.value})} placeholder="Ex: esp_sururu" style={{ fontFamily: 'monospace' }} />
                </div>
                <div className="form-group">
                  <label>Nome Comercial/Apelido</label>
                  <input type="text" className={`w-100 ${formErrors.name ? 'input-error' : ''}`} value={formData.name} onChange={e => {setFormData({...formData, name: e.target.value}); setFormErrors({...formErrors, name: false})}} placeholder="Ponto Canal A" />
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
                  <input type="text" className={`w-100 ${formErrors.coordinates ? 'input-error' : ''}`} value={formData.coordinates} onChange={e => {setFormData({...formData, coordinates: e.target.value}); setFormErrors({...formErrors, coordinates: false})}} placeholder="9°XX'XX S 35°XX'XX W" />
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
                  <input type="number" min="0" max="100" className={`w-100 ${formErrors.battery ? 'input-error' : ''}`} value={formData.battery} onChange={e => {setFormData({...formData, battery: e.target.value}); setFormErrors({...formErrors, battery: false})}} />
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
                    {buoy.deviceId && (
                      <span className="sc-serial" title="Número de série / Device ID">{buoy.deviceId}</span>
                    )}
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
                          {buoy.deviceId && (
                            <div className="info-block">
                              <span className="info-label">Nº de Série / Device ID</span>
                              <span className="info-value" style={{ fontFamily: 'monospace', letterSpacing: '0.03em' }}>{buoy.deviceId}</span>
                            </div>
                          )}
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
                          {buoy.details.rssi && (
                            <div className="info-block">
                              <span className="info-label">Sinal WiFi (RSSI)</span>
                              <span className="info-value">{buoy.details.rssi}</span>
                            </div>
                          )}
                          {buoy.details.uptime && (
                            <div className="info-block">
                              <span className="info-label">Uptime do Dispositivo</span>
                              <span className="info-value">{buoy.details.uptime}</span>
                            </div>
                          )}
                          {buoy.details.mqttLatency && (
                            <div className="info-block">
                              <span className="info-label">Latência MQTT</span>
                              <span className="info-value">{buoy.details.mqttLatency}</span>
                            </div>
                          )}
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
                              {currentUser?.role === 'admin' && (
                                <>
                                  <button className="btn-table action-btn" onClick={() => handleOpenEdit(buoy)}>
                                    <Edit2 size={16} /> Editar
                                  </button>
                                  <button className="btn-table action-btn danger-btn" onClick={() => requestDelete(buoy.id)}>
                                    <Trash2 size={16} /> Remover
                                  </button>
                                </>
                              )}
                              <button className="btn-table action-btn" onClick={() => setActiveHistoryId(buoy.id)}>
                                <History size={16} /> Histórico de Coletas
                              </button>
                              
                              {currentUser?.role !== 'visualizador' && (
                                <button className="btn-table action-btn maintenance-trigger-btn" onClick={() => setActiveMaintenanceId(buoy.id)}>
                                  <Wrench size={16} /> Entrar em Modo Manutenção
                                </button>
                              )}
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

      <ConfirmModal 
        isOpen={confirmDeleteOpen}
        title="Expurgar Bóia de Sensoriamento"
        text={`Você irá remover todo o registro físico da bóia do lago da base de dados. Esta ação é irreversível. Deseja prosseguir com o expurgo?`}
        confirmText="Sim, Expurgar Bóia"
        onConfirm={confirmDeleteAction}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

    </div>
  );
};

export default SensorsPage;
