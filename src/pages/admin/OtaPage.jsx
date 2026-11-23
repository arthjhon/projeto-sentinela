import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useMqtt } from '../../hooks/useMqtt';
import { useReadOnly } from '../../hooks/useReadOnly';
import { useAuth } from '../../contexts/AuthContext';
import { useBuoyRegistry } from '../../hooks/useBuoyRegistry';
import { usePolling } from '../../hooks/usePolling';
import { useOtaDeploy } from '../../hooks/useOtaDeploy';
import { FLEET, getMqttTopics } from '../../config/fleet';
import { topicsForRegistry, normalizeModo } from '../../services/buoyRegistry';
import { listarDeploys } from '../../services/otaCommand';
import { isBinFile, createRequestToken, podeResetar } from '../../services/otaDeployState';
import { sha256Hex } from '../../utils/sha256';
import { estadoConexao, leituraMsDaChegada, ROTULO_CONEXAO, TOM_CONEXAO } from '../../utils/buoyConnection';
import { formatUptime, formatRssi } from '../../utils/format';
import { TOM_CLASSE } from '../../utils/dashboardView';
import {
  UploadCloud, Cpu, Wifi, WifiOff, CheckCircle2,
  AlertTriangle, RotateCw, Radio, FileCode2, Trash2,
} from 'lucide-react';
import AcessoNegado from '../../components/admin/AcessoNegado';
import Modal from '../../components/admin/Modal';
import RegistryErrorBanner from '../../components/admin/RegistryErrorBanner';
import DeployHistory from '../../components/admin/firmware/DeployHistory';
import { ehPerfilGestao } from '../../config/adminNav';
import './OtaPage.css';

// 'availability' é o LWT do firmware (retido): status real de cada bóia. O
// mesmo conjunto vale na montagem (FLEET) e na sincronia com o registro.
const TOPIC_SUFFIXES = ['status', 'ota/status', 'availability'];
const ALL_TOPICS = getMqttTopics(TOPIC_SUFFIXES);
// Mesmo limite da Edge Function (supabase/functions/ota-command/command.ts,
// MAX_VERSION_CHARS): acima disso ela recusa com too_large depois do upload.
const MAX_VERSION_CHARS = 32;
const DEPLOYS_LIMIT = 20;

// ─── Componente ───────────────────────────────────────────────────────────────
const HISTORY_POLL_MS = 30_000;
const CLOCK_MS = 5_000;

