import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertOctagon, X } from 'lucide-react';
import './ConfirmModal.css';

const ConfirmModal = ({ isOpen, title, text, confirmText, cancelText, onConfirm, onCancel }) => {
  const [animationClass, setAnimationClass] = useState('');

  useEffect(() => {
    if (isOpen) {
      setAnimationClass('fade-in');
    }
  }, [isOpen]);

  const handleClose = (action) => {
    setAnimationClass('fade-out');
    setTimeout(() => {
      setAnimationClass('');
      if (action === 'confirm') onConfirm();
      if (action === 'cancel') onCancel();
    }, 200); // tempo da animação
  };

  if (!isOpen && animationClass !== 'fade-out') return null;

  return createPortal(
    <div className={`confirm-overlay ${animationClass}`}>
      <div className="confirm-modal text-center">
        <button className="confirm-close-btn" onClick={() => handleClose('cancel')}>
          <X size={20} />
        </button>
        
        <div className="confirm-icon-wrapper">
          <AlertOctagon size={48} className="text-danger" />
        </div>
        
        <h3 className="confirm-title">{title}</h3>
        <p className="confirm-text">{text}</p>

        <div className="confirm-actions">
          <button className="btn-table action-btn" onClick={() => handleClose('cancel')}>
            {cancelText || 'Cancelar'}
          </button>
          <button className="btn-table action-btn danger-btn" onClick={() => handleClose('confirm')}>
            {confirmText || 'Sim, Apagar!'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ConfirmModal;
