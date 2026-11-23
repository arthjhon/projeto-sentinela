import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMqtt } from '../../hooks/useMqtt';
import { useBuoyRegistry } from '../../hooks/useBuoyRegistry';
import { usePolling } from '../../hooks/usePolling';
import { useUltimasLeituras } from '../../hooks/useUltimasLeituras';
import { getMqttTopics } from '../../config/fleet';
import { topicsForRegistry } from '../../services/buoyRegistry';
import { fetchSensorHealth, fetchWorkerJobs } from '../../services/sensorHealth';
import { manutencoesAbertas } from '../../services/maintenance';
import { resolverSelecao } from '../../utils/dashboard';
import { serialValido } from '../../utils/deviceIds';
import { avisoBroker, mensagemDaSessao, resumoBoia } from '../../utils/dashboardView';
import { criarFilaSerial } from '../../utils/filaSerial';
import RegistryErrorBanner from '../../components/admin/RegistryErrorBanner';
import FleetStrip from '../../components/admin/dashboard/FleetStrip';
import BuoyPanel from '../../components/admin/dashboard/BuoyPanel';
import BuoyDetailsModal from '../../components/admin/dashboard/BuoyDetailsModal';
import ClimaPanel from '../../components/admin/dashboard/ClimaPanel';
import { CLOCK_TICK_MS } from '../../config/adminTimings';
import './AdminDashboard.css';

const POLL_MS = 60_000;

// Visão geral: a frota primeiro (um card por bóia do cadastro), o clima e o
// aporte de água doce, depois tudo da bóia selecionada. Seleção no endereço (?boia=<codigo>) para link e "voltar".
// Só dado real: sem leitura aparece como "sem leitura", nunca 0 nem valor de
// outra bóia.

