import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBuoyRegistry } from '../../hooks/useBuoyRegistry';
import { deviceIdsOf } from '../../services/buoyRegistry';
import { useContextoAmbiental } from '../../hooks/useContextoAmbiental';
import { DURACOES } from '../../services/influxQueries';
import {
  ESTACOES_LABEL, ESTACOES_COM_DADOS, ESTACAO_PADRAO, janelaAtalho, dominio, PASSO_MS,
  hojeMaceio, inicioValido, rotuloPasso,
} from '../../services/contextoAmbiental';
import ContextoChart from './ContextoChart';
import './ContextoPage.css';

const ATALHOS = [7, 30, 90];
// a data digitada só vale depois de uma pausa (ou ao sair do campo / Enter)
const ESPERA_DATA_MS = 600;

export default function ContextoPage() {
  const { buoys } = useBuoyRegistry();
  const [buoyCode, setBuoyCode] = useState(null);
  const [estacao, setEstacao] = useState(ESTACAO_PADRAO);
  // `agora` faz parte da janela: toda escolha (atalho, data, duração) corta o eixo no instante dela
  const [janela, setJanela] = useState(() => {
    const agora = new Date();
    return { ...janelaAtalho(30, agora), agora };
  });
  const [mostrarNivel, setMostrarNivel] = useState(false);
  const [zoom, setZoom] = useState(null);
  const [drag, setDrag] = useState(null);

  const buoy = buoys.find(b => b.codigo === buoyCode) ?? buoys[0] ?? null;
  const deviceIds = useMemo(() => deviceIdsOf(buoy), [buoy]);
  const { turbidez, ana } = useContextoAmbiental({
    deviceIds, estacao, inicio: janela.inicio, duracao: janela.duracao, atualizadoEm: janela.agora.getTime(),
  });
  const domain = zoom ?? dominio(janela.inicio, janela.duracao, janela.agora);

  // qualquer filtro limpa o zoom
  const alterar = setter => valor => { setter(valor); setZoom(null); setDrag(null); };
  const setBuoy = alterar(setBuoyCode);
  const setEstacaoF = alterar(setEstacao);
  const mudarJanela = patch => {
    const agora = new Date();
    setJanela(j => ({ ...j, ...patch, agora }));
    setZoom(null);
    setDrag(null);
  };

  // "A partir de": rascunho local; só uma data real (inicioValido) é aplicada, após
  // ESPERA_DATA_MS sem digitar ou ao sair do campo / Enter. Atalhos repõem o rascunho.
  const [rascunho, setRascunho] = useState(janela.inicio);
  const [inicioVisto, setInicioVisto] = useState(janela.inicio);
  if (janela.inicio !== inicioVisto) {
    setInicioVisto(janela.inicio);
    setRascunho(janela.inicio);
  }
  const esperaData = useRef(null);
  const aplicarInicio = (valor, saindo = false) => {
    clearTimeout(esperaData.current);
    if (valor !== janela.inicio && inicioValido(valor)) mudarJanela({ inicio: valor });
    else if (saindo) setRascunho(janela.inicio); // data incompleta/inválida: volta à aplicada
  };
  const digitarInicio = valor => {
    setRascunho(valor);
    clearTimeout(esperaData.current);
    esperaData.current = setTimeout(() => aplicarInicio(valor), ESPERA_DATA_MS);
  };
  useEffect(() => {
    const espera = esperaData;
    return () => clearTimeout(espera.current);
  }, []);

  const onDragStart = (id, x) => setDrag({ id, a: x, b: null });
  const onDragMove = (id, x) => setDrag(d => (d && d.id === id ? { ...d, b: x } : d));
  const onDragEnd = () => {
    if (drag && drag.a != null && drag.b != null && drag.a !== drag.b) {
      setZoom([Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)]);
    }
    setDrag(null);
  };
  const onDragCancel = () => setDrag(null);
  const dragProps = { passoMs: PASSO_MS[janela.duracao], zoom, drag, onDragStart, onDragMove, onDragEnd, onDragCancel, domain };

  // sair do gráfico (onDragCancel) ou soltar o botão fora dele cancela, sem aplicar zoom;
  // soltar dentro é tratado por onDragEnd, que roda antes deste listener
  const arrastando = drag != null;
  useEffect(() => {
    if (!arrastando) return;
    const cancelar = () => setDrag(null);
    window.addEventListener('mouseup', cancelar);
    return () => window.removeEventListener('mouseup', cancelar);
  }, [arrastando]);

  const nomeEstacao = ESTACOES_LABEL[estacao];
  const nomeBoia = buoy ? `${buoy.codigo} ${buoy.nome}` : '—';

  return (
    <div className="dashboard-content-area">
      <div className="page-header">
        <h1>Contexto ambiental</h1>
        <p>Turbidez da bóia sobre chuva, vazão e nível da ANA, no mesmo eixo de tempo. Comparação visual: não indica causa.</p>
      </div>

      <div className="ctx-controls glass">
        <label>Bóia
          <select value={buoy?.codigo ?? ''} onChange={e => setBuoy(e.target.value)}>
            {buoys.map(b => <option key={b.codigo} value={b.codigo}>{b.codigo} — {b.nome}</option>)}
          </select>
        </label>
        <label>Estação ANA
          <select value={estacao} onChange={e => setEstacaoF(e.target.value)}>
            {ESTACOES_COM_DADOS.map(c => <option key={c} value={c}>{c} — {ESTACOES_LABEL[c]}</option>)}
          </select>
        </label>
        <div className="ctx-shortcuts" role="group" aria-label="Atalhos de período">
          {ATALHOS.map(d => (
            <button
              key={d} type="button" className="btn-table"
              onClick={() => mudarJanela(janelaAtalho(d, new Date()))}
            >{d} dias</button>
          ))}
        </div>
        <label>A partir de
          <input
            type="date" value={rascunho} max={hojeMaceio(janela.agora)}
            onChange={e => digitarInicio(e.target.value)}
            onBlur={e => aplicarInicio(e.target.value, true)}
            onKeyDown={e => e.key === 'Enter' && aplicarInicio(e.currentTarget.value)}
          />
        </label>
        <label>Duração
          <select value={janela.duracao} onChange={e => mudarJanela({ duracao: e.target.value })}>
            {Object.keys(DURACOES).map(d => <option key={d} value={d}>{parseInt(d, 10)} dias</option>)}
          </select>
        </label>
        <label className="ctx-check">
          <input type="checkbox" checked={mostrarNivel} onChange={e => setMostrarNivel(e.target.checked)} />
          Mostrar nível
        </label>
        {zoom && <button type="button" className="btn-table" onClick={() => setZoom(null)}>Restaurar zoom</button>}
      </div>

      <ContextoChart
        id="turbidez" title={`Turbidez — ${nomeBoia} (NTU)`} unit="NTU" color="#00f0ff"
        state={turbidez} {...dragProps}
      />
      <ContextoChart
        id="chuva" title={`Chuva em ${nomeEstacao} (mm por ${rotuloPasso(PASSO_MS[janela.duracao])}, rio acima)`} unit="mm" color="#60a5fa" kind="bar"
        state={{ ...ana, data: ana.data.chuva }} {...dragProps}
      />
      <ContextoChart
        id="vazao" title={`Vazão em ${nomeEstacao} (m³/s)`} unit="m³/s" color="#10b981"
        state={{ ...ana, data: ana.data.vazao }} {...dragProps}
      />
      {mostrarNivel && (
        <ContextoChart
          id="nivel" title={`Nível em ${nomeEstacao} (cm)`} unit="cm" color="#f59e0b"
          state={{ ...ana, data: ana.data.nivel }} {...dragProps}
        />
      )}
      <p className="text-muted ctx-hint">Arraste sobre um gráfico para ampliar o período em todos.</p>
    </div>
  );
}
