import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useMqtt } from '../../hooks/useMqtt';
import { useReadOnly } from '../../hooks/useReadOnly';
import { FLEET, getMqttTopics } from '../../config/fleet';
import { logAcao, AUDIT } from '../../services/auditLog';
import { sha256Hex } from '../../utils/sha256';
import {
  UploadCloud, Cpu, Wifi, WifiOff, CheckCircle2,
  AlertTriangle, RotateCw, Radio, FileCode2, Trash2,
} from 'lucide-react';
import './OtaPage.css';

const ALL_TOPICS = getMqttTopics(['status', 'ota/status']);

// ─── Componente ───────────────────────────────────────────────────────────────
const OtaPage = () => {
  const { messages, connected, publish } = useMqtt(ALL_TOPICS);
  const readOnly = useReadOnly();

  // ── Form state ──
  const [firmwareFile, setFirmwareFile]       = useState(null);
  const [firmwareVersion, setFirmwareVersion] = useState('');
  const [targetBuoyId, setTargetBuoyId]       = useState('SM-01');
  const [releaseNotes, setReleaseNotes]       = useState('');
  // 4.1 — hash do .bin, calculado no navegador ao selecionar o arquivo
  const [sha256, setSha256]                   = useState(null);
  const [hashing, setHashing]                 = useState(false);

  // ── Deploy state ──
  const [phase, setPhase]               = useState('idle'); // idle | uploading | sending | waiting | success | error
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deployLog, setDeployLog]       = useState([]);
  const [confirmOpen, setConfirmOpen]   = useState(false);
  // id da linha em firmware_deploys, para fechar o status quando a bóia responder
  const [deployId, setDeployId]         = useState(null);

  const logEndRef = useRef(null);

  // Auto-scroll do log
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [deployLog]);

  // ── Recebe status OTA do device via MQTT ──
  useEffect(() => {
    FLEET.filter(b => b.deviceId).forEach(buoy => {
      const otaData = messages[`${buoy.deviceId}/ota/status`];
      if (!otaData) return;

      const status = otaData.status;
      appendLog(`[${buoy.id}] OTA: ${status} — ${otaData.progress ?? 0}%${otaData.error ? ` (${otaData.error})` : ''}`);

      if (status === 'success') setPhase('success');
      if (status === 'error')   setPhase('error');
      if (status === 'flashing' || status === 'downloading') setPhase('waiting');

      // 4.2 — fecha o registro do deploy conforme a bóia reporta o desfecho.
      // Sem isso a linha ficaria 'pendente' para sempre e o histórico mentiria.
      if (deployId && (status === 'success' || status === 'error')) {
        supabase
          .from('firmware_deploys')
          .update({
            status: status === 'success' ? 'sucesso' : 'falha',
            confirmado_em: new Date().toISOString(),
          })
          .eq('id', deployId)
          .then(({ error }) => {
            if (error) appendLog(`AVISO: não foi possível atualizar o histórico (${error.message}).`);
          });
        setDeployId(null);
      }
    });
  }, [messages, deployId]);

  // ─── Helpers ──
  const appendLog = (msg) => {
    const ts = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setDeployLog(prev => [...prev, `[${ts}] ${msg}`]);
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.bin')) {
      appendLog('ERRO: apenas arquivos .bin são aceitos.');
      return;
    }
    setFirmwareFile(file);
    appendLog(`Arquivo selecionado: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

    // Hash calculado aqui, e não no deploy: o operador precisa ver e poder
    // conferir o SHA-256 ANTES de confirmar (backlog 4.1).
    setSha256(null);
    setHashing(true);
    try {
      const hex = await sha256Hex(file);
      setSha256(hex);
      appendLog(`SHA-256: ${hex}`);
    } catch (err) {
      appendLog(`ERRO ao calcular SHA-256: ${err.message}`);
    } finally {
      setHashing(false);
    }
  };

  const handleDeploy = async () => {
    setConfirmOpen(false);
    if (!firmwareFile || !firmwareVersion.trim()) return;

    const target = FLEET.find(b => b.id === targetBuoyId);
    if (!target?.deviceId) {
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
      const cmdTopic = `${target.deviceId}/ota/command`;
      // sha256 vai junto para o firmware validar o binário antes de gravar a
      // flash. A validação em si é do lado do ESP32 — ver implementados.md.
      const cmd = { url: publicUrl, version: firmwareVersion, sha256 };
      const sent = publish(cmdTopic, cmd);

      if (!sent) throw new Error('MQTT desconectado — comando não enviado. Tente novamente.');
      appendLog(`Comando OTA enviado → ${cmdTopic}`);
      appendLog(`Versão alvo: ${firmwareVersion}`);
      appendLog(`Aguardando resposta do dispositivo...`);

      // 4.2 — registra o deploy. status='pendente' até a bóia confirmar via
      // MQTT (o useEffect de ota/status fecha o ciclo).
      const { data: deployRow, error: deployErr } = await supabase
        .from('firmware_deploys')
        .insert({
          boia_id: target.id,
          versao: firmwareVersion,
          sha256,
          notas_release: releaseNotes || null,
          status: 'pendente',
        })
        .select('id')
        .single();
      if (deployErr) {
        // não aborta o deploy: o comando já foi para o dispositivo, e falhar
        // aqui só nos deixa sem histórico — pior seria fingir que não enviamos
        appendLog(`AVISO: deploy enviado, mas não foi possível registrar no histórico (${deployErr.message}).`);
      } else {
        setDeployId(deployRow.id);
      }

      logAcao(AUDIT.FIRMWARE_DEPLOY, target.id, {
        versao: firmwareVersion, sha256, arquivo: firmwareFile.name,
      });

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
    if (!buoy.deviceId) {
      return { ...buoy, online: false, firmware: 'N/A', rssi: null, uptime: null };
    }
    const status = messages[`${buoy.deviceId}/status`];
    const otaSt  = messages[`${buoy.deviceId}/ota/status`];
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
  const canDeploy = firmwareFile && firmwareVersion.trim() && targetBuoy?.deviceId && phase === 'idle';

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
                {!buoy.deviceId && <span className="text-muted">Sem hardware</span>}
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
                  <option key={b.id} value={b.id} disabled={!b.deviceId}>
                    {b.id} — {b.name}{!b.deviceId ? ' (sem hardware)' : ''}
                  </option>
                ))}
              </select>
              {targetBuoy?.deviceId && !targetOnline && (
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
                    {/* 4.1 — o operador precisa conferir o hash ANTES de confirmar */}
                    {hashing && <span className="file-hash">calculando SHA-256…</span>}
                    {sha256 && (
                      <span className="file-hash" title="SHA-256 do binário — enviado junto ao comando OTA para o firmware validar">
                        SHA-256 {sha256}
                      </span>
                    )}
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
                    disabled={!canDeploy || readOnly}
                    title={readOnly ? 'Indisponível no modo demonstração' : undefined}
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
