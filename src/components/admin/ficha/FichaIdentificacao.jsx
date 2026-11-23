import React from 'react';
import { LAGOA_LABEL, normalizeModo } from '../../../services/buoyRegistry';
import { rotuloManutencaoAberta } from '../../../utils/boiasView';
import { formatData } from '../../../utils/format';
import { Row, Muted, SerialRows } from '../dashboard/DeviceInfoList';

/**
 * Bloco "Identificação". `aberta`: registro | null | 'erro' | undefined (carregando),
 * como devolve useFichaBoia. `buoy.modoDesde` (ISO) é quando o modo atual começou.
 */
export default function FichaIdentificacao({ buoy, aberta, agoraMs, onRecarregarManutencao }) {
  const temCoord = Number.isFinite(buoy.lat) && Number.isFinite(buoy.lng);
  const modo = normalizeModo(buoy.modo);
  const desde = buoy.modoDesde ? formatData(buoy.modoDesde) : null;

  return (
    <dl>
      <Row label="Código"><code>{buoy.codigo}</code></Row>
      <Row label="Nome">{buoy.nome}</Row>
      <Row label="Lagoa">{buoy.lagoa ? (LAGOA_LABEL[buoy.lagoa] ?? buoy.lagoa) : <Muted>não informada</Muted>}</Row>
      <Row label="Coordenadas">
        {temCoord ? `${buoy.lat.toFixed(5)}, ${buoy.lng.toFixed(5)}` : <Muted>localização não cadastrada</Muted>}
      </Row>
      <Row label="Modo">{modo}{desde && <Muted> · desde {desde}</Muted>}</Row>
      <SerialRows buoy={buoy} />
      <Row label="Manutenção aberta">
        {aberta === undefined ? <Muted>carregando…</Muted>
          : aberta === 'erro' ? <>
            <Muted>{rotuloManutencaoAberta('erro', agoraMs)}</Muted>
            {onRecarregarManutencao && <> <button type="button" className="btn-table btn-sm" onClick={onRecarregarManutencao}>Tentar de novo</button></>}
          </>
            : aberta ? <>{aberta.motivo.split('\n')[0]} <Muted>{rotuloManutencaoAberta(aberta, agoraMs)}</Muted></>
              : 'não'}
      </Row>
    </dl>
  );
}
