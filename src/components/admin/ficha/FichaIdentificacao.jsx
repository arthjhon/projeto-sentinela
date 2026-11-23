import React from 'react';
import { LAGOA_LABEL, normalizeModo } from '../../../services/buoyRegistry';
import { rotuloManutencaoAberta } from '../../../utils/boiasView';
import { serialValido } from '../../../utils/deviceIds';
import { formatData } from '../../../utils/format';
import { Row, Muted } from '../dashboard/DeviceInfoList';

/**
 * Bloco "Identificação". `aberta`: registro | null | 'erro' | undefined (carregando),
 * como devolve useFichaBoia. `buoy.modoDesde` (ISO) é quando o modo atual começou.
 */
export default function FichaIdentificacao({ buoy, aberta, agoraMs }) {
  const temCoord = Number.isFinite(buoy.lat) && Number.isFinite(buoy.lng);
  const serial = serialValido(buoy);
  const anteriores = buoy.deviceIdsAnteriores ?? [];
  const modo = normalizeModo(buoy.modo);
  const desde = buoy.modoDesde ? formatData(buoy.modoDesde) : null;

  return (
    <dl>
      <Row label="Código"><code>{buoy.codigo}</code></Row>
      <Row label="Nome">{buoy.nome}</Row>
      <Row label="Lagoa">{LAGOA_LABEL[buoy.lagoa] ?? <Muted>não informada</Muted>}</Row>
      <Row label="Coordenadas">
        {temCoord ? `${buoy.lat.toFixed(5)}, ${buoy.lng.toFixed(5)}` : <Muted>localização não cadastrada</Muted>}
      </Row>
      <Row label="Modo">{modo}{desde && <Muted> · desde {desde}</Muted>}</Row>
      <Row label="Serial atual">
        {serial ? <code>{serial}</code>
          : buoy.deviceId ? <><code>{String(buoy.deviceId)}</code> <Muted>formato inválido: tratado como sem serial</Muted></>
            : <Muted>sem serial cadastrado</Muted>}
      </Row>
      <Row label="Seriais anteriores">
        {anteriores.length ? anteriores.map((s) => <code key={s} className="bdm-chip">{s}</code>) : <Muted>nenhum</Muted>}
      </Row>
      <Row label="Manutenção aberta">
        {aberta === undefined ? <Muted>carregando…</Muted>
          : aberta === 'erro' ? <Muted>{rotuloManutencaoAberta('erro', agoraMs)}</Muted>
            : aberta ? <>{aberta.motivo.split('\n')[0]} <Muted>{rotuloManutencaoAberta(aberta, agoraMs)}</Muted></>
              : 'não'}
      </Row>
    </dl>
  );
}
