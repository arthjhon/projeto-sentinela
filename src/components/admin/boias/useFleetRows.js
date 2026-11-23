import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMqtt } from '../../../hooks/useMqtt';
import { useBuoyRegistry } from '../../../hooks/useBuoyRegistry';
import { usePolling } from '../../../hooks/usePolling';
import { getMqttTopics } from '../../../config/fleet';
import { topicsForRegistry } from '../../../services/buoyRegistry';
import { manutencoesAbertas } from '../../../services/maintenance';
import { useUltimasLeituras } from '../../../hooks/useUltimasLeituras';
import { fetchSensorHealth, fetchWorkerJobs } from '../../../services/sensorHealth';
import { montarLinhaBoia } from '../../../utils/boiasView';

const POLL_MS = 60_000;
const RELOGIO_MS = 5000;

/**
 * Tudo que a tabela de Bóias precisa, pronto: registro (map_buoys), MQTT desta
 * sessão, saúde do detector e manutenção aberta de cada bóia. As linhas saem de
 * montarLinhaBoia (pura, testada); nada fica no navegador e falha de leitura
 * vira estado explícito (`healthError`, manutenção 'erro'), nunca um default.
 */
export function useFleetRows() {
  const { messages, receivedAt, connected, addTopics } = useMqtt(getMqttTopics());
  const registry = useBuoyRegistry();
  const { buoys: registryBuoys } = registry;

  // Bóia cadastrada só no registro (deviceId novo, ainda não em FLEET): inscreve o tópico.
  useEffect(() => {
    if (registryBuoys.length) addTopics(topicsForRegistry(registryBuoys));
  }, [registryBuoys, addTopics]);

  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), RELOGIO_MS);
    return () => clearInterval(id);
  }, []);

  const [healthRows, setHealthRows] = useState([]);
  const [workerJobs, setWorkerJobs] = useState([]);
  const [healthError, setHealthError] = useState(false);
  const [manutencoes, setManutencoes] = useState({}); // codigo -> registro aberto | null | 'erro'

  const codigos = useMemo(() => registryBuoys.map((r) => r.codigo), [registryBuoys]);
  const codigosKey = codigos.join('|');

  // Saúde e coleta do worker (Supabase, 60 s)
  usePolling(async ({ isCurrent }) => {
    let saude;
    try { saude = await Promise.all([fetchSensorHealth(), fetchWorkerJobs()]); } catch { saude = null; }
    if (!isCurrent()) return;
    if (saude) { setHealthRows(saude[0]); setWorkerJobs(saude[1]); setHealthError(false); } else setHealthError(true);
  }, POLL_MS, []);

  // Manutenção aberta: UMA consulta para a frota inteira. `recarregarManutencoes` (após iniciar,
  // cancelar ou concluir) nunca é descartada por uma rodada em andamento: cada chamada faz a sua
  // consulta e só a mais recente é aplicada.
  const pedidoManut = useRef(0);
  const carregarManutencoes = useCallback(async () => {
    const meu = ++pedidoManut.current;
    let resultado;
    try { resultado = await manutencoesAbertas(codigos); } catch { resultado = Object.fromEntries(codigos.map((c) => [c, 'erro'])); }
    if (meu === pedidoManut.current) setManutencoes(resultado);
  }, [codigos]);
  usePolling(() => carregarManutencoes(), POLL_MS, [codigosKey]);

  // Últimas leituras gravadas por bóia (mesma fonte da Visão geral, Status e Firmware):
  // piso da "última leitura" e do estado de conexão logo após o carregamento.
  const { ultimas } = useUltimasLeituras(registryBuoys, { pollMs: POLL_MS });

  const rows = useMemo(() => registryBuoys.map((registro) => montarLinhaBoia({
    registro, mensagens: messages, chegadas: receivedAt, ultimas: ultimas[registro.codigo] ?? [], agoraMs: agora, brokerConectado: connected,
  })), [registryBuoys, messages, receivedAt, ultimas, agora, connected]);

  return {
    rows, agora, connected, healthRows, workerJobs, healthError, manutencoes, recarregarManutencoes: carregarManutencoes, registry,
  };
}
