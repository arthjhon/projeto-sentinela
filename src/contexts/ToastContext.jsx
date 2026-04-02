import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, Info, X, Copy, KeyRound } from 'lucide-react';
import './Toast.css';

const ToastContext = createContext(null);

let idCounter = 0;

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  // Adiciona um toast à pilha
  // types: 'success', 'error', 'info', 'password'
  // autoClose: true (numérico em ms) ou false (fica prendido na tela)
  const addToast = useCallback((message, type = 'info', extraData = null, autoClose = 5000) => {
    const id = ++idCounter;
    setToasts((prev) => [...prev, { id, message, type, extraData, autoClose }]);
    
    // Se autoClose for um número truthy, gera timeout de remoção
    if (autoClose) {
      setTimeout(() => {
        removeToast(id);
      }, autoClose);
    }
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {createPortal(
        <div className="toast-container">
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onRemove={() => removeToast(toast.id)} />
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);

const ToastItem = ({ toast, onRemove }) => {
  const { type, message, extraData, autoClose } = toast;
  const [isExiting, setIsExiting] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(onRemove, 300); // 300ms de animação de fade-out
  };

  const handleCopy = () => {
    if (extraData) {
      navigator.clipboard.writeText(extraData);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const icons = {
    success: <CheckCircle2 className="toast-icon text-success" />,
    error: <AlertCircle className="toast-icon text-danger" />,
    info: <Info className="toast-icon text-primary" />,
    password: <KeyRound className="toast-icon text-warning" />
  };

  return (
    <div className={`toast-card glass ${type} ${isExiting ? 'exiting' : ''}`}>
      <div className="toast-icon-wrapper">
        {icons[type] || icons.info}
      </div>
      <div className="toast-content">
        <p>{message}</p>
        
        {/* Renderização Condicional Especial para Senhas (Exigência do Projeto Sentinela) */}
        {type === 'password' && extraData && (
          <div className="toast-password-box">
            <span className="pwd-text">{extraData}</span>
            <button className="copied-btn" onClick={handleCopy} title="Copiar Senha">
              {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />} 
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        )}
      </div>

      <button className="toast-close" onClick={handleClose}>
        <X size={18} />
      </button>
      
      {/* Barra de progresso caindo, só aparece se for autoClose */}
      {autoClose && (
        <div className="toast-progress-bar" style={{ animationDuration: `${autoClose}ms` }}></div>
      )}
    </div>
  );
};
