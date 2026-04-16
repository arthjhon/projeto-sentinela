import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useMqtt } from '../../hooks/useMqtt';
import {
  UploadCloud, Cpu, Wifi, WifiOff, CheckCircle2,
  AlertTriangle, RotateCw, Radio, FileCode2, Trash2,
} from 'lucide-react';
import './OtaPage.css';

// ─── Bóias conhecidas e seus device IDs MQTT ──────────────────────────────────
const FLEET = [
  { id: 'SM-01', name: 'Bóia Mundaú Centro',   mqttDevice: 'esp_sururu' },
  { id: 'SM-02', name: 'Bóia Mundaú Sul',       mqttDevice: null },  // sem hardware ainda
  { id: 'MG-01', name: 'Bóia Manguaba Norte',   mqttDevice: null },
];

// Tópicos: status de cada device + OTA status
const STATUS_TOPICS = FLEET
  .filter(b => b.mqttDevice)
  .map(b => `${b.mqttDevice}/status`);

const OTA_STATUS_TOPICS = FLEET
  .filter(b => b.mqttDevice)
  .map(b => `${b.mqttDevice}/ota/status`);

const ALL_TOPICS = [...STATUS_TOPICS, ...OTA_STATUS_TOPICS];

// ─── Componente ───────────────────────────────────────────────────────────────
const OtaPage = () => {
  const { messages, connected, publish } = useMqtt(ALL_TOPICS);

  // ── Form state ──
  const [firmwareFile, setFirmwareFile]       = useState(null);
  const [firmwareVersion, setFirmwareVersion] = useState('');
  const [targetBuoyId, setTargetBuoyId]       = useState('SM-01');
  const [releaseNotes, setReleaseNotes]       = useState('');

  // ── Deploy state ──
  const [phase, setPhase]               = useState('idle'); // idle | uploading | sending | waiting | success | error
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deployLog, setDeployLog]       = useState([]);
  const [confirmOpen, setConfirmOpen]   = useState(false);

  const logEndRef = useRef(null);

  // Auto-scroll do log
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [deployLog]);

  // ── Recebe status OTA do device via MQTT ──
  useEffect(() => {
    FLEET.filter(b => b.mqttDevice).forEach(buoy => {
      const otaData = messages[`${buoy.mqttDevice}/ota/status`];
      if (!otaData) return;

      const status = otaData.status;
      appendLog(`[${buoy.id}] OTA: ${status} — ${otaData.progress ?? 0}%${otaData.error ? ` (${otaData.error})` : ''}`);

      if (status === 'success') setPhase('success');
      if (status === 'error')   setPhase('error');
      if (status === 'flashing' || status === 'downloading') setPhase('waiting');
    });
  }, [messages]);

  // ─── Helpers ──
  const appendLog = (msg) => {
    const ts = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setDeployLog(prev => [...prev, `[${ts}] ${msg}`]);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.bin')) {
      appendLog('ERRO: apenas arquivos .bin são aceitos.');
      return;
    }
    setFirmwareFile(file);
    appendLog(`Arquivo selecionado: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
  };

  const handleDeploy = async () => {
    setConfirmOpen(false);
    if (!firmwareFile || !firmwareVersion.trim()) return;

    const target = FLEET.find(b => b.id === targetBuoyId);
    if (!target?.mqttDevice) {
      appendLog('ERRO: bóia selecionada não possui dispositivo MQTT associado.');
      return;
    }

    try {
      // ─── 1. Upload para Supabase Storage ──────────────────────────────────
      setPhase('uploading');
      setUploadProgress(0);
      const fileName = `${firmwareVersion.replace(/[^a-zA-Z0-9._-]/g, '_')}_${Date.now()}.bin`;
      appendLog(`Enviando ${fileName} para Supabase Storage...`);

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('firmware')
        .upload(fileName, firmwareFile, {
          contentType: 'application/octet-stream',
          upsert: false,
        });

      if (uploadError) throw new Error(`Upload falhou: ${uploadError.message}`);
      setUploadProgress(100);
      appendLog(`Upload concluído: ${uploadData.path}`);

      // ─── 2. Gera URL pública ───────────────────────────────────────────────
      const { data: urlData } = supabase.storage
        .from('firmware')
        .getPublicUrl(uploadData.path);

      const publicUrl = urlData.publicUrl;
      appendLog(`URL pública gerada.`);

      // ─── 3. Envia comando OTA via MQTT ────────────────────────────────────
      setPhase('sending');
      const cmdTopic = `${target.mqttDevice}/ota/command`;
      const cmd = { url: publicUrl, version: firmwareVersion };
      const sent = publish(cmdTopic, cmd);

      if (!sent) throw new Error('MQTT desconectado — comando não enviado. Tente novamente.');
      appendLog(`Comando OTA enviado → ${cmdTopic}`);
      appendLog(`Versão alvo: ${firmwareVersion}`);
      appendLog(`Aguardando resposta do dispositivo...`);

      setPhase('waiting');

    } catch (err) {
      appendLog(`ERRO: ${err.message}`);
      setPhase('error');
    }
  };

  const handleReset = () => {
    setPhase('idle');
    setDeployLog([]);
    setFirmwareFile(null);
    setFirmwareVersion('');
    setReleaseNotes('');
    setUploadProgress(0);
  };

  // ─── Dados ao vivo de cada bóia ──────────────────────────────────────────
  const fleetStatus = FLEET.map(buoy => {
    if (!buoy.mqttDevice) {
      return { ...buoy, online: false, firmware: 'N/A', rssi: null, uptime: null };
    }
    const status = messages[`${buoy.mqttDevice}/status`];
    const otaSt  = messages[`${buoy.mqttDevice}/ota/status`];
    return {
      ...buoy,
      online:   !!status,
      firmware: status?.firmware ?? '---',
      rssi:     status?.rssi ?? null,
      uptime:   status?.uptime != null ? `${Math.floor(status.uptime / 60)} min` : null,
      otaPhase: otaSt?.status ?? null,
      otaProgress: otaSt?.progress ?? 0,
    };
  });

  const targetBuoy = FLEET.find(b => b.id === targetBuoyId);
  const targetOnline = fleetStatus.find(b => b.id === targetBuoyId)?.online ?? false;
  const canDeploy = firmwareFile && firmwareVersion.trim() && targetBuoy?.mqttDevice && phase === 'idle';

  return (
    <div className="dashboard-content-area">
      <div className="page-header">
        <h1>Atualização de Firmware (OTA)</h1>
        <p>Atualize o firmware das bóias remotamente, sem precisar ir ao campo.</p>
      </div>

      {/* ── Status da Frota ── */}
      <section className="ota-section">
        <h2 className="ota-section-title">
          <Radio size={18} className="text-primary" />
          Status da Frota
          <span className={`mqtt-indicator ${connected ? 'online' : 'offline'}`}>
            {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
            MQTT {connected ? 'Online' : 'Offline'}
          </span>
        </h2>

        <div className="ota-fleet-grid">
          {fleetStatus.map(buoy => (
            <div key={buoy.id} className={`ota-device-card glass ${buoy.online ? 'card-online' : 'card-offline'}`}>
              <div className="device-card-header">
                <div className="device-id-badge">{buoy.id}</div>
                <span className={`device-status-dot ${buoy.online ? 'online' : 'offline'}`} />
              </div>
              <p className="device-name">{buoy.name}</p>
              <div className="device-meta">
                <span><FileCode2 size={13} /> {buoy.firmware}</span>
                {buoy.rssi    && <span><Wifi size={13} /> {buoy.rssi} dBm</span>}
                {buoy.uptime  && <span><RotateCw size={13} /> {buoy.uptime}</span>}
                {!buoy.mqttDevice && <span className="text-muted">Sem hardware</span>}
              </div>

              {/* Barra de progresso de OTA ativa nesta bóia */}
              {buoy.otaPhase && buoy.otaPhase !== 'idle' && (
                <div className="device-ota-progress">
                  <span className="ota-phase-label">{buoy.otaPhase}...</span>
                  <div className="ota-progress-track">
                    <div
                      className={`ota-progress-fill ${buoy.otaPhase === 'error' ? 'fill-error' : buoy.otaPhase === 'success' ? 'fill-success' : 'fill-active'}`}
                      style={{ width: `${buoy.otaProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Deploy Panel ── */}
      <section className="ota-section">
        <h2 className="ota-section-title">
          <UploadCloud size={18} className="text-primary" />
          Implantar Atualização
        </h2>

        <div className="ota-deploy-grid">
          {/* Coluna esquerda: formulário */}
          <div className="ota-form glass">

            {/* Bóia alvo */}
            <div className="ota-field">
              <label>Bóia Alvo</label>
              <select
                value={targetBuoyId}
                onChange={e => setTargetBuoyId(e.target.value)}
                disabled={phase !== 'idle'}
              >
                {FLEET.map(b => (
                  <option key={b.id} value={b.id} disabled={!b.mqttDevice}>
                    {b.id} — {b.name}{!b.mqttDevice ? ' (sem hardware)' : ''}
                  </option>
                ))}
              </select>
              {targetBuoy?.mqttDevice && !targetOnline && (
                <span className="ota-field-warning">
                  <AlertTriangle size={13} /> Dispositivo offline — o comando será enviado mas o device precisa estar conectado ao broker.
                </span>
              )}
            </div>

            {/* Versão */}
            <div className="ota-field">
              <label>Versão do Firmware</label>
              <input
                type="text"
                placeholder="ex: v2.1.0"
                value={firmwareVersion}
                onChange={e => setFirmwareVersion(e.target.value)}
                disabled={phase !== 'idle'}
              />
            </div>

            {/* Arquivo .bin */}
            <div className="ota-field">
              <label>Arquivo de Firmware (.bin)</label>
              <label className={`ota-file-drop ${firmwareFile ? 'has-file' : ''} ${phase !== 'idle' ? 'disabled' : ''}`}>
                <input
                  type="file"
                  accept=".bin"
                  onChange={handleFileChange}
                  disabled={phase !== 'idle'}
                  style={{ display: 'none' }}
                />
                {firmwareFile ? (
                  <>
                    <CheckCircle2 size={24} className="text-success" />
                    <span className="file-name">{firmwareFile.name}</span>
                    <span className="file-size">({(firmwareFile.size / 1024).toFixed(1)} KB)</span>
                  </>
                ) : (
                  <>
                    <UploadCloud size={24} />
                    <span>Clique ou arraste o .bin aqui</span>
                  </>
                )}
              </label>
            </div>

            {/* Notas */}
            <div className="ota-field">
              <label>Notas de Release <span className="optional">(opcional)</span></label>
              <textarea
                placeholder="Descreva as mudanças desta versão..."
                value={releaseNotes}
                onChange={e => setReleaseNotes(e.target.value)}
                disabled={phase !== 'idle'}
                rows={3}
              />
            </div>

            {/* Botões */}
            <div className="ota-form-actions">
              {phase === 'idle' ? (
                <>
                  <button
                    className="btn-table action-btn"
                    onClick={handleReset}
                    disabled={!firmwareFile && !firmwareVersion}
                  >
                    <Trash2 size={15} /> Limpar
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => setConfirmOpen(true)}
                    disabled={!canDeploy}
                  >
                    <Cpu size={15} /> Implantar Firmware
                  </button>
                </>
              ) : phase === 'success' ? (
                <button className="btn-primary" onClick={handleReset}>
                  <CheckCircle2 size={15} /> Novo Deploy
                </button>
              ) : phase === 'error' ? (
                <button className="btn-primary" onClick={handleReset}>
                  <RotateCw size={15} /> Tentar Novamente
                </button>
              ) : (
                <button className="btn-table action-btn" disabled>
                  <RotateCw size={15} className="spin" /> Processando...
                </button>
              )}
            </div>
          </div>

          {/* Coluna direita: log de deploy */}
          <div className="ota-log glass">
            <div className="ota-log-header">
              <span>Log de Deploy</span>
              {phase === 'uploading' && (
                <span className="ota-upload-pct">{uploadProgress}%</span>
              )}
              {phase === 'success' && <CheckCircle2 size={16} className="text-success" />}
              {phase === 'error'   && <AlertTriangle size={16} className="text-danger" />}
              {(phase === 'waiting' || phase === 'sending') && (
                <RotateCw size={15} className="spin text-primary" />
              )}
            </div>
            <div className="ota-log-body">
              {deployLog.length === 0 ? (
                <span className="ota-log-empty">Aguardando deploy...</span>
              ) : (
                deployLog.map((line, i) => (
                  <div
                    key={i}
                    className={`ota-log-line ${line.includes('ERRO') ? 'log-error' : line.includes('sucesso') || line.includes('concluído') ? 'log-success' : ''}`}
                  >
                    {line}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </section>

      {/* ── Modal de confirmação ── */}
      {confirmOpen && (
        <div className="ota-confirm-overlay" onClick={() => setConfirmOpen(false)}>
          <div className="ota-confirm-modal glass animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="ota-confirm-icon">
              <Cpu size={32} className="text-warning" />
            </div>
            <h3>Confirmar Deploy OTA</h3>
            <p>
              Você está prestes a atualizar o firmware da <strong>{targetBuoyId}</strong> para a versão <strong>{firmwareVersion}</strong>.
            </p>
            <p className="ota-confirm-warning">
              <AlertTriangle size={14} /> O dispositivo irá reiniciar após a atualização. A coleta de dados será interrompida por ~30–60 segundos.
            </p>
            <div className="ota-confirm-actions">
              <button className="btn-table action-btn" onClick={() => setConfirmOpen(false)}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={handleDeploy}>
                <Cpu size={15} /> Confirmar e Implantar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OtaPage;
