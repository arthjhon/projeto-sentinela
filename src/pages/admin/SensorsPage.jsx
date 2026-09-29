import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useMqtt } from '../../hooks/useMqtt';
import { useAuth } from './../../contexts/AuthContext';
import { useToast } from './../../contexts/ToastContext';
import { useReadOnly } from '../../hooks/useReadOnly';
import ConfirmModal from './../../components/ConfirmModal';
import { Wifi, WifiOff, MapPin, Search, ChevronDown, ChevronUp, Activity, Droplet, Thermometer, Wrench, FileText, CheckCircle2, AlertTriangle, XCircle, RotateCw, History, Plus, Edit2, Trash2, X, Download } from 'lucide-react';
import { getMqttTopics } from '../../config/fleet';
import {
  iniciarManutencao, finalizarManutencao, listarManutencoes, manutencaoAberta,
  registrarCalibracao, ultimasCalibracoes,
} from '../../services/maintenance';
import { logAcao, AUDIT } from '../../services/auditLog';
import { useBuoyRegistry } from '../../hooks/useBuoyRegistry';
import { fetchUltimasLeituras } from '../../hooks/useInfluxHistory';
import {
  getBuoyRegistry, saveBuoyRegistry, topicsForRegistry,
  codigoEmUso, upsertRegistryEntry, LAGOA_LABEL,
} from '../../services/buoyRegistry';
import {
  buoyStatus, STATUS_LABEL, formatCoords, formatAge, formatInterval,
  sensorDiagnosis, readingsToCsv,
} from '../../utils/buoyRuntime';
import './SensorsPage.css';

// Sensores que o firmware publica em <deviceId>/sensores. `name` é também a
// chave das calibrações já gravadas no Supabase — não renomear.
const SENSORES = [
  { name: 'Turbidez',     key: 'turbidez',    icon: Activity,    unit: ' NTU', digits: 2 },
  { name: 'Sensor de pH', key: 'ph',          icon: Droplet,     unit: '',     digits: 2 },
  { name: 'Termômetro',   key: 'temperatura', icon: Thermometer, unit: ' °C',  digits: 1 },
];

// Diagnóstico do sensor → classe visual já existente no CSS
const DIAG_CLASS = { ok: 'online', 'sem-valor': 'warning', 'sem-leitura': 'offline' };
// Status da bóia → classe (sem sinal usa o amarelo de "atenção")
const STATUS_CLASS = { online: 'online', offline: 'offline', planejada: 'planejada', 'sem-sinal': 'warning' };

