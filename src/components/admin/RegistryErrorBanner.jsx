import React from 'react';
import { WifiOff } from 'lucide-react';

/**
 * Aviso comum de "cadastro de bóias indisponível". Use com o resultado de
 * useBuoyRegistry: com `isFallback`, a lista exibida NÃO é o cadastro real
 * (última lista lida ou semente), e nenhuma tela deve apresentá-la como real.
 * Estilo em styles/admin-shared.css (carregado pelo AdminLayout).
 *
 * @param {object}   props
 * @param {string|null} props.error     mensagem do hook; vazio = não renderiza nada
 * @param {() => void} [props.onRetry]  botão "Tentar de novo" (omitido sem handler)
 * @param {string}   [props.children]   complemento do texto (ex.: "Deploy bloqueado.")
 */
export default function RegistryErrorBanner({ error, onRetry, children }) {
  if (!error) return null;
  return (
    <div className="badge badge-offline registry-error-banner" role="alert">
      <WifiOff size={14} aria-hidden="true" />
      <span>
        Cadastro de bóias indisponível ({error}): a lista abaixo é provisória e pode não refletir o cadastro real.
        {children ? ` ${children}` : ''}
      </span>
      {onRetry && <button type="button" className="btn-table btn-sm" onClick={onRetry}>Tentar de novo</button>}
    </div>
  );
}
