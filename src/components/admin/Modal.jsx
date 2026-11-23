import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { destinoTab } from '../../utils/focusTrap';
import './Modal.css';

// Diálogos abertos, do mais antigo ao mais novo: só o do topo reage a Esc/Tab.
const pilha = [];

const FOCAVEIS = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo modal compartilhado do painel admin (substitui os `crud-modal` copiados
 * em cada página). Portal em document.body (escapa de transform/overflow dos pais),
 * `role="dialog"` + `aria-modal` + `aria-labelledby`, Esc fecha, Tab/Shift+Tab
 * ficam dentro, o foco nasce no título (a menos que um filho já tenha o foco, ex.
 * `autoFocus`) e volta ao elemento que abriu quando o diálogo fecha.
 *
 * Renderize condicionalmente (`{aberto && <Modal ...>}`) ou passe `open={false}`.
 *
 * @param {object}  props
 * @param {React.ReactNode} props.title        título (vira o <h3 id> do diálogo)
 * @param {() => void} props.onClose           Esc, X e clique no fundo chamam isto
 * @param {React.ReactNode} props.children     corpo (use `.form-group`, `.form-grid`)
 * @param {React.ReactNode} [props.footer]     rodapé (botões); vai em `.crud-modal-footer`
 * @param {'sm'|'md'|'lg'} [props.size='md']   largura máxima: 460 / 600 / 760 px
 * @param {boolean} [props.open=true]          false = não renderiza
 * @param {boolean} [props.dismissible=true]   false = Esc/X/fundo não fecham (ex.: gravando)
 * @param {string}  [props.className]          classe extra no diálogo
 * @param {(e: React.FormEvent) => void} [props.onSubmit]  se dado, o corpo+rodapé viram um <form noValidate>
 */
export default function Modal({
  title, onClose, children, footer, size = 'md', open = true, dismissible = true, className = '', onSubmit,
}) {
  const tituloId = useId();
  const dialogRef = useRef(null);
  const tituloRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  useEffect(() => { onCloseRef.current = onClose; dismissibleRef.current = dismissible; });

  useEffect(() => {
    if (!open) return undefined;
    const anterior = document.activeElement;
    if (!dialogRef.current?.contains(document.activeElement)) tituloRef.current?.focus();
    const meu = {};
    pilha.push(meu);

    const onKey = (e) => {
      if (pilha[pilha.length - 1] !== meu) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (dismissibleRef.current) onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focaveis = dialogRef.current.querySelectorAll(FOCAVEIS);
      const ativo = document.activeElement;
      const destino = destinoTab({
        ativo,
        titulo: tituloRef.current,
        primeiro: focaveis[0],
        ultimo: focaveis[focaveis.length - 1],
        dentro: dialogRef.current.contains(ativo),
        shift: e.shiftKey,
      });
      if (destino) { e.preventDefault(); destino.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = pilha.indexOf(meu);
      if (i >= 0) pilha.splice(i, 1);
      if (anterior && typeof anterior.focus === 'function' && document.contains(anterior)) anterior.focus();
    };
  }, [open]);

  if (!open) return null;

  const Corpo = onSubmit ? 'form' : 'div';
  const corpoProps = onSubmit ? { onSubmit, noValidate: true } : {};

  return createPortal(
    <div
      className="crud-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget && dismissible) onClose?.(); }}
    >
      <div
        className={`crud-modal crud-modal-${size} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        ref={dialogRef}
      >
        <div className="crud-modal-header">
          <h3 id={tituloId} tabIndex={-1} ref={tituloRef}>{title}</h3>
          <button type="button" className="btn-close" onClick={onClose} disabled={!dismissible} aria-label="Fechar">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <Corpo className="crud-modal-form" {...corpoProps}>
          <div className="crud-modal-body">{children}</div>
          {footer && <div className="crud-modal-footer">{footer}</div>}
        </Corpo>
      </div>
    </div>,
    document.body,
  );
}
