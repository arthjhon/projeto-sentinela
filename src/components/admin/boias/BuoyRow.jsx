import React from 'react';
import { Wifi, WifiOff, MapPin, ChevronDown, ChevronUp, Wrench } from 'lucide-react';
import { SensorHealthBadges } from '../SensorHealth';
import { healthForDevice } from '../../../services/sensorHealth';
import { TOM_CLASSE } from '../../../utils/dashboardView';
import { formatIdade } from '../../../utils/format';
import { rotuloManutencaoAberta } from '../../../utils/boiasView';

// Tom de conexão -> classe do indicador de bolinha (admin-shared.css)
const INDICADOR = { ok: 'online', warn: 'warning', bad: 'offline', neutral: 'planejada' };

/**
 * Linha da tabela de Bóias (identidade, localização, conexão, bateria, última
 * leitura e a manutenção aberta com os dias decorridos) mais o detalhe quando
 * expandida (`children`). A conexão vem pronta de montarLinhaBoia/estadoConexao.
 */
export default function BuoyRow({ linha, expandida, onToggle, healthRows, manutencao, agoraMs, children }) {
  const rotuloManut = rotuloManutencaoAberta(manutencao, agoraMs);
  const alternar = () => onToggle(linha.id);
  const Wifi_ = linha.conexao === 'online' || linha.conexao === 'sem-leitura' || linha.conexao === 'bancada-sem-leitura' ? Wifi : WifiOff;
  return (
    <>
      <tr className={`buoy-row ${expandida ? 'expanded' : ''}`}>
        <td className="expand-cell">
          <button
            type="button"
            className="expand-btn"
            onClick={alternar}
            aria-expanded={expandida}
            aria-label={`${expandida ? 'Recolher' : 'Expandir'} detalhes da bóia ${linha.id}`}
          >
            {expandida ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
        </td>
        <td className="sensor-id-cell" onClick={alternar}>
          <div className={`status-indicator ${INDICADOR[linha.tom]}`}></div>
          <span className="sc-id">{linha.id}</span>
          <span className="sc-name">{linha.nome}</span>
          {linha.deviceId && <span className="sc-serial" title="Número de série / Device ID">{linha.deviceId}</span>}
          {rotuloManut && (
            <span className={`maint-tag ${manutencao === 'erro' ? 'indisponivel' : ''}`} title="Manutenção aberta">
              <Wrench size={12} aria-hidden="true" /> {rotuloManut}
            </span>
          )}
        </td>
        <td onClick={alternar}>
          <span className="sc-location"><MapPin size={14} /> {linha.local}</span>
          <span className={`badge ${linha.modo === 'campo' ? 'badge-online' : 'badge-planejada'}`} style={{ marginLeft: '8px' }}>
            {linha.modo === 'campo' ? 'Campo' : 'Bancada'}
          </span>
          {linha.deviceId && <SensorHealthBadges health={healthForDevice(healthRows, linha.deviceId, linha.modo)} />}
        </td>
        <td onClick={alternar}>
          <span className={`badge ${TOM_CLASSE[linha.tom]}`}>
            <Wifi_ size={14} /> {linha.rotuloConexao}
          </span>
        </td>
        <td onClick={alternar} data-label="Bateria">
          {linha.bateria == null ? (
            <span className="battery-text text-muted" title="O firmware atual não reporta bateria">--</span>
          ) : (
            <>
              <div className="battery-bar-container">
                <div className={`battery-bar ${linha.bateria > 20 ? 'bg-success' : 'bg-danger'}`} style={{ width: `${linha.bateria}%` }}></div>
              </div>
              <span className="battery-text">{linha.bateria}%</span>
            </>
          )}
        </td>
        <td className="sc-ping" data-label="Última leitura" onClick={alternar} title={linha.idadeLeitura == null ? 'Nenhuma leitura ao vivo recebida nesta sessão' : undefined}>
          {formatIdade(linha.idadeLeitura) ?? '--'}
        </td>
      </tr>
      {expandida && (
        <tr className="details-row">
          <td colSpan="6">{children}</td>
        </tr>
      )}
    </>
  );
}
