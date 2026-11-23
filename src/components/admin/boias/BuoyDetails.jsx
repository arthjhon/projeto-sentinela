import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wrench, History, FileText, Edit2, Trash2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useBuoyDetails } from './useBuoyDetails';
import { MaintenancePanel, MaintenanceStartModal } from './MaintenancePanel';
import CalibrationForm from './CalibrationForm';
import { ICONES_SENSOR } from './sensorIcons';
import { formatInterval } from '../../../utils/buoyRuntime';
import { hrefFicha } from '../../../utils/fichaBoia';
import {
  divergeFirmware, hrefHistorico, permissaoAcao, rotuloCalibracao,
} from '../../../utils/boiasView';

/** Botão desabilitado (nunca escondido) com a explicação no tooltip. */
function BotaoAcao({ permissao, className, onClick, btnRef, descrito, children }) {
  return (
    <button
      ref={btnRef}
      aria-describedby={permissao.permitido ? undefined : descrito}
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
 * Detalhe expandido de uma bóia: coordenadas, sensores com calibração e ações
 * (o histórico e os dados do dispositivo moram na ficha da bóia). Os dados persistidos são desta bóia (useBuoyDetails) e
 * somem ao fechar a linha.
 */
export default function BuoyDetails({ linha, notas, onNotas, onEditar, onRemover, onMudou }) {
  const { currentUser } = useAuth();
  const role = currentUser?.role;
  const { aberta, calibracoes, error, carregando, recarregar } = useBuoyDetails(linha.id);
  const [painelAberto, setPainelAberto] = useState(false);
  const [pedindoMotivo, setPedindoMotivo] = useState(false);
  const [calibrando, setCalibrando] = useState(null); // sensor com o formulário aberto
  const gatilhoManutencao = useRef(null);
  // "Fechar painel" troca o painel pelo botão "Continuar Manutenção": o foco volta a ele
  // (efeito depois do commit, quando o botão já existe).
  const focarGatilhoAoFechar = useRef(false);
  useEffect(() => {
    if (!painelAberto && focarGatilhoAoFechar.current) {
      focarGatilhoAoFechar.current = false;
      gatilhoManutencao.current?.focus();
    }
  }, [painelAberto]);

  const cadastro = permissaoAcao(role, 'cadastro');
  const manutencao = permissaoAcao(role, 'manutencao');
  const calibracao = permissaoAcao(role, 'calibracao');
  const diverge = divergeFirmware(linha.saude);
  const idAviso = `acao-aviso-${linha.id}`;
  const manutencaoEfetiva = error
    ? { permitido: false, motivo: 'Estado da manutenção indisponível: recarregue a página.' }
    : manutencao;
  // Motivos dos botões desabilitados, visíveis sem hover (toque): uma linha, sem repetição.
  const avisos = [...new Set([cadastro, calibracao, manutencaoEfetiva].filter((p) => !p.permitido).map((p) => p.motivo))];

  const aposMudanca = async () => { await recarregar(); onMudou?.(); };

  return (
    <div className="details-container animate-fade-in">
      <div className="details-info-grid">
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
      </div>

      {painelAberto && aberta ? (
        <MaintenancePanel
          linha={linha}
          notas={notas}
          onNotas={onNotas}
          onDesatualizado={aposMudanca}
          onFecharPainel={() => { focarGatilhoAoFechar.current = true; setPainelAberto(false); }}
          onEncerrada={async () => {
            setPainelAberto(false);
            onNotas('');
            await aposMudanca();
            // o painel (e o botão que abriu o diálogo) saiu da tela: devolve o foco ao gatilho da manutenção
            gatilhoManutencao.current?.focus();
          }}
        />
      ) : (
        <>
          <div className="attached-sensors-section">
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
                      {registro?.observacao && <span className="calib-obs text-muted">{registro.observacao}</span>}
                      {diverge && (
                        <span className="calib-diverge" role="status">
                          <AlertTriangle size={12} aria-hidden="true" /> firmware informa não calibrado
                        </span>
                      )}
                      <BotaoAcao
                        permissao={calibracao}
                        descrito={idAviso}
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
          <div className="details-footer">
            <BotaoAcao permissao={cadastro} descrito={idAviso} className="btn-table action-btn" onClick={() => onEditar(linha)}>
              <Edit2 size={16} /> Editar
            </BotaoAcao>
            <BotaoAcao permissao={cadastro} descrito={idAviso} className="btn-table action-btn danger-btn" onClick={() => onRemover(linha.id)}>
              <Trash2 size={16} /> Remover
            </BotaoAcao>
            <Link className="btn-table action-btn" to={hrefFicha(linha.id)}>
              <FileText size={16} /> Abrir ficha
            </Link>
            <Link className="btn-table action-btn" to={hrefHistorico(linha.id)}>
              <History size={16} /> Ver histórico e exportar
            </Link>
            <BotaoAcao
              permissao={manutencaoEfetiva}
              descrito={idAviso}
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
          {avisos.length > 0 && (
            <p className="acao-aviso text-muted" id={idAviso}>
              Ações desabilitadas: {avisos.join(' ')}
            </p>
          )}
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
