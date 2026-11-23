import React from 'react';
import { formatUptime, formatMemoria, formatRssi, estadoFirmware, rotuloRecebido } from '../../../utils/buoyDetails';
import './BuoyDetailsModal.css';

const SEM_LEITURA = 'sem leitura desde que o painel abriu';

export const Row = ({ label, children }) => (
  <div className="bdm-row">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);

export const Muted = ({ children, title }) => <span className="bdm-muted" title={title}>{children}</span>;

/**
 * Lista "Dispositivo": o que a bóia informou no último /status desta sessão (com a idade
 * da mensagem). `deployBloco` = {ok, valor}|{ok:false, erro}|undefined (carregando): fallback
 * do firmware quando não houve /status.
 */
export default function DeviceInfoList({ statusMsg, agoraMs, deployBloco }) {
  const fw = estadoFirmware(statusMsg, deployBloco);
  const rssi = formatRssi(statusMsg?.rssi);
  const memoria = formatMemoria(statusMsg?.free_heap, statusMsg?.total_heap);
  const uptime = formatUptime(statusMsg?.uptime);
  const latencia = Number.isFinite(statusMsg?.mqtt_latency) ? `${Math.round(statusMsg.mqtt_latency)} ms` : null;
  // idade do /status: o valor não é "agora", é o da última mensagem recebida
  const recebido = rotuloRecebido(statusMsg?._recebidoEm, agoraMs);
  const comIdade = (valor) => (valor && <>{valor}{recebido && <Muted> · {recebido}</Muted>}</>);
  const ausente = <Muted>{SEM_LEITURA}</Muted>;

  return (
    <dl>
      <Row label="Placa">{statusMsg?.board ?? ausente}</Row>
      <Row label="Firmware">
        {fw.tipo === 'valor' ? <>{fw.texto}{fw.fonte === 'deploy' && <Muted> segundo o último deploy</Muted>}</>
          : fw.tipo === 'carregando' ? <Muted>carregando…</Muted>
            : fw.tipo === 'falha' ? <Muted>sem /status nesta sessão; leitura do último deploy falhou</Muted>
              : ausente}
      </Row>
      <Row label="Calibrada">{typeof statusMsg?.calibrated === 'boolean' ? (statusMsg.calibrated ? 'Sim' : 'Não') : ausente}</Row>
      <Row label="Tempo ligada">{comIdade(uptime) || ausente}</Row>
      <Row label="Sinal Wi-Fi">{comIdade(rssi) || ausente}</Row>
      <Row label="Memória">{comIdade(memoria) || ausente}</Row>
      <Row label="Latência MQTT">{comIdade(latencia) || ausente}</Row>
    </dl>
  );
}
