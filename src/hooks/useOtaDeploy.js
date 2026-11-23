import { useReducer, useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { logAcao, AUDIT } from '../services/auditLog';
import {
  buildDeployRow, requestOtaCommand, removeFirmwareFile, deveRemoverBin,
} from '../services/otaCommand';
import {
  initialState, otaReducer, WAIT_TIMEOUT_MS, createRequestToken, faseDoStatus, eventoDoDeploy,
} from '../services/otaDeployState';
import { isFreshDeployEvent } from '../utils/otaStatus';

const ts = () => new Date().toLocaleTimeString('pt-BR', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Maceio',
});

/**
 * Orquestra o deploy OTA (upload -> insert -> Edge Function -> espera da bóia).
 * A lógica de estados está em services/otaDeployState.js (testada); aqui só
 * há efeitos: timeout de 120 s em 'waiting', fechamento da linha do histórico
 * quando a bóia responde e limpeza do .bin órfão (M6).
 *
 * @param {object} p
 * @param {object} p.messages   estado de useMqtt (último payload por tópico)
 * @param {object} p.receivedAt hora de chegada por tópico (useMqtt), para correlacionar o ota/status ao deploy
 * @param {() => void} [p.onSettled]  chamado quando o histórico mudou (para recarregar a tabela)
 */
export function useOtaDeploy({ messages, receivedAt, onSettled }) {
  const [state, dispatch] = useReducer(otaReducer, initialState);
  const [uploadProgress, setUploadProgress] = useState(0);
  // Bump a cada evento novo da bóia: 'downloading' longo reinicia o timeout.
  const [eventN, setEventN] = useState(0);
  const seenOtaRef = useRef({});
  const runRef = useRef(createRequestToken());
  // Date.now() de antes de pedir o comando deste deploy; null = nenhum comando em curso
  const sentAtRef = useRef(null);
  const onSettledRef = useRef(onSettled);
  useEffect(() => { onSettledRef.current = onSettled; });

  const log = useCallback((message) => dispatch({ type: 'log', message, ts: ts() }), []);

  // ── ota/status da bóia do deploy em curso ──
  const { phase, deployId, deviceId } = state;
  useEffect(() => {
    if (!deviceId) return;
    const topic = `${deviceId}/ota/status`;
    const otaData = messages[topic];
    const fresh = isFreshDeployEvent(otaData, seenOtaRef.current[topic], phase);
    seenOtaRef.current[topic] = otaData;
    // Status retido de um OTA anterior aparece só no card da frota.
    if (!fresh) return;
    // Só evento ao vivo recebido depois do comando DESTE deploy (ver eventoDoDeploy).
    if (!eventoDoDeploy(receivedAt?.[topic], sentAtRef.current)) return;

    const status = otaData.status;
    log(`OTA: ${status} — ${otaData.progress ?? 0}%${otaData.error ? ` (${otaData.error})` : ''}`);
    dispatch({ type: 'device_status', status });
    if (faseDoStatus(status)) setEventN(n => n + 1);

    // Fecha o registro conforme a bóia reporta o desfecho; sem isso a linha
    // ficaria 'pendente' para sempre.
    if (deployId && (status === 'success' || status === 'error')) {
      supabase
        .from('firmware_deploys')
        .update({
          status: status === 'success' ? 'sucesso' : 'falha',
          confirmado_em: new Date().toISOString(),
        })
        .eq('id', deployId)
        .then(({ error }) => {
          if (error) log(`AVISO: não foi possível atualizar o histórico (${error.message}).`);
          onSettledRef.current?.();
        });
    }
  }, [messages, receivedAt, deployId, deviceId, phase, log]);

  // ── Timeout: comando enviado e a bóia não responde ──
  useEffect(() => {
    if (phase !== 'waiting') return undefined;
    const id = setTimeout(() => {
      dispatch({ type: 'timeout', ts: ts() });
      onSettledRef.current?.();
    }, WAIT_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [phase, eventN]);

  const deploy = useCallback(async ({ target, file, version, sha256, notes, operator }) => {
    const token = runRef.current.next();
    const stale = () => !runRef.current.isLatest(token);
    let uploadedPath = null;
    let rowCreated = false;

    sentAtRef.current = null;
    dispatch({ type: 'start', deviceId: target.deviceId });
    try {
      // 1. Upload para o Storage
      setUploadProgress(0);
      const fileName = `${version.replace(/[^a-zA-Z0-9._-]/g, '_')}_${Date.now()}.bin`;
      log(`Enviando ${fileName} para Supabase Storage...`);
      const { data: up, error: upErr } = await supabase.storage
        .from('firmware')
        .upload(fileName, file, { contentType: 'application/octet-stream', upsert: false });
      if (upErr) throw new Error(`Upload falhou: ${upErr.message}`);
      uploadedPath = up.path;
      if (stale()) { await removeFirmwareFile(supabase, uploadedPath); return; }
      setUploadProgress(100);
      log(`Upload concluído: ${up.path}`);

      // 2. Linha do deploy, ANTES do comando (uma recusa rápida da bóia
      // chegaria antes do insert e deixaria a linha pendente).
      const { data: row, error: insErr } = await supabase
        .from('firmware_deploys')
        .insert(buildDeployRow({
          boiaId: target.id, version, sha256, notes, path: up.path,
          operatorId: operator?.id, operatorName: operator?.name,
        }))
        .select('id')
        .single();
      if (stale()) { if (!insErr && row) rowCreated = true; if (!rowCreated) await removeFirmwareFile(supabase, uploadedPath); return; }
      if (insErr || !row) {
        throw new Error(`Não foi possível registrar o deploy (${insErr?.message ?? 'sem retorno'}). Comando não enviado.`);
      }
      rowCreated = true;
      dispatch({ type: 'deploy_created', deployId: row.id });
      onSettledRef.current?.();

      // 3. Edge Function publica o comando (o navegador não tem credencial MQTT)
      sentAtRef.current = Date.now();
      const result = await requestOtaCommand(supabase, row.id);
      if (stale()) return;
      if (!result.ok) {
        // M6: recusa definitiva = binário sem uso (a linha já ficou 'falha').
        if (deveRemoverBin(result) && await removeFirmwareFile(supabase, uploadedPath)) {
          log('Arquivo enviado removido do storage.');
        }
        throw new Error(`${result.message} [${result.code}]`);
      }
      log(`Comando OTA enviado → ${target.deviceId}/ota/command`);
      log(`Versão alvo: ${version}`);
      log('Aguardando resposta do dispositivo (até 120 s)...');
      logAcao(AUDIT.FIRMWARE_DEPLOY, target.id, { versao: version, sha256, arquivo: file.name });
      dispatch({ type: 'command_sent' });
    } catch (err) {
      if (stale()) return;
      // M6: insert falhou depois do upload -> remove o .bin sem linha de histórico.
      if (uploadedPath && !rowCreated && await removeFirmwareFile(supabase, uploadedPath)) {
        log('Arquivo enviado removido do storage.');
      }
      dispatch({ type: 'fail', message: err.message, ts: ts() });
    } finally {
      if (!stale()) onSettledRef.current?.();
    }
  }, [log]);

  const reset = useCallback(() => {
    runRef.current.invalidate();
    seenOtaRef.current = {};
    sentAtRef.current = null;
    setUploadProgress(0);
    dispatch({ type: 'reset' });
  }, []);

  return { ...state, uploadProgress, deploy, reset, appendLog: log };
}
