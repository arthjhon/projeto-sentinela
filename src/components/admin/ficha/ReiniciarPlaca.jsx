import React, { useId, useState } from 'react';
import Modal from '../Modal';
import AcaoAviso from '../AcaoAviso';
import { supabase } from '../../../lib/supabase';
import { requestRebootCommand } from '../../../services/otaCommand';
import { logAcao, AUDIT } from '../../../services/auditLog';
import { permissaoReinicio, estadoReinicio } from '../../../utils/reinicioRemoto';
import { serialValido } from '../../../utils/deviceIds';
import { formatHora } from '../../../utils/format';

const MSG_FORBIDDEN = 'Somente administradores reiniciam a placa.';

/**
 * Botão "Reiniciar placa" da ficha: confirmação, envio do comando, auditoria e
 * acompanhamento (regras em utils/reinicioRemoto.js). `conexao` é o estado cru
 * ('online', ...) de useFichaAoVivo; `agoraMs` é o relógio da página.
 */
export default function ReiniciarPlaca({ buoy, role, isFallback, conexao, statusMsg, agoraMs }) {
  const avisoId = useId();
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [enviadoEmMs, setEnviadoEmMs] = useState(null);
  const [erro, setErro] = useState(null);

  const serial = serialValido(buoy);
  const permissao = permissaoReinicio({ role, isFallback, serial, conexao, firmware: statusMsg?.firmware });
  const estado = enviadoEmMs === null ? null : estadoReinicio({ enviadoEmMs, agoraMs, statusMsg });
  const ocupado = enviando || estado === 'aguardando';
  const bloqueado = !permissao.permitido || ocupado;

  const confirmar = async () => {
    setEnviando(true);
    setErro(null);
    const r = await requestRebootCommand(supabase, buoy.codigo);
    if (r.ok) {
      await logAcao(AUDIT.BOIA_REINICIAR, buoy.codigo, { serial });
      // hora do navegador (não a do servidor): estadoReinicio compara com _recebidoEm/agoraMs
      setEnviadoEmMs(Date.now());
    } else {
      setEnviadoEmMs(null);
      setErro(r.code === 'forbidden' ? MSG_FORBIDDEN : r.message);
    }
    setEnviando(false);
    setConfirmando(false);
  };

  let linha = null;
  if (erro) linha = erro;
  else if (estado === 'aguardando') linha = `Comando enviado às ${formatHora(enviadoEmMs)}; aguardando a placa voltar.`;
  else if (estado === 'confirmado') linha = 'Placa reiniciou (comando remoto).';
  else if (estado === 'sem-confirmacao') linha = 'A placa não confirmou o reinício em 3 min.';

  return (
    <div className="ficha-reiniciar">
      <button
        type="button"
        className="btn-table"
        onClick={() => { setErro(null); setConfirmando(true); }}
        disabled={bloqueado}
        aria-busy={ocupado || undefined}
        title={!permissao.permitido ? permissao.motivo : undefined}
        aria-describedby={!permissao.permitido && !ocupado ? avisoId : undefined}
      >
        Reiniciar placa
      </button>
      {!ocupado && <AcaoAviso id={avisoId}>{!permissao.permitido && permissao.motivo}</AcaoAviso>}
      {linha && <p className="text-muted" role="status">{linha}</p>}

      {confirmando && (
        <Modal
          title={`Reiniciar a placa ${serial}?`}
          size="sm"
          onClose={() => setConfirmando(false)}
          dismissible={!enviando}
          footer={(
            <>
              <button type="button" className="btn-table" onClick={() => setConfirmando(false)} disabled={enviando}>Cancelar</button>
              <button type="button" className="btn-primary" onClick={confirmar} disabled={enviando}>
                {enviando ? 'Enviando...' : 'Reiniciar'}
              </button>
            </>
          )}
        >
          <p>A placa fica cerca de 30 s offline e volta sozinha. A ação fica registrada na auditoria.</p>
        </Modal>
      )}
    </div>
  );
}
