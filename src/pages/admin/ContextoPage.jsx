import React, { useMemo, useState } from 'react';
import { useBuoyRegistry } from '../../hooks/useBuoyRegistry';
import { deviceIdsOf } from '../../services/buoyRegistry';
import { useContextoAmbiental } from '../../hooks/useContextoAmbiental';
import {
  ESTACOES_LABEL, ESTACOES_COM_DADOS, ESTACAO_PADRAO, janelaAtalho, dominio,
} from '../../services/contextoAmbiental';
import ContextoChart from './ContextoChart';
import './ContextoPage.css';

const ATALHOS = [7, 30, 90];
const DURACOES = ['7d', '30d', '90d', '180d'];

export default function ContextoPage() {
  const { buoys } = useBuoyRegistry();
  const [buoyCode, setBuoyCode] = useState(null);
  const [estacao, setEstacao] = useState(ESTACAO_PADRAO);
  const [janela, setJanela] = useState(() => janelaAtalho(30, new Date()));
  const [mostrarNivel, setMostrarNivel] = useState(false);
  const [zoom, setZoom] = useState(null);
  const [drag, setDrag] = useState(null);

  const buoy = buoys.find(b => b.codigo === buoyCode) ?? buoys[0] ?? null;
  const deviceIds = useMemo(() => deviceIdsOf(buoy), [buoy]);
  const { turbidez, ana } = useContextoAmbiental({
    deviceIds, estacao, inicio: janela.inicio, duracao: janela.duracao,
  });
  const [agora] = useState(() => new Date());
  const domain = zoom ?? dominio(janela.inicio, janela.duracao, agora);

  // qualquer filtro limpa o zoom
  const alterar = setter => valor => { setter(valor); setZoom(null); setDrag(null); };
  const setBuoy = alterar(setBuoyCode);
  const setEstacaoF = alterar(setEstacao);
  const setJanelaF = alterar(setJanela);

  const onDragStart = (id, x) => setDrag({ id, a: x, b: null });
  const onDragMove = (id, x) => setDrag(d => (d && d.id === id ? { ...d, b: x } : d));
  const onDragEnd = () => {
    if (drag && drag.a != null && drag.b != null && drag.a !== drag.b) {
      setZoom([Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)]);
    }
    setDrag(null);
  };
  const dragProps = { zoom, drag, onDragStart, onDragMove, onDragEnd, domain };

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
              onClick={() => setJanelaF(janelaAtalho(d, new Date()))}
            >{d} dias</button>
          ))}
        </div>
        <label>A partir de
          <input
            type="date" value={janela.inicio}
            onChange={e => e.target.value && setJanelaF({ ...janela, inicio: e.target.value })}
          />
        </label>
        <label>Duração
          <select value={janela.duracao} onChange={e => setJanelaF({ ...janela, duracao: e.target.value })}>
            {DURACOES.map(d => <option key={d} value={d}>{parseInt(d, 10)} dias</option>)}
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
        id="chuva" title={`Chuva em ${nomeEstacao} (mm, rio acima)`} unit="mm" color="#60a5fa" kind="bar"
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
