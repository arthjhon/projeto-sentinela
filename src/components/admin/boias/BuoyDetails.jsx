import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wrench, History, Edit2, Trash2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { HealthEvents } from '../SensorHealth';
import { useBuoyDetails } from './useBuoyDetails';
import { MaintenancePanel, MaintenanceStartModal } from './MaintenancePanel';
import CalibrationForm from './CalibrationForm';
import { ICONES_SENSOR } from './sensorIcons';
import { formatInterval } from '../../../utils/buoyRuntime';
import { formatData, formatIdade, formatRssi, formatUptime } from '../../../utils/format';
import {
  divergeFirmware, hrefHistorico, permissaoAcao, rotuloCalibracao,
} from '../../../utils/boiasView';

/** Botão desabilitado (nunca escondido) com a explicação no tooltip. */
function BotaoAcao({ permissao, className, onClick, btnRef, children }) {
  return (
    <button
      ref={btnRef}
      type="button"
      className={className}
      onClick={onClick}
      disabled={!permissao.permitido}
      title={permissao.motivo}
    >
      {children}
    </button>
  );
}

/**
 * Detalhe expandido de uma bóia: informações, sensores com calibração, histórico
 * de manutenção e ações. Os dados persistidos são desta bóia (useBuoyDetails) e
 * somem ao fechar a linha.
 */
