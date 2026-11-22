import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { useMqtt } from '../../hooks/useMqtt';
import { useBuoyRegistry } from '../../hooks/useBuoyRegistry';
import { fetchUltimasLeituras } from '../../hooks/useInfluxHistory';
import { getMqttTopics } from '../../config/fleet';
import { topicsForRegistry, deviceIdsOf } from '../../services/buoyRegistry';
import { fetchSensorHealth, fetchWorkerJobs } from '../../services/sensorHealth';
import { manutencaoAberta } from '../../services/maintenance';
import { resolverSelecao } from '../../utils/dashboard';
import { mensagemDaSessao, resumoBoia } from '../../utils/dashboardView';
import { criarFilaSerial } from '../../utils/filaSerial';
import FleetStrip from '../../components/admin/dashboard/FleetStrip';
import BuoyPanel from '../../components/admin/dashboard/BuoyPanel';
import './AdminDashboard.css';

// Visão geral: a frota primeiro (um card por bóia do cadastro), depois tudo da
// bóia selecionada. Seleção no endereço (?boia=<codigo>) para link e "voltar".
// Só dado real: sem leitura aparece como "sem leitura", nunca 0 nem valor de
// outra bóia.

const AdminDashboard = () => {
  const { buoys, loading: registryLoading, error: registryError, reload: reloadRegistry } = useBuoyRegistry();
  const { messages, receivedAt, addTopics } = useMqtt(getMqttTopics());

  useEffect(() => {
    if (buoys.length) addTopics(topicsForRegistry(buoys));
  }, [buoys]); // eslint-disable-line react-hooks/exhaustive-deps -- addTopics é estável (ref interno do hook)

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
    const id = setInterval(() => setAgoraMs(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  // ── Saúde, coleta do worker e manutenção aberta (Supabase, 60 s) ──────────
  const [healthRows, setHealthRows] = useState([]);
  const [jobs, setJobs] = useState(null); // null = indisponível
  const [manutencao, setManutencao] = useState({}); // codigo -> registro aberto | null
  const codigos = buoys.map((b) => b.codigo).join('|');
  useEffect(() => {
    let cancelled = false;
    const lista = codigos ? codigos.split('|') : [];
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      const [h, j, ...m] = await Promise.allSettled([
        fetchSensorHealth(), fetchWorkerJobs(), ...lista.map((c) => manutencaoAberta(c)),
      ]);
      if (cancelled) return;
      setHealthRows(h.status === 'fulfilled' ? h.value : null);
      setJobs(j.status === 'fulfilled' ? j.value : null);
      setManutencao(Object.fromEntries(lista.map((c, i) => [c, m[i].status === 'fulfilled' ? m[i].value : undefined])));
    };
    load();
    const timer = setInterval(load, 60_000);
    document.addEventListener('visibilitychange', load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, [codigos]);

  // ── Últimas leituras gravadas, por bóia, só dos seriais DELA ───────────────
  // Uma consulta por bóia, em sequência, ao abrir: é o valor de antes da
  // primeira mensagem MQTT (até 30 dias, a janela mais longa de `ultimas`). A fila é compartilhada com o painel da bóia
  // (mín./máx. e status), para não passar do limite de conexões do proxy.
  const [fila] = useState(criarFilaSerial);
  const [ultimas, setUltimas] = useState({}); // codigo -> {rows, erro}
  const carregarUltimas = useCallback((codigo, ids, signal) => (
    fila(() => fetchUltimasLeituras(ids, { periodo: '30d', signal }))
      .then((rows) => { if (!signal?.aborted) setUltimas((u) => ({ ...u, [codigo]: { rows, erro: null } })); })
      .catch((err) => {
        if (err.name === 'AbortError' || signal?.aborted) return;
        setUltimas((u) => ({ ...u, [codigo]: { rows: u[codigo]?.rows ?? [], erro: err.message } }));
      })
  ), [fila]);
  const alvosKey = JSON.stringify(buoys.map((b) => [b.codigo, deviceIdsOf(b)]));
  useEffect(() => {
    const ctrl = new AbortController();
    for (const [codigo, ids] of JSON.parse(alvosKey)) carregarUltimas(codigo, ids, ctrl.signal);
    return () => ctrl.abort();
  }, [alvosKey, carregarUltimas]);

  // ── MQTT por bóia e resumo de cada card ─────────────────────────────────────
  const itens = useMemo(() => buoys.map((buoy) => {
    const d = buoy.deviceId;
    const mqtt = d ? {
      lwt: messages[`${d}/availability`],
      sensores: mensagemDaSessao(messages[`${d}/sensores`], receivedAt[`${d}/sensores`]),
      status: mensagemDaSessao(messages[`${d}/status`], receivedAt[`${d}/status`]),
    } : {};
    const rows = ultimas[buoy.codigo]?.rows ?? [];
    return {
      buoy,
      mqtt,
      ultimas: rows,
      manutencao: manutencao[buoy.codigo],
      resumo: resumoBoia({ buoy, mqtt, ultimas: rows, healthRows, agoraMs }),
    };
  }), [buoys, messages, receivedAt, ultimas, manutencao, healthRows, agoraMs]);

  const atual = itens.find((i) => i.buoy.codigo === selecao.codigo) ?? null;

  // ── Modal "Detalhes da bóia" (Task 4) ───────────────────────────────────────
  // `detalhes` = bóia do modal, ou null. O modal recebe a última mensagem
  // /status da bóia nesta sessão (com _recebidoEm): itens[...].mqtt.status.
  const [detalhes, setDetalhes] = useState(null);

  return (
    <div className="dashboard-content-area">
      <div className="page-header">
        <h1>Visão geral</h1>
        <p>A frota e, abaixo, tudo da bóia selecionada: sensores, histórico, eventos e sistema.</p>
      </div>

      {registryError && (
        <div className="badge badge-offline dash-alert" role="alert">
          <WifiOff size={14} />
          <span>Cadastro de bóias indisponível ({registryError}): a lista pode estar desatualizada.</span>
          <button type="button" className="btn-table btn-sm" onClick={reloadRegistry}>Tentar de novo</button>
        </div>
      )}

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
          {atual && (
            <BuoyPanel
              key={atual.buoy.codigo}
              buoy={atual.buoy}
              mqtt={atual.mqtt}
              resumo={atual.resumo}
              ultimas={atual.ultimas}
              ultimasErro={ultimas[atual.buoy.codigo]?.erro ?? null}
              onAtualizarUltimas={() => carregarUltimas(atual.buoy.codigo, deviceIdsOf(atual.buoy))}
              healthRows={healthRows}
              jobs={jobs}
              fila={fila}
              agoraMs={agoraMs}
              onDetalhes={setDetalhes}
            />
          )}
        </>
      )}

      {/* TODO(Task 4): renderizar o modal aqui, ex.:
          {detalhes && (
            <BuoyDetailsModal
              buoy={detalhes}
              statusMsg={itens.find((i) => i.buoy.codigo === detalhes.codigo)?.mqtt.status ?? null}
              onClose={() => setDetalhes(null)}
            />
          )} */}
    </div>
  );
};

export default AdminDashboard;
