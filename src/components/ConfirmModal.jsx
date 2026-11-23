import React, { useRef, useState } from 'react';
import { AlertOctagon } from 'lucide-react';
import Modal from './admin/Modal';

/**
 * Confirmação destrutiva sobre o Modal compartilhado (role=dialog, Esc, foco preso
 * e devolvido ao abridor). `text` pode ser texto ou JSX (ex.: nomear a conta).
 * `ocupado` cobre o onConfirm assíncrono: o segundo clique em "Sim" não dispara a ação
 * duas vezes (a ref fecha a janela antes do re-render) e Esc/X/fundo ficam travados.
 * Renderiza só com `isOpen` (o Modal captura o abridor na montagem).
 */
const ConfirmModal = ({ isOpen, title, text, confirmText, cancelText, onConfirm, onCancel }) => {
  const [ocupado, setOcupado] = useState(false);
  const ocupadoRef = useRef(false);

  const executar = async (acao) => {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    setOcupado(true);
    try {
      await acao?.();
    } finally {
      ocupadoRef.current = false;
      setOcupado(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      title={title}
      size="sm"
      onClose={() => executar(onCancel)}
      dismissible={!ocupado}
      footer={(
        <>
          <button type="button" className="btn-table action-btn" onClick={() => executar(onCancel)} disabled={ocupado}>
            {cancelText || 'Cancelar'}
          </button>
          <button type="button" className="btn-table action-btn danger-btn" onClick={() => executar(onConfirm)} disabled={ocupado}>
            {confirmText || 'Sim, Apagar!'}
          </button>
        </>
      )}
    >
      <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
        <AlertOctagon size={32} className="text-danger" aria-hidden="true" style={{ flexShrink: 0 }} />
        <div style={{ margin: 0 }}>{text}</div>
      </div>
    </Modal>
  );
};

export default ConfirmModal;
