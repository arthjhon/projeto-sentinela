import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertOctagon, X } from 'lucide-react';
import './ConfirmModal.css';

const ConfirmModal = ({ isOpen, title, text, confirmText, cancelText, onConfirm, onCancel }) => {
  // `saindo` só dura a animação de saída; `ocupado` cobre também o onConfirm
  // assíncrono, para o segundo clique em "Sim" não disparar a ação duas vezes
  // (a ref fecha a janela antes do re-render).
  const [saindo, setSaindo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const ocupadoRef = useRef(false);

  const handleClose = async (action) => {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    setOcupado(true);
    setSaindo(true);
    await new Promise((resolve) => setTimeout(resolve, 200)); // tempo da animação
    setSaindo(false);
    try {
      if (action === 'confirm') await onConfirm?.();
      if (action === 'cancel') await onCancel?.();
    } finally {
      ocupadoRef.current = false;
      setOcupado(false);
    }
  };

  if (!isOpen && !saindo) return null;

  const animationClass = saindo ? 'fade-out' : 'fade-in';

  return createPortal(
    <div className={`confirm-overlay ${animationClass}`}>
      <div className="confirm-modal text-center">
        <button className="confirm-close-btn" onClick={() => handleClose('cancel')} disabled={ocupado} aria-label="Fechar">
          <X size={20} />
        </button>
        
        <div className="confirm-icon-wrapper">
          <AlertOctagon size={48} className="text-danger" />
        </div>
        
        <h3 className="confirm-title">{title}</h3>
        <p className="confirm-text">{text}</p>

        <div className="confirm-actions">
          <button className="btn-table action-btn" onClick={() => handleClose('cancel')} disabled={ocupado}>
            {cancelText || 'Cancelar'}
          </button>
          <button className="btn-table action-btn danger-btn" onClick={() => handleClose('confirm')} disabled={ocupado}>
            {confirmText || 'Sim, Apagar!'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ConfirmModal;