export default function BuoyDetails({ linha, onEditar, onRemover, onMudou }) {
  const { currentUser } = useAuth();
  const role = currentUser?.role;
  const { timeline, aberta, calibracoes, error, carregando, recarregar } = useBuoyDetails(linha.id);
  const [painelAberto, setPainelAberto] = useState(false);
  const [pedindoMotivo, setPedindoMotivo] = useState(false);
  const [calibrando, setCalibrando] = useState(null); // sensor com o formulário aberto
  const gatilhoManutencao = useRef(null);

  const cadastro = permissaoAcao(role, 'cadastro');
  const manutencao = permissaoAcao(role, 'manutencao');
  const calibracao = permissaoAcao(role, 'calibracao');
  const saude = linha.saude;
  const diverge = divergeFirmware(saude);

  const aposMudanca = async () => { await recarregar(); onMudou?.(); };

  const idadeStatus = linha.statusIdadeMs == null
    ? 'sem /status recebido nesta sessão'
    : `recebido ${formatIdade(linha.statusIdadeMs)}`;
  const uptime = formatUptime(saude.uptime);
  const rssi = formatRssi(saude.rssi);

  return (
    <div className="details-container animate-fade-in">
      {linha.deviceId && (
        <div className="mt-2">
          <span className="info-label">Saúde dos sensores</span>
          <HealthEvents deviceId={linha.deviceId} modo={linha.modo} />
        </div>
      )}

      <div className="details-info-grid mt-2">
        {linha.deviceId && (
          <div className="info-block">
            <span className="info-label">Nº de Série / Device ID</span>
            <span className="info-value" style={{ fontFamily: 'monospace', letterSpacing: '0.03em' }}>{linha.deviceId}</span>
          </div>
        )}
        <div className="info-block">
          <span className="info-label">Coordenadas (lat, lng)</span>
          <span className="info-value">{linha.coordenadas}</span>
        </div>
        <div className="info-block">
          <span className="info-label">Intervalo entre Leituras</span>
          <span className="info-value" title="Medido entre as duas últimas leituras recebidas nesta sessão">
            {formatInterval(linha.intervaloMs)}
          </span>
        </div>
        <div className="info-block">
          <span className="info-label">Manutenções</span>
          {error ? (
            <span className="info-value text-danger">indisponível ({error})</span>
          ) : carregando ? (
            <span className="info-value maint-vazio">carregando...</span>
          ) : timeline.length === 0 ? (
            <span className="info-value maint-vazio">nenhum registro</span>
          ) : (
            <ul className="maint-timeline">
              {timeline.slice(0, 4).map((m) => (
                <li key={m.id} className={m.timestamp_fim ? '' : 'aberta'}>
                  <span className="maint-quando">
                    {formatData(m.timestamp_inicio)}
                    {!m.timestamp_fim && ' · em andamento'}
                  </span>
                  <span className="maint-motivo" title={m.motivo}>{m.motivo}</span>
                  <span className="maint-quem">{m.operador_nome}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {rssi && (
          <div className="info-block">
            <span className="info-label">Sinal WiFi (RSSI)</span>
            <span className="info-value">{rssi}</span>
            <span className="info-sub text-muted">{idadeStatus}</span>
          </div>
        )}
        {uptime && (
          <div className="info-block">
            <span className="info-label">Uptime do Dispositivo</span>
            <span className="info-value">{uptime}</span>
            <span className="info-sub text-muted">{idadeStatus}</span>
          </div>
        )}
        {Number.isFinite(saude.mqtt_latency) && (
          <div className="info-block">
            <span className="info-label">Latência MQTT</span>
            <span className="info-value">{saude.mqtt_latency} ms</span>
          </div>
        )}
        {saude.firmware && (
          <div className="info-block">
            <span className="info-label">Firmware</span>
            <span className="info-value" style={{ fontFamily: 'monospace' }}>
              {saude.firmware}{saude.board ? ` · ${saude.board}` : ''}
            </span>
          </div>
        )}
        {typeof saude.calibrated === 'boolean' && (
          <div className="info-block">
            <span className="info-label">Calibração no Firmware</span>
            <span className={`info-value ${saude.calibrated ? '' : 'text-warning'}`}>
              {saude.calibrated ? 'Calibrado' : 'Não calibrado'}
            </span>
          </div>
        )}
      </div>

      {painelAberto && aberta ? (
        <MaintenancePanel
          linha={linha}
          onFecharPainel={() => setPainelAberto(false)}
          onEncerrada={async () => {
            setPainelAberto(false);
            await aposMudanca();
            // o painel (e o botão que abriu o diálogo) saiu da tela: devolve o foco ao gatilho da manutenção
            gatilhoManutencao.current?.focus();
          }}
        />
      ) : (
        <>
          <div className="attached-sensors-section mt-2">
            <h4 className="attached-sensors-title">Sensores Acoplados</h4>
            <div className="attached-sensors-grid">
              {linha.sensores.map((sensor) => {
                const Icone = ICONES_SENSOR[sensor.key];
                const registro = calibracoes?.[sensor.name];
                return (
                  <div key={sensor.key} className="sub-sensor-card glass">
                    <div className="sub-sensor-header">
                      <div className={`sub-sensor-icon ${sensor.classe}`}><Icone size={18} /></div>
                      <span className={`status-indicator mini ${sensor.classe}`}></span>
                    </div>
                    <div className="sub-sensor-body">
                      <span className="sub-sensor-name">{sensor.name}</span>
                      <span className={`sub-sensor-val ${sensor.classe === 'offline' ? 'text-muted' : ''}`}>{sensor.valor}</span>
                      <span className="calib-info">
                        {error ? 'calibração: indisponível'
                          : carregando ? 'calibração: carregando...'
                            : `Calibração ${rotuloCalibracao(registro)}`}
                      </span>
                      {registro?.observacao && <span className="calib-obs text-muted" title={registro.observacao}>{registro.observacao}</span>}
                      {diverge && (
                        <span className="calib-diverge" role="status">
                          <AlertTriangle size={12} aria-hidden="true" /> firmware informa não calibrado
                        </span>
                      )}
                      <BotaoAcao
                        permissao={calibracao}
                        className="btn-table action-btn btn-sm calib-btn"
                        onClick={() => setCalibrando(sensor)}
                      >
                        Registrar calibração realizada
                      </BotaoAcao>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="details-footer" style={{ flexWrap: 'wrap' }}>
            <BotaoAcao permissao={cadastro} className="btn-table action-btn" onClick={() => onEditar(linha)}>
              <Edit2 size={16} /> Editar
            </BotaoAcao>
            <BotaoAcao permissao={cadastro} className="btn-table action-btn danger-btn" onClick={() => onRemover(linha.id)}>
              <Trash2 size={16} /> Remover
            </BotaoAcao>
            <Link className="btn-table action-btn" to={hrefHistorico(linha.id)}>
              <History size={16} /> Ver histórico e exportar
            </Link>
            <BotaoAcao
              permissao={error ? { permitido: false, motivo: 'Estado da manutenção indisponível: recarregue a página.' } : manutencao}
              className="btn-table action-btn maintenance-trigger-btn"
              btnRef={gatilhoManutencao}
              onClick={() => {
                // Já há manutenção aberta (talvez de outro operador): abre o painel direto.
                // Pedir motivo de novo criaria um segundo registro, que o índice único rejeitaria.
                if (aberta) setPainelAberto(true); else setPedindoMotivo(true);
              }}
            >
              <Wrench size={16} />
              {aberta ? 'Continuar Manutenção' : 'Entrar em Modo Manutenção'}
            </BotaoAcao>
          </div>
        </>
      )}

      {pedindoMotivo && (
        <MaintenanceStartModal
          boiaId={linha.id}
          onClose={() => setPedindoMotivo(false)}
          onStarted={async () => { setPainelAberto(true); await aposMudanca(); }}
        />
      )}
      {calibrando && (
        <CalibrationForm
          boiaId={linha.id}
          sensor={calibrando}
          onClose={() => setCalibrando(null)}
          onSaved={aposMudanca}
        />
      )}
    </div>
  );
}
