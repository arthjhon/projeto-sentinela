import { useEffect, useState } from 'react';
import { useMqtt } from '../../../hooks/useMqtt';
import { useUltimasLeituras } from '../../../hooks/useUltimasLeituras';
import { CLOCK_TICK_MS } from '../../../config/adminTimings';
import { topicsForRegistry, deviceIdsOf } from '../../../services/buoyRegistry';
import { conexaoDoRegistro } from '../../../utils/conexaoFrota';
import { mensagemDaSessao, rotuloConexao } from '../../../utils/dashboardView';
import { formatIdade } from '../../../utils/format';
import { serialValido } from '../../../utils/deviceIds';

const SEM_BOIAS = [];
// Nada é assinado de partida: só o serial válido desta bóia (addTopics abaixo).
const SEM_TOPICOS = [];

/**
 * Dados ao vivo de uma bóia (MQTT desta sessão + última leitura gravada), com a mesma
 * conexão da Visão geral. Sem serial válido não assina tópico nenhum.
 *
 * @returns {{
 *   statusMsg: object|null,
 *   conexao: {texto: string, tom: string},
 *   ultimaMs: number|null,
 *   agoraMs: number,
 *   ultimasErro: string|null,
 *   recarregarUltimas: (() => Promise<void>)|null,
 * }}
 */
export function useFichaAoVivo(buoy) {
  const { messages, receivedAt, connected, addTopics } = useMqtt(SEM_TOPICOS);
  const serial = serialValido(buoy);
  const temSerial = deviceIdsOf(buoy).length > 0;
  const { ultimas, erros, recarregar } = useUltimasLeituras(temSerial ? [buoy] : SEM_BOIAS);
  const [agoraMs, setAgoraMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setAgoraMs(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (serial) addTopics(topicsForRegistry([{ deviceId: serial }]));
  }, [serial, addTopics]);

  const { estado, ultimaMs } = conexaoDoRegistro({
    registro: buoy, mensagens: messages, chegadas: receivedAt,
    ultimas: ultimas[buoy.codigo] ?? [], agoraMs, brokerConectado: connected,
  });
  const conexao = rotuloConexao(estado, ultimaMs ? formatIdade(agoraMs - ultimaMs) : null);
  const statusMsg = serial ? mensagemDaSessao(messages[`${serial}/status`], receivedAt[`${serial}/status`]) : null;

  const ultimasErro = erros[buoy.codigo] ?? null;
  const recarregarUltimas = temSerial ? () => recarregar(buoy.codigo) : null;

  return { statusMsg, conexao, ultimaMs, agoraMs, ultimasErro, recarregarUltimas };
}
