import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMqtt } from '../../hooks/useMqtt';
import { useAuth } from './../../contexts/AuthContext';
import { useToast } from './../../contexts/ToastContext';
import { useReadOnly } from '../../hooks/useReadOnly';
import ConfirmModal from './../../components/ConfirmModal';
import { Wifi, WifiOff, MapPin, Search, ChevronDown, ChevronUp, Activity, Droplet, Thermometer, Wrench, FileText, CheckCircle2, RotateCw, History, Plus, Edit2, Trash2, X } from 'lucide-react';
import { FLEET, getMqttTopics } from '../../config/fleet';
import {
  iniciarManutencao, finalizarManutencao, listarManutencoes, manutencaoAberta,
  registrarCalibracao, ultimasCalibracoes,
} from '../../services/maintenance';
import { logAcao, AUDIT } from '../../services/auditLog';
import { useBuoyRegistry } from '../../hooks/useBuoyRegistry';
import {
  getBuoyRegistry, saveBuoyRegistry, topicsForRegistry,
  codigoEmUso, upsertRegistryEntry, mergeRegistryIntoRows, LAGOA_LABEL,
} from '../../services/buoyRegistry';
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

// Dados iniciais construídos a partir da frota centralizada (fleet.js).
// Só a SM-01 tem hardware instalado (deviceId real) — SM-02 e MG-01 são
// pontos de expansão planejados. Sem inventar leitura "online" pra sensor
// que não existe: todas partem de placeholder '--', e status reflete se há
// hardware ou não (mesmo critério de InteractiveMap.jsx/AdminDashboard.jsx).
const INITIAL_BUOYS = FLEET.map(b => ({
  ...b,
  deviceId: b.deviceId ?? '',
  status: b.deviceId ? 'online' : 'planejada',
  lastPing: b.deviceId ? 'Agora' : '--',
  details: {
    coordinates: b.coordinates,
    installedAt: b.installedAt,
    lastMaintenance: b.lastMaintenance,
    collectionRate: '1 leitur/min',
  },
  sensors: [
    { name: 'Turbidez',     icon: Activity,    status: b.deviceId ? 'online' : 'offline', value: '-- NTU' },
    { name: 'Sensor de pH', icon: Droplet,     status: b.deviceId ? 'online' : 'offline', value: '--'     },
    { name: 'Termômetro',   icon: Thermometer, status: b.deviceId ? 'online' : 'offline', value: '-- °C'  },
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

// Sensores mock de uma bóia que não está em FLEET.
const sensoresPadrao = () => [
  { name: 'Sensor de OD', icon: Activity,    status: 'online', value: '--' },
  { name: 'Sensor de pH', icon: Droplet,     status: 'online', value: '--' },
  { name: 'Termômetro',   icon: Thermometer, status: 'online', value: '--' },
];

// Linha local de uma bóia que está no registro mas não neste navegador
// (cadastrada em outra sessão, ou localStorage limpo): a de FLEET se o código
// existir lá, como getInitialBuoys faria; senão status/bateria default do
// formulário de cadastro, sem histórico local. id/name/deviceId vêm do registro
// (mergeRegistryIntoRows).
const linhaDoRegistro = (entry) => INITIAL_BUOYS.find(b => b.id === entry.codigo) ?? {
  id: entry.codigo,
  deviceId: entry.deviceId ?? '',
  name: entry.nome,
  status: 'online',
  battery: 100,
  lastPing: '--',
  location: LAGOA_LABEL[entry.lagoa] ?? 'Lagoa Mundaú',
  details: {
    coordinates: 'N/A',
    installedAt: '--',
    lastMaintenance: '--',
    collectionRate: '1 leitur/min',
  },
  sensors: sensoresPadrao(),
};

const SensorsPage = () => {
  const [expandedId, setExpandedId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Maintenance & History
  const [activeMaintenanceId, setActiveMaintenanceId] = useState(null);
  // 3.1/3.2 — dados persistidos, carregados por bóia ao expandir
  const [motivoPrompt, setMotivoPrompt]   = useState(null);   // {buoyId} enquanto pede o motivo
  const [motivoTexto, setMotivoTexto]     = useState('');
  const [timeline, setTimeline]           = useState({});     // boiaId -> manutenções
  const [abertaPorBoia, setAbertaPorBoia] = useState({});     // boiaId -> manutenção aberta
  const [calibracoes, setCalibracoes]     = useState({});     // boiaId -> {sensorKey: registro}
  const [salvando, setSalvando]           = useState(false);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [testStatuses, setTestStatuses] = useState({});
  const [maintenanceNotes, setMaintenanceNotes] = useState('');

  // Access Auth Profile & Contexts
  const { currentUser } = useAuth();
  const readOnly = useReadOnly();
  const { addToast } = useToast();

  const { messages, connected, addTopics } = useMqtt(getMqttTopics());

  const {
    buoys: registryBuoys, loading: registryLoading, error: registryError, reload: reloadRegistry,
  } = useBuoyRegistry();

  // Bóia cadastrada só no registro (deviceId novo, ainda não em FLEET) —
  // inscreve o tópico assim que o registro carrega. Ver spec: dupla
  // inscrição temporária num deviceId trocado é aceitável.
  useEffect(() => {
    if (registryBuoys.length) addTopics(topicsForRegistry(registryBuoys));
  }, [registryBuoys]); // eslint-disable-line react-hooks/exhaustive-deps -- addTopics é estável (ref interno do hook)

  // Declarado antes dos useEffects que dependem de buoys
  const [buoys, setBuoys] = useState(getInitialBuoys);

  // CRUD States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBuoy, setEditingBuoy] = useState(null);
  const [salvandoBoia, setSalvandoBoia] = useState(false);

  // Confirmation state
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [buoyToDelete, setBuoyToDelete] = useState(null);

  // Validation State
  const [formErrors, setFormErrors] = useState({});

  const initialFormData = {
    id: '', deviceId: '', name: '', status: 'online', location: 'Lagoa Mundaú', battery: 100, coordinates: '',
    lagoa: 'mundau', lat: '', lng: ''
  };
  const [formData, setFormData] = useState(initialFormData);

  // Persiste bóias no localStorage sempre que o estado mudar
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dehydrate(buoys)));
    } catch {}
  }, [buoys]);

  // Identidade (código, nome, deviceId) e existência de cada bóia vêm do registro
  // compartilhado, não do localStorage deste navegador: a cada leitura bem-sucedida
  // (montagem e todo reload) as linhas locais são reconciliadas — bóia de outra
  // sessão aparece, bóia removida lá sai. Com `registryError`, `registryBuoys` é o
  // fallback do hook, não o registro: não reconcilia (o erro aparece na página).
  useEffect(() => {
    if (registryLoading || registryError) return;
    setBuoys(prev => mergeRegistryIntoRows(prev, registryBuoys, linhaDoRegistro));
  }, [registryBuoys, registryLoading, registryError]);

  // Atualiza sensores e status de todas as bóias com deviceId vinculado
  useEffect(() => {
    const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setBuoys(prev => prev.map(b => {
      if (!b.deviceId) return b;
      const sData = messages[`${b.deviceId}/sensores`];
      const stData = messages[`${b.deviceId}/status`];
      const availability = messages[`${b.deviceId}/availability`];
      if (!sData && !stData && availability == null) return b;

      const isOnline = availability === 'online';
      const isOffline = availability === 'offline';

      return {
        ...b,
        ...(isOffline ? { status: 'offline' } : {}),
        ...(sData ? {
          status: isOffline ? 'offline' : 'online',
          lastPing: now,
          sensors: b.sensors.map(s => {
            if (s.name === 'Termômetro')
              return { ...s, value: sData.temperatura != null ? `${sData.temperatura.toFixed(1)} °C` : '-- °C', status: isOffline ? 'offline' : 'online' };
            if (s.name === 'Sensor de pH')
              return { ...s, value: sData.ph != null ? `${sData.ph.toFixed(2)}` : '--', status: isOffline ? 'offline' : 'online' };
            if (s.name === 'Turbidez')
              return { ...s, value: sData.turbidez != null ? `${sData.turbidez.toFixed(2)} NTU` : '-- NTU', status: isOffline ? 'offline' : 'online' };
            return s;
          }),
        } : {}),
        ...(isOnline && !sData ? { status: 'online' } : {}),
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

  // deviceId, nome, lagoa e posição vêm do registro FRESCO, lido ao abrir o modal:
  // a linha local e o `registryBuoys` do mount podem estar desatualizados (outra
  // sessão trocou o deviceId/posição depois que esta página abriu) e salvar a
  // partir deles reverteria a mudança da outra sessão sem aviso.
  const handleOpenEdit = async (buoy) => {
    let regEntry;
    try {
      regEntry = (await getBuoyRegistry()).find(r => r.codigo === buoy.id);
    } catch (err) {
      addToast(`Não foi possível ler o registro de bóias: ${err.message}`, 'error');
      return;
    }
    // Removida em outra sessão: recusa a edição em vez de recriar a bóia ao salvar
    // (desfaria a remoção feita lá). A releitura tira a linha da tabela.
    if (!regEntry) {
      addToast(`A bóia ${buoy.id} não está mais no registro: foi removida em outra sessão.`, 'error');
      reloadRegistry();
      return;
    }
    setEditingBuoy(buoy);
    setFormData({
      id: buoy.id,
      deviceId: regEntry.deviceId ?? '',
      name: regEntry.nome ?? buoy.name,
      status: buoy.status,
      location: buoy.location,
      battery: buoy.battery,
      coordinates: buoy.details.coordinates,
      lagoa: regEntry.lagoa ?? 'mundau',
      lat: regEntry.lat ?? '',
      lng: regEntry.lng ?? '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const requestDelete = (id) => {
    setBuoyToDelete(id);
    setConfirmDeleteOpen(true);
  };

  const confirmDeleteAction = () => {
    // captura antes de remover da lista, senão o nome já não existe no log
    const alvo = buoys.find(b => b.id === buoyToDelete);
    setBuoys(buoys.filter(b => b.id !== buoyToDelete));
    if(expandedId === buoyToDelete) setExpandedId(null);
    addToast("Bóia desconectada e deletada permanentemente da nuvem.", "success");
    logAcao(AUDIT.BOIA_REMOVER, buoyToDelete, { nome: alvo?.name, deviceId: alvo?.deviceId });
    // Busca uma cópia fresca do registro (não o `registryBuoys` do closure, que pode
    // estar vazio (fetch inicial ainda não resolveu) ou desatualizado (outra sessão
    // salvou depois do último fetch desta página) — salvar a partir do closure
    // sobrescreveria o array inteiro no Supabase com dados stale/incompletos.
    getBuoyRegistry()
      .then(fresh => saveBuoyRegistry(fresh.filter(r => r.codigo !== buoyToDelete)))
      .then(reloadRegistry)
      .catch(err => addToast(`Bóia removida localmente, mas falhou remover do registro: ${err.message}`, 'error'));
    setConfirmDeleteOpen(false);
    setBuoyToDelete(null);
  };

  // Grava a entrada desta bóia no registro dinâmico (map_buoys) a partir de uma
  // cópia FRESCA do servidor, não do `registryBuoys` do closure: ele pode estar
  // vazio ou stale, e `saveBuoyRegistry` substitui o array inteiro (sem merge no
  // servidor). Edição substitui a entrada no lugar — a ordem decide a bóia em
  // destaque da página pública. Lança erro, sem gravar, se o código novo já é de
  // outra bóia ou se a bóia em edição foi removida em outra sessão (não a recria).
  const syncRegistryEntry = async (codigoOriginal, entry) => {
    const fresh = await getBuoyRegistry();
    if (codigoOriginal && !fresh.some(r => r.codigo === codigoOriginal)) {
      throw new Error(`a bóia ${codigoOriginal} foi removida do registro em outra sessão`);
    }
    await saveBuoyRegistry(upsertRegistryEntry(fresh, codigoOriginal, entry));
  };

  const handleSaveForm = async (e) => {
    e.preventDefault();
    if (salvandoBoia) return;

    // Código gravado sem espaços nas pontas: " SM-01" é SM-01.
    const codigo = formData.id.trim();
    const codigoAtual = editingBuoy?.id ?? null;

    // Custom Validation
    const errors = {};
    if (!codigo) errors.id = true;
    if (!formData.name.trim()) errors.name = true;
    if (!formData.coordinates.trim()) errors.coordinates = true;
    if (formData.battery === '' || formData.battery === null) errors.battery = true;
    if (formData.lat === '' || Number.isNaN(Number(formData.lat))) errors.lat = true;
    if (formData.lng === '' || Number.isNaN(Number(formData.lng))) errors.lng = true;

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      addToast("Preencha todos os campos destacados em vermelho.", "error");
      return;
    }

    // Código único: registro e linhas desta página, exceto a própria bóia em
    // edição. syncRegistryEntry confere de novo contra o registro fresco.
    if (codigoEmUso([...registryBuoys.map(r => r.codigo), ...buoys.map(b => b.id)], codigo, codigoAtual)) {
      setFormErrors({ id: true });
      addToast(`Já existe uma bóia com o código ${codigo}.`, 'error');
      return;
    }

    const newDeviceId = formData.deviceId.trim();
    const nome = formData.name.trim();

    // Registro primeiro: se falhar (código tomado por outra sessão, bóia removida,
    // rede/RLS), nada muda localmente e o modal continua aberto.
    setSalvandoBoia(true);
    try {
      await syncRegistryEntry(codigoAtual, {
        codigo,
        nome,
        lagoa: formData.lagoa,
        lat: Number(formData.lat),
        lng: Number(formData.lng),
        deviceId: newDeviceId || null,
      });
    } catch (err) {
      addToast(`Bóia não salva: ${err.message}`, 'error');
      reloadRegistry(); // mostra o estado real (bóia criada ou removida por outra sessão)
      return;
    } finally {
      setSalvandoBoia(false);
    }

    if(editingBuoy) {
      // Edit
      if (newDeviceId && newDeviceId !== editingBuoy.deviceId) {
        addTopics([`${newDeviceId}/sensores`, `${newDeviceId}/status`]);
      }
      setBuoys(prev => prev.map(b => {
        if(b.id === codigoAtual) {
          return {
            ...b,
            id: codigo,
            deviceId: newDeviceId,
            name: nome,
            status: formData.status,
            location: formData.location,
            battery: Number(formData.battery),
            details: { ...b.details, coordinates: formData.coordinates }
          };
        }
        return b;
      }));
      addToast("Parâmetros operacionais da bóia alterados.", "success");
      logAcao(AUDIT.BOIA_EDITAR, codigo, {
        nome, deviceId: newDeviceId, status: formData.status,
      });
    } else {
      // Create
      if (newDeviceId) {
        addTopics([`${newDeviceId}/sensores`, `${newDeviceId}/status`]);
      }
      const newBuoy = {
        id: codigo,
        deviceId: newDeviceId,
        name: nome,
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
        sensors: sensoresPadrao(),
      };
      // filter: uma releitura do registro concluída durante o save pode já ter
      // criado a linha padrão desta bóia.
      setBuoys(prev => [...prev.filter(b => b.id !== codigo), newBuoy]);
      addToast("Bóia de Sensoriamento registrada e conectada na rede.", "success");
      logAcao(AUDIT.BOIA_CRIAR, codigo, { nome, deviceId: newDeviceId });
    }

    setIsModalOpen(false);
    reloadRegistry();
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
      // 3.1/3.2 — busca timeline e calibrações só ao abrir a linha, e não no
      // mount: são 3 queries por bóia e a maioria nunca é expandida.
      carregarDadosBoia(id);
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

  // 3.1 — carrega o que está persistido para a bóia (timeline, manutenção
  // aberta e calibrações). Chamado ao expandir a linha.
  const carregarDadosBoia = async (buoyId) => {
    try {
      const [logs, aberta, calibs] = await Promise.all([
        listarManutencoes(buoyId),
        manutencaoAberta(buoyId),
        ultimasCalibracoes(buoyId),
      ]);
      setTimeline(prev => ({ ...prev, [buoyId]: logs }));
      setAbertaPorBoia(prev => ({ ...prev, [buoyId]: aberta }));
      setCalibracoes(prev => ({ ...prev, [buoyId]: calibs }));
    } catch (err) {
      addToast(`Não foi possível carregar o histórico: ${err.message}`, "error");
    }
  };

  // 3.1 — abrir manutenção exige motivo; por isso o prompt vem antes do painel
  const confirmarInicioManutencao = async () => {
    const buoyId = motivoPrompt?.buoyId;
    if (!buoyId || !motivoTexto.trim()) return;
    setSalvando(true);
    try {
      await iniciarManutencao(buoyId, motivoTexto);
      setMotivoPrompt(null);
      setMotivoTexto('');
      setActiveMaintenanceId(buoyId);
      await carregarDadosBoia(buoyId);
      addToast(`Bóia ${buoyId} entrou em modo manutenção.`, "success");
    } catch (err) {
      addToast(err.message, "error");
    } finally {
      setSalvando(false);
    }
  };

  const handleSaveMaintenance = async (buoyId) => {
    setSalvando(true);
    try {
      await finalizarManutencao(buoyId, maintenanceNotes);
      addToast(`Log salvo! A bóia ${buoyId} voltou a operar em modo normal.`, "success");
      setActiveMaintenanceId(null);
      setMaintenanceNotes('');
      const newStatuses = { ...testStatuses };
      Object.keys(newStatuses).forEach(k => { if (k.startsWith(buoyId)) delete newStatuses[k]; });
      setTestStatuses(newStatuses);
      await carregarDadosBoia(buoyId);
    } catch (err) {
      addToast(`Não foi possível fechar a manutenção: ${err.message}`, "error");
    } finally {
      setSalvando(false);
    }
  };

  // 3.2 — calibração de um sensor
  const handleRecalibrar = async (buoyId, sensorKey) => {
    try {
      await registrarCalibracao(buoyId, sensorKey, null);
      const calibs = await ultimasCalibracoes(buoyId);
      setCalibracoes(prev => ({ ...prev, [buoyId]: calibs }));
      addToast(`Sensor ${sensorKey} recalibrado.`, "success");
    } catch (err) {
      addToast(`Falha ao registrar calibração: ${err.message}`, "error");
    }
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
          {/* Cadastrar/editar/remover só para admin: a RLS de app_settings
              (map_buoys) só aceita escrita de admin. */}
          {currentUser?.role === 'admin' && (
            <button className="btn-primary" onClick={handleOpenCreate}>
              <Plus size={18} /> Nova Bóia
            </button>
          )}
        </div>
      </div>

      {/* Registro ilegível: a tabela não é reconciliada a partir do fallback do
          hook (não é o registro) e o erro fica visível. */}
      {registryError && (
        <div className="badge badge-offline" role="alert" style={{ display: 'flex', flexWrap: 'wrap', borderRadius: '8px', padding: '0.6rem 1rem', marginBottom: '1rem' }}>
          <WifiOff size={14} />
          <span>Registro de bóias indisponível ({registryError}): a lista pode estar desatualizada.</span>
          <button type="button" className="btn-table btn-sm" onClick={reloadRegistry}>Tentar de novo</button>
        </div>
      )}

      {/* 3.1 — motivo é obrigatório para abrir a manutenção; sem ele o registro
          no Supabase não faz sentido ("o quê" sem "por quê"). Portal pelo mesmo
          motivo do modal de CRUD: escapar do stacking context da tabela. */}
      {motivoPrompt && createPortal(
        <div className="crud-modal-overlay" onClick={() => setMotivoPrompt(null)}>
          <div className="crud-modal animate-fade-in" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="crud-modal-header">
              <h3>Entrar em Modo Manutenção — {motivoPrompt.buoyId}</h3>
              <button className="btn-close" onClick={() => setMotivoPrompt(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="crud-modal-body">
              <div className="form-group">
                <label>Motivo da intervenção</label>
                <input
                  type="text"
                  className="w-100"
                  autoFocus
                  maxLength={120}
                  value={motivoTexto}
                  onChange={e => setMotivoTexto(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && motivoTexto.trim()) confirmarInicioManutencao(); }}
                  placeholder="Ex: troca do sensor de pH"
                />
              </div>
            </div>
            <div className="crud-modal-footer">
              <button className="btn-table" onClick={() => setMotivoPrompt(null)}>Cancelar</button>
              <button
                className="btn-primary"
                disabled={!motivoTexto.trim() || salvando}
                onClick={confirmarInicioManutencao}
              >
                {salvando ? 'Registrando...' : 'Iniciar Manutenção'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

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
                  <label>Lagoa (mapa)</label>
                  <select value={formData.lagoa} onChange={e => setFormData({...formData, lagoa: e.target.value})}>
                    <option value="mundau">Mundaú</option>
                    <option value="manguaba">Manguaba</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Latitude (mapa)</label>
                  <input type="number" step="any" className={`w-100 ${formErrors.lat ? 'input-error' : ''}`} value={formData.lat} onChange={e => {setFormData({...formData, lat: e.target.value}); setFormErrors({...formErrors, lat: false})}} placeholder="Ex: -9.6559" />
                </div>
                <div className="form-group">
                  <label>Longitude (mapa)</label>
                  <input type="number" step="any" className={`w-100 ${formErrors.lng ? 'input-error' : ''}`} value={formData.lng} onChange={e => {setFormData({...formData, lng: e.target.value}); setFormErrors({...formErrors, lng: false})}} placeholder="Ex: -35.7701" />
                </div>
                <div className="form-group">
                  <label>Status Operacional</label>
                  <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
                    <option value="online">Online / Operando</option>
                    <option value="warning">Atenção / Parcial</option>
                    <option value="offline">Offline / Pane</option>
                    <option value="planejada">Planejada / Sem Hardware</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Bateria Reportada (%)</label>
                  <input type="number" min="0" max="100" className={`w-100 ${formErrors.battery ? 'input-error' : ''}`} value={formData.battery} onChange={e => {setFormData({...formData, battery: e.target.value}); setFormErrors({...formErrors, battery: false})}} />
                </div>
              </div>
              <div className="crud-modal-footer">
                <button type="button" className="btn-table" onClick={() => setIsModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={salvandoBoia}>
                  {salvandoBoia ? 'Salvando...' : editingBuoy ? 'Salvar Modificações' : 'Implantar Bóia'}
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
                            <span className="info-label">Manutenções</span>
                            {/* 3.1 — timeline persistida no lugar do campo estático */}
                            {(timeline[buoy.id]?.length ?? 0) === 0 ? (
                              <span className="info-value maint-vazio">nenhum registro</span>
                            ) : (
                              <ul className="maint-timeline">
                                {timeline[buoy.id].slice(0, 4).map(m => (
                                  <li key={m.id} className={m.timestamp_fim ? '' : 'aberta'}>
                                    <span className="maint-quando">
                                      {new Date(m.timestamp_inicio).toLocaleDateString('pt-BR')}
                                      {!m.timestamp_fim && ' · em andamento'}
                                    </span>
                                    <span className="maint-motivo" title={m.motivo}>{m.motivo}</span>
                                    <span className="maint-quem">{m.operador_nome}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
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
                                      {/* 3.2 — calibração por sensor */}
                                      <span className="calib-info">
                                        Calibrado: {calibracoes[buoy.id]?.[sensor.name]
                                          ? new Date(calibracoes[buoy.id][sensor.name].calibrated_at).toLocaleDateString('pt-BR')
                                          : 'nunca'}
                                      </span>
                                      <button
                                        className="btn-table action-btn btn-sm calib-btn"
                                        onClick={(e) => { e.stopPropagation(); handleRecalibrar(buoy.id, sensor.name); }}
                                        disabled={readOnly}
                                        title={readOnly ? 'Indisponível no modo demonstração' : undefined}
                                      >
                                        Recalibrar
                                      </button>
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
                                <button
                                  className="btn-table action-btn maintenance-trigger-btn"
                                  onClick={() => {
                                    // Já há manutenção aberta (talvez de outro operador): abre o
                                    // painel direto. Pedir motivo de novo criaria um segundo
                                    // registro, que o índice único do schema rejeitaria.
                                    if (abertaPorBoia[buoy.id]) {
                                      setActiveMaintenanceId(buoy.id);
                                      return;
                                    }
                                    setMotivoTexto('');
                                    setMotivoPrompt({ buoyId: buoy.id });
                                  }}
                                >
                                  <Wrench size={16} />
                                  {abertaPorBoia[buoy.id] ? 'Continuar Manutenção' : 'Entrar em Modo Manutenção'}
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
        title="Remover Bóia"
        text={`Você irá remover todo o registro da bóia da base de dados. Esta ação é irreversível. Deseja prosseguir com a remoção?`}
        confirmText="Sim, Apagar a Bóia"
        onConfirm={confirmDeleteAction}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

    </div>
  );
};

export default SensorsPage;