const OtaPageConteudo = () => {
  const { messages, receivedAt, connected, addTopics } = useMqtt(ALL_TOPICS);
  const { buoys: registryBuoys, loading: registryLoading, error: registryError, isFallback, reload } = useBuoyRegistry();
  const readOnly = useReadOnly();
  // Só admin publica OTA (a Edge Function devolve 403 a operador/visualizador,
  // mas só depois do upload e do insert). Desabilita, não esconde.
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';

  // ── Form state ──
  const [firmwareFile, setFirmwareFile]       = useState(null);
  const [firmwareVersion, setFirmwareVersion] = useState('');
  const [targetBuoyId, setTargetBuoyId]       = useState('SM-01');
  const [releaseNotes, setReleaseNotes]       = useState('');
  // 4.1 — hash do .bin, calculado no navegador ao selecionar o arquivo
  const [sha256, setSha256]                   = useState(null);
  const [hashing, setHashing]                 = useState(false);
  const [confirmOpen, setConfirmOpen]         = useState(false);
  // I7: muda a cada reset e remonta o <input type=file>, para poder escolher o mesmo .bin de novo
  const [fileInputKey, setFileInputKey]       = useState(0);
  const hashTokenRef = useRef(createRequestToken());

  // ── Relógio e histórico de deploys ──
  const [agoraMs, setAgoraMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgoraMs(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);
  const [deploys, setDeploys]           = useState(null);
  const [deploysError, setDeploysError] = useState(null);
  const { runNow: reloadDeploys } = usePolling(async ({ isCurrent }) => {
    try {
      const rows = await listarDeploys(supabase, DEPLOYS_LIMIT);
      if (!isCurrent()) return;
      setDeploys(rows);
      setDeploysError(null);
    } catch (err) {
      if (isCurrent()) setDeploysError(err.message);
    }
  }, HISTORY_POLL_MS);

  const { phase, uploadProgress, deploy, reset, appendLog, log: deployLog } = useOtaDeploy({
    messages, receivedAt, onSettled: reloadDeploys,
  });

  const logBodyRef = useRef(null);

  // ── Bóias (registro × FLEET) ──
  // Identidade (código, nome, deviceId) vem do registro; FLEET só completa os
  // metadados pelo código. FLEET é o fallback síncrono apenas até a primeira
  // leitura do registro — carregado e vazio = nenhuma bóia.
  const buoys = useMemo(() => (
    registryLoading && !registryBuoys.length
      ? FLEET
      : registryBuoys.map(r => ({
          ...FLEET.find(f => f.id === r.codigo),
          id: r.codigo,
          name: r.nome,
          deviceId: r.deviceId || null,
          modo: r.modo,
        }))
  ), [registryBuoys, registryLoading]);

  // Destinos de OTA: só bóias com dispositivo (deviceId null = bóia planejada).
  const otaTargets = useMemo(() => buoys.filter(b => b.deviceId), [buoys]);

  // O padrão 'SM-01' (ou a escolha anterior) pode não estar entre os destinos:
  // vale então a primeira opção — a mesma que o <select> exibe.
  const targetBuoy = otaTargets.find(b => b.id === targetBuoyId) ?? otaTargets[0] ?? null;

  // Auto-scroll só da caixa do log.
  useEffect(() => {
    const el = logBodyRef.current;
    if (el && deployLog.length) el.scrollTop = el.scrollHeight;
  }, [deployLog]);

  // Sincronizar tópicos do registro
  useEffect(() => {
    if (registryBuoys.length) addTopics(topicsForRegistry(registryBuoys, TOPIC_SUFFIXES));
  }, [registryBuoys, addTopics]);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isBinFile(file.name)) {
      appendLog('ERRO: apenas arquivos .bin são aceitos.');
      e.target.value = '';
      return;
    }
    setFirmwareFile(file);
    appendLog(`Arquivo selecionado: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

    // Hash calculado aqui, e não no deploy: o operador precisa ver e poder
    // conferir o SHA-256 ANTES de confirmar (backlog 4.1). O token impede que
    // o hash de um arquivo anterior (assíncrono) sobrescreva o do atual.
    const token = hashTokenRef.current.next();
    setSha256(null);
    setHashing(true);
    try {
      const hex = await sha256Hex(file);
      if (!hashTokenRef.current.isLatest(token)) return;
      setSha256(hex);
      appendLog(`SHA-256: ${hex}`);
    } catch (err) {
      if (hashTokenRef.current.isLatest(token)) appendLog(`ERRO ao calcular SHA-256: ${err.message}`);
    } finally {
      if (hashTokenRef.current.isLatest(token)) setHashing(false);
    }
  };

  const clearForm = () => {
    hashTokenRef.current.invalidate();
    setFirmwareFile(null);
    setFirmwareVersion('');
    setReleaseNotes('');
    setSha256(null);
    setHashing(false);
    setFileInputKey(k => k + 1);
  };

  const handleDeploy = () => {
    setConfirmOpen(false);
    if (!canDeploy) return;
    const target = targetBuoy;
    if (!target?.deviceId) {
      appendLog('ERRO: bóia selecionada não possui dispositivo MQTT associado.');
      return;
    }
    deploy({
      target, file: firmwareFile, version: firmwareVersion, sha256, notes: releaseNotes,
      operator: { id: currentUser?.id, name: currentUser?.name },
    });
  };

  const handleReset = () => {
    reset();
    clearForm();
  };

  // ─── Dados ao vivo de cada bóia ──────────────────────────────────────────
  // Estado de conexão: função única (utils/buoyConnection). Leitura = o /status
  // recebido nesta sessão (retido não conta); LWT = <id>/availability.
  const fleetStatus = buoys.map(buoy => {
    const conexao = estadoConexao({
      modo: normalizeModo(buoy.modo),
      lwt: buoy.deviceId ? messages[`${buoy.deviceId}/availability`] : undefined,
      ultimaLeituraMs: buoy.deviceId ? (leituraMsDaChegada(receivedAt?.[`${buoy.deviceId}/status`]) ?? undefined) : undefined,
      agoraMs,
      brokerConectado: connected,
      temHardware: Boolean(buoy.deviceId),
    });
    if (!buoy.deviceId) {
      return { ...buoy, conexao, online: false, firmware: 'N/A', rssi: null, uptime: null };
    }
    const status = messages[`${buoy.deviceId}/status`];
    const otaSt  = messages[`${buoy.deviceId}/ota/status`];
    return {
      ...buoy,
      conexao,
      online:   conexao === 'online',
      firmware: status?.firmware ?? '---',
      rssi:     formatRssi(status?.rssi),
      uptime:   formatUptime(status?.uptime),
      otaPhase: otaSt?.status ?? null,
      otaProgress: otaSt?.progress ?? 0,
    };
  });

  const targetConexao = fleetStatus.find(b => b.id === targetBuoy?.id)?.conexao;
  const idle = phase === 'idle';
  const canDeploy = isAdmin && !isFallback && !registryLoading && firmwareFile && sha256 && !hashing
    && firmwareVersion.trim() && targetBuoy?.deviceId && idle;
  const deployBlockedReason = readOnly
    ? 'Indisponível no modo demonstração'
    : !isAdmin ? 'Apenas administradores podem implantar firmware'
    : isFallback ? 'Cadastro de bóias indisponível: deploy bloqueado'
    : undefined;

  return (
    <div className="dashboard-content-area">
      <div className="page-header">
        <h1>Atualização de Firmware (OTA)</h1>
        <p>Atualize o firmware das bóias remotamente, sem precisar ir ao campo.</p>
      </div>

      <RegistryErrorBanner error={isFallback ? (registryError || 'erro desconhecido') : null} onRetry={reload}>
        Deploy bloqueado até o cadastro voltar.
      </RegistryErrorBanner>

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
                <span className={`device-status-dot ${buoy.online ? 'online' : 'offline'}`} title={ROTULO_CONEXAO[buoy.conexao]} />
              </div>
              <p className="device-name">{buoy.name}</p>
              <span className={`badge ${TOM_CLASSE[TOM_CONEXAO[buoy.conexao]]}`}>{ROTULO_CONEXAO[buoy.conexao]}</span>
              <div className="device-meta">
                <span><FileCode2 size={13} /> {buoy.firmware}</span>
                {buoy.rssi    && <span><Wifi size={13} /> {buoy.rssi}</span>}
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
                value={targetBuoy?.id ?? ''}
                onChange={e => setTargetBuoyId(e.target.value)}
                disabled={!idle}
              >
                {otaTargets.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.id} — {b.name}
                  </option>
                ))}
              </select>
              {targetBuoy?.deviceId && targetConexao && targetConexao !== 'online' && (
                <span className="ota-field-warning">
                  <AlertTriangle size={13} /> Bóia: {ROTULO_CONEXAO[targetConexao]} — o comando será enviado mas o device precisa estar conectado ao broker.
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
                maxLength={MAX_VERSION_CHARS}
                disabled={!idle}
              />
            </div>

            {/* Arquivo .bin */}
            <div className="ota-field">
              <label>Arquivo de Firmware (.bin)</label>
              <label className={`ota-file-drop ${firmwareFile ? 'has-file' : ''} ${!idle ? 'disabled' : ''}`}>
                <input
                  key={fileInputKey}
                  type="file"
                  accept=".bin,.BIN"
                  onChange={handleFileChange}
                  disabled={!idle}
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
                disabled={!idle}
                rows={3}
              />
            </div>

            {/* Botões */}
            <div className="ota-form-actions">
              {idle ? (
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
                    title={deployBlockedReason}
                  >
                    <Cpu size={15} /> Implantar Firmware
                  </button>
                </>
              ) : phase === 'success' ? (
                <button className="btn-primary" onClick={handleReset}>
                  <CheckCircle2 size={15} /> Novo Deploy
                </button>
              ) : phase === 'error' || phase === 'timeout' ? (
                <button className="btn-primary" onClick={handleReset}>
                  <RotateCw size={15} /> Tentar Novamente
                </button>
              ) : (
                <>
                  <button className="btn-table action-btn" disabled>
                    <RotateCw size={15} className="spin" /> Processando...
                  </button>
                  {podeResetar(phase) && (
                    <button className="btn-table action-btn" onClick={handleReset}>
                      <Trash2 size={15} /> Cancelar e liberar
                    </button>
                  )}
                </>
              )}
              {phase === 'timeout' && (
                <span className="ota-field-hint">Sem resposta da bóia em 120 s.</span>
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
              {(phase === 'error' || phase === 'timeout') && <AlertTriangle size={16} className="text-danger" />}
              {(phase === 'waiting' || phase === 'sending') && (
                <RotateCw size={15} className="spin text-primary" />
              )}
            </div>
            <div className="ota-log-body" ref={logBodyRef}>
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
            </div>
          </div>
        </div>
      </section>

      <DeployHistory deploys={deploys} error={deploysError} agoraMs={agoraMs} />

      {/* Renderizado só quando aberto: o Modal captura o elemento que o abriu na montagem. */}
      {confirmOpen && (
        <Modal
          title="Confirmar Deploy OTA"
          size="sm"
          onClose={() => setConfirmOpen(false)}
          footer={(
            <>
              <button type="button" className="btn-table action-btn" onClick={() => setConfirmOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="btn-primary" onClick={handleDeploy}>
                <Cpu size={15} /> Confirmar e Implantar
              </button>
            </>
          )}
        >
          <p>
            Você está prestes a atualizar o firmware da <strong>{targetBuoy?.id}</strong> para a versão <strong>{firmwareVersion}</strong>.
          </p>
          <p className="ota-confirm-warning">
            <AlertTriangle size={14} /> O dispositivo irá reiniciar após a atualização. A coleta de dados será interrompida por ~30–60 segundos.
          </p>
        </Modal>
      )}
    </div>
  );
};

// Guarda de perfil fora do componente: os hooks da tela não rodam para quem
// não pode vê-la (e a regra de hooks não permite retorno antecipado depois deles).
const OtaPage = () => {
  const { currentUser } = useAuth();
  if (!ehPerfilGestao(currentUser?.role)) {
    return <AcessoNegado>Você não possui privilégios de Administrador para consultar o firmware das bóias.</AcessoNegado>;
  }
  return <OtaPageConteudo />;
};

export default OtaPage;
