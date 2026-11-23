import React, { useCallback, useState } from 'react';
import { Wrench, FileText, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import Modal from '../Modal';
import { useToast } from '../../../contexts/ToastContext';
import { iniciarManutencao, finalizarManutencao, cancelarManutencao, SEM_MANUTENCAO_ABERTA } from '../../../services/maintenance';
import { formatIdade } from '../../../utils/format';
import { ICONES_SENSOR } from './sensorIcons';

/** Pede o motivo (obrigatório) e abre a manutenção. Renderize condicionalmente. */
export function MaintenanceStartModal({ boiaId, onClose, onStarted }) {
  const { addToast } = useToast();
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  // Foco no commit (callback ref estável): o Modal só leva o foco ao título se nenhum filho o tem.
  const focar = useCallback((el) => { el?.focus(); }, []);

  const enviar = async (e) => {
    e.preventDefault();
    if (salvando || !motivo.trim()) return;
    setSalvando(true);
    try {
      await iniciarManutencao(boiaId, motivo);
      addToast(`Bóia ${boiaId} entrou em modo manutenção.`, 'success');
      onStarted?.();
      onClose();
    } catch (err) {
      addToast(err.message, 'error');
      setSalvando(false);
    }
  };

  return (
    <Modal
      title={`Entrar em Modo Manutenção — ${boiaId}`}
      size="sm"
      onClose={onClose}
      dismissible={!salvando}
      onSubmit={enviar}
      footer={(
        <>
          <button type="button" className="btn-table" onClick={onClose} disabled={salvando}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={!motivo.trim() || salvando}>
            {salvando ? 'Registrando...' : 'Iniciar Manutenção'}
          </button>
        </>
      )}
    >
      <div className="form-group">
        <label htmlFor="manut-motivo">Motivo da intervenção</label>
        <input
          id="manut-motivo"
          type="text"
          className="w-100"
          ref={focar}
          maxLength={120}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ex: troca do sensor de pH"
        />
      </div>
    </Modal>
  );
}

/**
 * Painel da manutenção ABERTA. "Fechar painel" só esconde o painel (a manutenção
 * continua aberta); "Cancelar manutenção" fecha o registro de verdade;
 * "Salvar e concluir" exige notas. As notas são do dono do painel (por bóia, em
 * SensorsPage): sobrevivem a fechar o painel, recolher a linha ou filtrar a busca, e
 * nunca passam para outra bóia. Se a manutenção já não está aberta (outra sessão a
 * fechou), `onDesatualizado` recarrega o detalhe. `salvando` impede o envio duplo.
 */
export function MaintenancePanel({ linha, notas, onNotas, onFecharPainel, onEncerrada, onDesatualizado }) {
  const { addToast } = useToast();
  const [salvando, setSalvando] = useState(false);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);

  const concluir = async () => {
    if (salvando || !notas.trim()) return;
    setSalvando(true);
    try {
      await finalizarManutencao(linha.id, notas);
      addToast(`Log salvo! A bóia ${linha.id} voltou a operar em modo normal.`, 'success');
      onEncerrada();
    } catch (err) {
      addToast(`Não foi possível fechar a manutenção: ${err.message}`, 'error');
      setSalvando(false);
      if (err.code === SEM_MANUTENCAO_ABERTA) onDesatualizado();
    }
  };

  const cancelar = async () => {
    if (salvando) return;
    setSalvando(true);
    try {
      await cancelarManutencao(linha.id, notas);
      addToast(`Manutenção da bóia ${linha.id} cancelada.`, 'success');
      setConfirmarCancelar(false);
      onEncerrada();
    } catch (err) {
      addToast(`Não foi possível cancelar a manutenção: ${err.message}`, 'error');
      setSalvando(false);
      if (err.code === SEM_MANUTENCAO_ABERTA) { setConfirmarCancelar(false); onDesatualizado(); }
    }
  };

  return (
    <div className="maintenance-panel animate-fade-in">
      <div className="maintenance-header">
        <h4><Wrench size={18} className="text-warning" /> Painel de Diagnóstico Técnico: {linha.id}</h4>
        <div className="maintenance-header-actions">
          <button type="button" className="btn-table action-btn btn-sm" onClick={onFecharPainel} disabled={salvando}
            title="Esconde o painel; a manutenção continua aberta">
            Fechar painel
          </button>
          <button type="button" className="btn-table action-btn btn-sm danger-btn" onClick={() => setConfirmarCancelar(true)} disabled={salvando}>
            Cancelar manutenção
          </button>
        </div>
      </div>
      <p className="text-muted maintenance-aviso">
        A manutenção continua aberta até ser concluída ou cancelada. Fechar o painel não a encerra.
      </p>
      <div className="maintenance-body">
        <div className="maintenance-test-section glass">
          <div className="test-header d-flex-between">
            <span>Diagnóstico ao Vivo</span>
            <span className="text-muted" style={{ fontSize: '0.8rem' }}>
              {linha.idadeLeitura == null ? 'nenhuma leitura nesta sessão' : `última leitura ${formatIdade(linha.idadeLeitura)}`}
            </span>
          </div>
          <div className="test-list">
            {linha.sensores.map((sensor) => {
              const Icone = ICONES_SENSOR[sensor.key];
              return (
                <div key={sensor.key} className="test-item">
                  <div className="test-item-info">
                    <Icone size={16} className="text-muted" />
                    <span>{sensor.name}</span>
                  </div>
                  <div className="test-item-action">
                    {sensor.diag === 'ok' ? (
                      <span className="status-success"><CheckCircle2 size={14} /> OK · {sensor.valor}</span>
                    ) : sensor.diag === 'sem-valor' ? (
                      <span className="status-warn"><AlertTriangle size={14} /> Leitura sem valor</span>
                    ) : (
                      <span className="status-fail"><XCircle size={14} /> Sem leitura recente</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="maintenance-report-section glass">
          <div className="test-header">
            <span><FileText size={16} /> Registro Oficial de Intervenção</span>
          </div>
          <div className="report-input">
            <textarea
              className="maintenance-textarea"
              aria-label="Registro da intervenção"
              placeholder="Descreva as peças substituídas, limpeza realizada, recalibração ou quaisquer anomalias..."
              value={notas}
              onChange={(e) => onNotas(e.target.value)}
            />
          </div>
          <div className="report-footer">
            <button type="button" className="btn-primary" onClick={concluir} disabled={!notas.trim() || salvando}>
              {salvando ? 'Salvando...' : 'Salvar e Concluir'}
            </button>
          </div>
        </div>
      </div>

      {confirmarCancelar && (
        <Modal
          title={`Cancelar manutenção — ${linha.id}`}
          size="sm"
          onClose={() => setConfirmarCancelar(false)}
          dismissible={!salvando}
          footer={(
            <>
              <button type="button" className="btn-table" onClick={() => setConfirmarCancelar(false)} disabled={salvando}>Voltar</button>
              <button type="button" className="btn-primary danger-btn" onClick={cancelar} disabled={salvando}>
                {salvando ? 'Cancelando...' : 'Cancelar manutenção'}
              </button>
            </>
          )}
        >
          <p>
            Fecha o registro de manutenção da bóia agora, com a nota &quot;cancelada&quot;. A bóia deixa de
            aparecer como &quot;em manutenção&quot; no painel e no detector. O registro continua no histórico.
          </p>
          {notas.trim() && (
            <p>O texto que você digitou no registro de intervenção será salvo junto com o cancelamento.</p>
          )}
        </Modal>
      )}
    </div>
  );
}