const AdminDashboard = () => {
  const { buoys, loading: registryLoading, error: registryError, reload: reloadRegistry } = useBuoyRegistry();
  const { messages, receivedAt, connected, addTopics } = useMqtt(getMqttTopics());
  // Já conectou nesta montagem? Separa "conectando" (abertura) de "caiu" no aviso.
  const [jaConectou, setJaConectou] = useState(false);
  if (connected && !jaConectou) setJaConectou(true);
  const aviso = avisoBroker({ conectado: connected, jaConectou });

  useEffect(() => {
    if (buoys.length) addTopics(topicsForRegistry(buoys));
  }, [buoys, addTopics]);

  // ── Seleção pela URL ───────────────────────────────────────────────────────
  const [searchParams, setSearchParams] = useSearchParams();
  const selecao = resolverSelecao(buoys, searchParams.get('boia'));
  // Só corrige o endereço com o cadastro de verdade: em fallback (erro), a
  // lista é a semente/última lida e o código da URL pode existir no real.
  useEffect(() => {
    if (!registryLoading && !registryError && selecao.corrigir) {
      setSearchParams({ boia: selecao.codigo }, { replace: true });
    }
  }, [registryLoading, registryError, selecao.corrigir, selecao.codigo, setSearchParams]);
  const selecionar = useCallback((codigo) => setSearchParams({ boia: codigo }), [setSearchParams]);

  // ── Relógio de "há X" e do estado sem-leitura ───────────────────────────────
  const [agoraMs, setAgoraMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgoraMs(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // ── Saúde, coleta do worker e manutenção aberta (Supabase, 60 s) ──────────
  const [healthRows, setHealthRows] = useState([]);
  const [jobs, setJobs] = useState(undefined); // undefined = carregando, null = leitura falhou
  const [manutencao, setManutencao] = useState({}); // codigo -> registro aberto | null (nenhuma) | 'erro' (leitura falhou)
  const codigos = useMemo(() => buoys.map((b) => b.codigo), [buoys]);
  const codigosKey = codigos.join('|');
  usePolling(async ({ isCurrent }) => {
    // Manutenção aberta: UMA consulta para a frota inteira (não uma por bóia).
    const [h, j, m] = await Promise.allSettled([fetchSensorHealth(), fetchWorkerJobs(), manutencoesAbertas(codigos)]);
    if (!isCurrent()) return;
    setHealthRows(h.status === 'fulfilled' ? h.value : null);
    setJobs(j.status === 'fulfilled' ? j.value : null);
    setManutencao(m.status === 'fulfilled' ? m.value : Object.fromEntries(codigos.map((c) => [c, 'erro'])));
  }, POLL_MS, [codigosKey]);

  // ── Últimas leituras gravadas, por bóia, só dos seriais DELA ───────────────
  // Valor de antes da primeira mensagem MQTT (até 30 dias). A fila é compartilhada com
  // o clima e o painel da bóia (mín./máx. e status), para não passar do limite de
  // conexões do proxy.
  const [fila] = useState(criarFilaSerial);
  const { ultimas, erros: ultimasErros, recarregar: recarregarUltimas } = useUltimasLeituras(buoys, { fila });

  // ── MQTT por bóia e resumo de cada card ─────────────────────────────────────
  const itens = useMemo(() => buoys.map((buoy) => {
    const d = serialValido(buoy); // serial fora do formato = sem serial: não assina MQTT com ele
    const mqtt = d ? {
      lwt: messages[`${d}/availability`],
      sensores: mensagemDaSessao(messages[`${d}/sensores`], receivedAt[`${d}/sensores`]),
      status: mensagemDaSessao(messages[`${d}/status`], receivedAt[`${d}/status`]),
    } : {};
    const rows = ultimas[buoy.codigo] ?? [];
    return {
      buoy,
      mqtt,
      ultimas: rows,
      manutencao: manutencao[buoy.codigo],
      resumo: resumoBoia({ buoy, mqtt, ultimas: rows, healthRows, agoraMs, brokerConectado: connected }),
    };
  }), [buoys, messages, receivedAt, ultimas, manutencao, healthRows, agoraMs, connected]);

  const atual = itens.find((i) => i.buoy.codigo === selecao.codigo) ?? null;

  // ── Modal "Detalhes da bóia" ───────────────────────────────────────
  // `detalhes` = bóia do modal, ou null. O modal recebe a última mensagem
  // /status da bóia nesta sessão (com _recebidoEm): itens[...].mqtt.status.
  const [detalhes, setDetalhes] = useState(null);
  // estável: o modal reassina o keydown quando onClose muda (o relógio re-renderiza a cada 5 s)
  const fecharDetalhes = useCallback(() => setDetalhes(null), []);

  return (
    <div className="dashboard-content-area">
      <div className="page-header">
        <h1>Visão geral</h1>
        <p>A frota e, abaixo, tudo da bóia selecionada: sensores, histórico, eventos e sistema.</p>
      </div>

      {aviso && buoys.length > 0 && (
        <p className={`dash-broker dash-broker-${aviso}`} role="status">
          {aviso === 'conectando'
            ? 'Conectando ao broker MQTT…'
            : 'Painel sem conexão com o broker MQTT: o estado das bóias e os valores ao vivo ficam parados até reconectar.'}
        </p>
      )}

      <RegistryErrorBanner error={registryError} onRetry={reloadRegistry} />

      {registryLoading && !buoys.length ? (
        <p className="text-muted">Carregando cadastro de bóias…</p>
      ) : !buoys.length ? (
        <div className="dash-empty glass">
          <h3>Nenhuma bóia cadastrada</h3>
          <p className="text-muted">Cadastre a primeira bóia para ver os dados aqui.</p>
          <Link to="/admin/boias/frota" className="btn-table">Ir para Bóias</Link>
        </div>
      ) : (
        <>
          <FleetStrip
            itens={itens}
            selecionada={selecao.codigo}
            onSelecionar={selecionar}
            onDetalhes={setDetalhes}
            detalhesCodigo={detalhes?.codigo ?? null}
            saudeIndisponivel={healthRows === null}
            agoraMs={agoraMs}
          />
          <ClimaPanel fila={fila} jobs={jobs} agoraMs={agoraMs} />
          {atual && (
            <BuoyPanel
              key={atual.buoy.codigo}
              buoy={atual.buoy}
              mqtt={atual.mqtt}
              resumo={atual.resumo}
              ultimas={atual.ultimas}
              ultimasErro={ultimasErros[atual.buoy.codigo] ?? null}
              onAtualizarUltimas={() => recarregarUltimas(atual.buoy.codigo)}
              healthRows={healthRows}
              jobs={jobs}
              fila={fila}
              agoraMs={agoraMs}
              onDetalhes={setDetalhes}
            />
          )}
        </>
      )}

      {detalhes && (
        <BuoyDetailsModal
          buoy={detalhes}
          statusMsg={itens.find((i) => i.buoy.codigo === detalhes.codigo)?.mqtt.status ?? undefined}
          agoraMs={agoraMs}
          onClose={fecharDetalhes}
        />
      )}
    </div>
  );
};

export default AdminDashboard;
