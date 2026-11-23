import { useEffect, useMemo, useState } from 'react';
import { useMqtt } from '../../../hooks/useMqtt';
import { useBuoyRegistry } from '../../../hooks/useBuoyRegistry';
import { usePolling } from '../../../hooks/usePolling';
import { getMqttTopics } from '../../../config/fleet';
import { topicsForRegistry } from '../../../services/buoyRegistry';
import { manutencaoAberta } from '../../../services/maintenance';
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

  const { runNow: recarregarManutencoes } = usePolling(async ({ isCurrent }) => {
    const [saude, manut] = await Promise.all([
      Promise.all([fetchSensorHealth(), fetchWorkerJobs()]).then((r) => ({ ok: true, r }), () => ({ ok: false })),
      Promise.allSettled(codigos.map((c) => manutencaoAberta(c))),
    ]);
    if (!isCurrent()) return;
    if (saude.ok) { setHealthRows(saude.r[0]); setWorkerJobs(saude.r[1]); setHealthError(false); } else setHealthError(true);
    setManutencoes(Object.fromEntries(codigos.map((c, i) => [c, manut[i].status === 'fulfilled' ? manut[i].value : 'erro'])));
  }, POLL_MS, [codigosKey]);

  const rows = useMemo(() => registryBuoys.map((registro) => montarLinhaBoia({
    registro, mensagens: messages, chegadas: receivedAt, agoraMs: agora, brokerConectado: connected,
  })), [registryBuoys, messages, receivedAt, agora, connected]);

  return {
    rows, agora, connected, healthRows, workerJobs, healthError, manutencoes, recarregarManutencoes, registry,
  };
}