const fmtValor = (v, sensor) =>
  Number.isFinite(v) ? `${v.toFixed(sensor.digits)}${sensor.unit}` : `--${sensor.unit}`;

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
  const [maintenanceNotes, setMaintenanceNotes] = useState('');

  // Access Auth Profile & Contexts
  const { currentUser } = useAuth();
  const readOnly = useReadOnly();
  const { addToast } = useToast();

  const { messages, receivedAt, connected, addTopics } = useMqtt(getMqttTopics());

  const {
    buoys: registryBuoys, loading: registryLoading, error: registryError, reload: reloadRegistry,
  } = useBuoyRegistry();

  // Bóia cadastrada só no registro (deviceId novo, ainda não em FLEET) —
  // inscreve o tópico assim que o registro carrega. Ver spec: dupla
  // inscrição temporária num deviceId trocado é aceitável.
  useEffect(() => {
    if (registryBuoys.length) addTopics(topicsForRegistry(registryBuoys));
  }, [registryBuoys]); // eslint-disable-line react-hooks/exhaustive-deps -- addTopics é estável (ref interno do hook)

  // Relógio para "última leitura há X s" e para o diagnóstico dos sensores
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  // Linhas da tabela derivadas só do que é real: identidade e posição do
  // registro (map_buoys, compartilhado); status do LWT; valores, saúde e hora
  // de chegada do MQTT desta sessão. Nada fica no navegador — antes a tabela
  // vivia no localStorage, com status/bateria digitados à mão e defaults
  // "online"/100%.
  const buoys = useMemo(() => registryBuoys.map(r => {
    const d = r.deviceId || null;
    const reading = d ? messages[`${d}/sensores`] : undefined;
    const st = d ? messages[`${d}/status`] : undefined;
    const health = st && typeof st === 'object' ? st : {};
    const chegada = d ? receivedAt[`${d}/sensores`] : undefined;
    const idade = chegada ? agora - chegada.at : null;
    return {
      id: r.codigo,
      name: r.nome,
      deviceId: d ?? '',
      location: LAGOA_LABEL[r.lagoa] ?? r.lagoa,
      coordinates: formatCoords(r.lat, r.lng),
      status: buoyStatus(d, d ? messages[`${d}/availability`] : undefined),
      // o firmware atual não mede bateria; aparece quando o /status trouxer
      battery: Number.isFinite(health.battery) ? health.battery : null,
      lastReading: idade,
      interval: chegada?.prevAt ? chegada.at - chegada.prevAt : null,
      health,
      sensors: SENSORES.map(sensor => {
        const diag = d ? sensorDiagnosis(reading, sensor.key, idade) : 'sem-leitura';
        return { ...sensor, diag, status: DIAG_CLASS[diag], value: fmtValor(reading?.[sensor.key], sensor) };
      }),
    };
  }), [registryBuoys, messages, receivedAt, agora]);

  // CRUD States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBuoy, setEditingBuoy] = useState(null);
  const [salvandoBoia, setSalvandoBoia] = useState(false);

  // Confirmation state
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [buoyToDelete, setBuoyToDelete] = useState(null);
  const [removendo, setRemovendo] = useState(false);

  // Validation State
  const [formErrors, setFormErrors] = useState({});

  const initialFormData = { id: '', deviceId: '', name: '', lagoa: 'mundau', lat: '', lng: '' };
  const [formData, setFormData] = useState(initialFormData);

  // Histórico bruto (InfluxDB) por bóia: { [boiaId]: { loading, rows, error } }
  const [historico, setHistorico] = useState({});

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

  // Registro primeiro: a tabela é derivada dele, então a bóia só some da lista
  // quando a remoção foi gravada. Parte de uma cópia fresca (não do closure,
  // que pode estar vazio ou stale — saveBuoyRegistry substitui o array inteiro).
  const confirmDeleteAction = async () => {
    if (removendo) return;
    const id = buoyToDelete;
    const alvo = buoys.find(b => b.id === id);
    setRemovendo(true);
    try {
      const fresh = await getBuoyRegistry();
      await saveBuoyRegistry(fresh.filter(r => r.codigo !== id));
      logAcao(AUDIT.BOIA_REMOVER, id, { nome: alvo?.name, deviceId: alvo?.deviceId });
      if (expandedId === id) setExpandedId(null);
      addToast(`Bóia ${id} removida do registro.`, 'success');
    } catch (err) {
      addToast(`Falha ao remover a bóia: ${err.message}`, 'error');
    } finally {
      setRemovendo(false);
      setConfirmDeleteOpen(false);
      setBuoyToDelete(null);
      reloadRegistry();
    }
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
    if (formData.lat === '' || Number.isNaN(Number(formData.lat))) errors.lat = true;
    if (formData.lng === '' || Number.isNaN(Number(formData.lng))) errors.lng = true;

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      addToast("Preencha todos os campos destacados em vermelho.", "error");
      return;
    }

    // Código único no registro, exceto a própria bóia em edição.
    // syncRegistryEntry confere de novo contra o registro fresco.
    if (codigoEmUso(registryBuoys.map(r => r.codigo), codigo, codigoAtual)) {
      setFormErrors({ id: true });
      addToast(`Já existe uma bóia com o código ${codigo}.`, 'error');
      return;
    }

    const newDeviceId = formData.deviceId.trim();
    const nome = formData.name.trim();

    // Se falhar (código tomado por outra sessão, bóia removida, rede/RLS), nada
    // muda e o modal continua aberto. Os tópicos MQTT da bóia nova/editada são
    // inscritos pelo effect do registro, após o reload.
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

    if (editingBuoy) {
      addToast('Cadastro da bóia atualizado.', 'success');
      logAcao(AUDIT.BOIA_EDITAR, codigo, { nome, deviceId: newDeviceId });
    } else {
      addToast('Bóia cadastrada.', 'success');
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

  // Histórico bruto: últimas leituras gravadas no InfluxDB (30 dias), sem agregação
  const abrirHistorico = async (buoy) => {
    setActiveHistoryId(buoy.id);
    if (!buoy.deviceId) return;
    setHistorico(prev => ({ ...prev, [buoy.id]: { loading: true, rows: prev[buoy.id]?.rows ?? [], error: null } }));
    try {
      const rows = await fetchUltimasLeituras(buoy.deviceId, { limit: 50, start: '-30d' });
      setHistorico(prev => ({ ...prev, [buoy.id]: { loading: false, rows, error: null } }));
    } catch (err) {
      setHistorico(prev => ({ ...prev, [buoy.id]: { loading: false, rows: [], error: err.message } }));
    }
  };

  const exportarCsv = (buoy) => {
    const rows = historico[buoy.id]?.rows ?? [];
    if (!rows.length) return;
    const blob = new Blob([readingsToCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${buoy.id}_leituras_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
              <th>Última Leitura</th>
            </tr>
          </thead>
          <tbody>
            {filteredBuoys.length === 0 && (
              <tr>
                <td colSpan="6" className="text-muted" style={{ textAlign: 'center', padding: '2rem' }}>
                  {registryLoading ? 'Carregando bóias...' : searchTerm ? 'Nenhuma bóia encontrada.' : 'Nenhuma bóia cadastrada.'}
                </td>
              </tr>
            )}
            {filteredBuoys.map(buoy => (
              <React.Fragment key={buoy.id}>
                <tr className={`buoy-row ${expandedId === buoy.id ? 'expanded' : ''}`}>
                  <td className="expand-cell" onClick={() => toggleRow(buoy.id)}>
                    {expandedId === buoy.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </td>
                  <td className="sensor-id-cell" onClick={() => toggleRow(buoy.id)}>
                    <div className={`status-indicator ${STATUS_CLASS[buoy.status]}`}></div>
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
                    <span
                      className={`badge badge-${STATUS_CLASS[buoy.status]}`}
                      title={buoy.status === 'sem-sinal' ? 'O broker nunca recebeu o status (LWT) deste Device ID' : undefined}
                    >
                      {buoy.status === 'online' ? <Wifi size={14} /> : <WifiOff size={14} />}
                      {STATUS_LABEL[buoy.status]}
                    </span>
                  </td>
                  <td onClick={() => toggleRow(buoy.id)}>
                    {buoy.battery == null ? (
                      <span className="battery-text text-muted" title="O firmware atual não reporta bateria">--</span>
                    ) : (
                      <>
                        <div className="battery-bar-container">
                          <div
                            className={`battery-bar ${buoy.battery > 20 ? 'bg-success' : 'bg-danger'}`}
                            style={{ width: `${buoy.battery}%` }}
                          ></div>
                        </div>
                        <span className="battery-text">{buoy.battery}%</span>
                      </>
                    )}
                  </td>
                  <td className="sc-ping" onClick={() => toggleRow(buoy.id)}>
                    {buoy.lastReading == null ? '--' : formatAge(buoy.lastReading)}
                  </td>
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
                            <span className="info-label">Coordenadas (lat, lng)</span>
                            <span className="info-value">{buoy.coordinates}</span>
                          </div>
                          <div className="info-block">
                            <span className="info-label">Intervalo entre Leituras</span>
                            <span className="info-value" title="Medido entre as duas últimas leituras recebidas nesta sessão">
                              {formatInterval(buoy.interval)}
                            </span>
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
                          {Number.isFinite(buoy.health.rssi) && (
                            <div className="info-block">
                              <span className="info-label">Sinal WiFi (RSSI)</span>
                              <span className="info-value">{buoy.health.rssi} dBm</span>
                            </div>
                          )}
                          {Number.isFinite(buoy.health.uptime) && (
                            <div className="info-block">
                              <span className="info-label">Uptime do Dispositivo</span>
                              <span className="info-value">{Math.floor(buoy.health.uptime / 60)} min</span>
                            </div>
                          )}
                          {Number.isFinite(buoy.health.mqtt_latency) && (
                            <div className="info-block">
                              <span className="info-label">Latência MQTT</span>
                              <span className="info-value">{buoy.health.mqtt_latency} ms</span>
                            </div>
                          )}
                          {buoy.health.firmware && (
                            <div className="info-block">
                              <span className="info-label">Firmware</span>
                              <span className="info-value" style={{ fontFamily: 'monospace' }}>
                                {buoy.health.firmware}{buoy.health.board ? ` · ${buoy.health.board}` : ''}
                              </span>
                            </div>
                          )}
                          {typeof buoy.health.calibrated === 'boolean' && (
                            <div className="info-block">
                              <span className="info-label">Calibração no Firmware</span>
                              <span className={`info-value ${buoy.health.calibrated ? '' : 'text-warning'}`}>
                                {buoy.health.calibrated ? 'Calibrado' : 'Não calibrado'}
                              </span>
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
                                  <span>Diagnóstico ao Vivo</span>
                                  <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                                    {buoy.lastReading == null ? 'nenhuma leitura nesta sessão' : `última leitura ${formatAge(buoy.lastReading)}`}
                                  </span>
                                </div>
                                <div className="test-list">
                                  {buoy.sensors.map(sensor => (
                                    <div key={sensor.key} className="test-item">
                                      <div className="test-item-info">
                                        <sensor.icon size={16} className="text-muted" />
                                        <span>{sensor.name}</span>
                                      </div>
                                      <div className="test-item-action">
                                        {sensor.diag === 'ok' ? (
                                          <span className="status-success"><CheckCircle2 size={14} /> OK · {sensor.value}</span>
                                        ) : sensor.diag === 'sem-valor' ? (
                                          <span className="status-warn"><AlertTriangle size={14} /> Leitura sem valor</span>
                                        ) : (
                                          <span className="status-fail"><XCircle size={14} /> Sem leitura recente</span>
                                        )}
                                      </div>
                                    </div>
                                  ))}
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
                              <h4><History size={18} className="text-primary" /> Histórico de Leituras: {buoy.id}</h4>
                              <button className="btn-table action-btn btn-sm" onClick={() => setActiveHistoryId(null)}>
                                Fechar Tabela de Histórico
                              </button>
                            </div>
                            <div className="history-body">
                              {!buoy.deviceId ? (
                                <p className="text-muted">Bóia sem Device ID: não há leituras gravadas.</p>
                              ) : historico[buoy.id]?.loading ? (
                                <p className="status-testing"><RotateCw size={14} className="spin" /> Buscando leituras no banco...</p>
                              ) : historico[buoy.id]?.error ? (
                                <p className="text-danger">Não foi possível ler o histórico: {historico[buoy.id].error}</p>
                              ) : !(historico[buoy.id]?.rows?.length) ? (
                                <p className="text-muted">Nenhuma leitura gravada nos últimos 30 dias.</p>
                              ) : (
                                <table className="history-data-table">
                                  <thead>
                                    <tr>
                                      <th>Data</th>
                                      <th>Hora</th>
                                      <th>Temperatura</th>
                                      <th>pH</th>
                                      <th>Turbidez</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {historico[buoy.id].rows.map((r, i) => (
                                      <tr key={`${r.time.getTime()}-${i}`}>
                                        <td className="date-col">{r.time.toLocaleDateString('pt-BR')}</td>
                                        <td className="time-col">{r.time.toLocaleTimeString('pt-BR')}</td>
                                        <td className="val-col">{fmtValor(r.temperatura, SENSORES[2])}</td>
                                        <td className="val-col">{fmtValor(r.ph, SENSORES[1])}</td>
                                        <td className="val-col">{fmtValor(r.turbidez, SENSORES[0])}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                              <div className="history-footer-actions mt-3 text-right">
                                <span className="text-muted" style={{ fontSize: '0.8rem', marginRight: '1rem' }}>
                                  Últimas 50 leituras gravadas no InfluxDB (até 30 dias)
                                </span>
                                <button
                                  className="btn-table action-btn"
                                  onClick={() => exportarCsv(buoy)}
                                  disabled={!(historico[buoy.id]?.rows?.length)}
                                >
                                  <Download size={16} /> Exportar CSV
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="attached-sensors-section mt-2">
                              <h4 className="attached-sensors-title">Sensores Acoplados</h4>
                              <div className="attached-sensors-grid">
                                {buoy.sensors.map(sensor => (
                                  <div key={sensor.key} className="sub-sensor-card glass">
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
                              <button className="btn-table action-btn" onClick={() => abrirHistorico(buoy)}>
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
        text={`A bóia sai do registro (mapa, painel e assinaturas MQTT). As leituras já gravadas e o histórico de manutenção continuam no banco. Deseja prosseguir?`}
        confirmText={removendo ? 'Removendo...' : 'Sim, Apagar a Bóia'}
        onConfirm={confirmDeleteAction}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

    </div>
  );
};

export default SensorsPage;
