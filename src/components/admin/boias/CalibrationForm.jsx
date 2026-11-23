import React, { useCallback, useState } from 'react';
import Modal from '../Modal';
import { useToast } from '../../../contexts/ToastContext';
import { registrarCalibracao } from '../../../services/maintenance';
import { MIN_OBSERVACAO, validarObservacaoCalibracao } from '../../../utils/boiasView';

/**
 * Registra que a calibração de um sensor foi realizada (o protocolo é feito na
 * bancada; aqui fica o registro). Observação obrigatória: padrão/solução usada.
 * Não grava coeficientes. `salvando` impede o envio duplo.
 */
export default function CalibrationForm({ boiaId, sensor, onClose, onSaved }) {
  const { addToast } = useToast();
  const [observacao, setObservacao] = useState('');
  const [tocado, setTocado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  // Foco no commit (callback ref estável): o Modal só leva o foco ao título se nenhum filho o tem.
  const focar = useCallback((el) => { el?.focus(); }, []);
  const validacao = validarObservacaoCalibracao(observacao);
  const mostrarErro = tocado && !validacao.ok;

  const enviar = async (e) => {
    e.preventDefault();
    if (salvando) return;
    setTocado(true);
    if (!validacao.ok) return;
    setSalvando(true);
    try {
      await registrarCalibracao(boiaId, sensor.name, validacao.texto);
      addToast(`Calibração do sensor ${sensor.name} registrada.`, 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      addToast(`Falha ao registrar calibração: ${err.message}`, 'error');
      setSalvando(false);
    }
  };

  return (
    <Modal
      title={`Registrar calibração realizada — ${boiaId}`}
      size="sm"
      onClose={onClose}
      dismissible={!salvando}
      onSubmit={enviar}
      footer={(
        <>
          <button type="button" className="btn-table" onClick={onClose} disabled={salvando}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={salvando}>
            {salvando ? 'Registrando...' : 'Registrar calibração'}
          </button>
        </>
      )}
    >
      <p className="text-muted calib-form-help">
        Registra que a calibração do <strong>{sensor.name}</strong> foi feita na bancada. Não altera
        coeficientes nem o firmware.
      </p>
      <div className="form-group">
        <label htmlFor="calib-obs">Padrão ou solução usada (obrigatório)</label>
        <textarea
          id="calib-obs"
          className={`w-100 calib-textarea ${mostrarErro ? 'input-error' : ''}`}
          rows={3}
          ref={focar}
          maxLength={500}
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          aria-invalid={mostrarErro}
          aria-describedby="calib-obs-ajuda"
          placeholder="Ex.: soluções-tampão pH 4,00 e 7,00, 25 °C"
        />
        <small id="calib-obs-ajuda" className={mostrarErro ? 'text-danger' : 'text-muted'}>
          {mostrarErro ? validacao.erro : `Mínimo ${MIN_OBSERVACAO} caracteres (${validacao.texto.length}/${MIN_OBSERVACAO}).`}
        </small>
      </div>
    </Modal>
  );
}
