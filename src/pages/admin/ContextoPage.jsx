import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBuoyRegistry } from '../../hooks/useBuoyRegistry';
import { deviceIdsOf } from '../../services/buoyRegistry';
import { usePolling } from '../../hooks/usePolling';
import { useContextoAmbiental } from '../../hooks/useContextoAmbiental';
import { DURACOES } from '../../services/influxQueries';
import {
  ESTACOES_LABEL, ESTACOES_COM_DADOS, ESTACAO_PADRAO, janelaAtalho, dominio, PASSO_MS,
  hojeMaceio, inicioValido, rotuloPasso, janelaAtualizada, horaMaceio,
} from '../../services/contextoAmbiental';
import { createDragStore } from '../../utils/dragStore';
import { WATER_PARAMS } from '../../config/waterQuality';
import { CONTEXTO_REFRESH_MS, CONTEXTO_ESPERA_DATA_MS } from '../../config/adminTimings';
import RegistryErrorBanner from '../../components/admin/RegistryErrorBanner';
import ContextoChart from '../../components/admin/ContextoChart';
import PageToolbar from '../../components/admin/PageToolbar';
import './ContextoPage.css';

const ATALHOS = [7, 30, 90];
const DICA = 'Arraste sobre um gráfico para ampliar o período em todos.';
const COR_TURBIDEZ = WATER_PARAMS.find(p => p.key === 'turbidez').color;

export default function ContextoPage() {
  const { buoys, loading: carregandoRegistro, error: erroRegistro, isFallback, reload } = useBuoyRegistry();
  const [buoyCode, setBuoyCode] = useState(null);
  const [estacao, setEstacao] = useState(ESTACAO_PADRAO);
  // `agora` faz parte da janela: toda escolha (atalho, data, duração) corta o eixo no instante dela
  const [janela, setJanela] = useState(() => {
    const agora = new Date();
    return { ...janelaAtalho(30, agora), agora };
  });
  const [mostrarNivel, setMostrarNivel] = useState(false);
  const [zoom, setZoom] = useState(null);
  // arrasto fora do estado da página: mover o mouse não re-renderiza os gráficos
  const dragStore = useMemo(() => createDragStore(), []);

  const buoy = buoys.find(b => b.codigo === buoyCode) ?? buoys[0] ?? null;
  const deviceIds = useMemo(() => deviceIdsOf(buoy), [buoy]);
  const { turbidez, ana } = useContextoAmbiental({
    deviceIds, estacao, inicio: janela.inicio, duracao: janela.duracao, atualizadoEm: janela.agora.getTime(),
    registroCarregado: !carregandoRegistro || buoys.length > 0,
  });
  const domain = useMemo(
    () => zoom ?? dominio(janela.inicio, janela.duracao, janela.agora),
    [zoom, janela.inicio, janela.duracao, janela.agora],
  );

  // o "agora" avança sozinho (aba visível): o eixo e as séries acompanham o tempo
  usePolling(() => setJanela(j => janelaAtualizada(j, new Date(), CONTEXTO_REFRESH_MS)), CONTEXTO_REFRESH_MS);

  // qualquer filtro limpa o zoom
  const alterar = setter => valor => { setter(valor); setZoom(null); dragStore.cancel(); };
  const setBuoy = alterar(setBuoyCode);
  const setEstacaoF = alterar(setEstacao);
  const mudarJanela = patch => {
    const agora = new Date();
    setJanela(j => ({ ...j, ...patch, agora }));
    setZoom(null);
    dragStore.cancel();
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
    esperaData.current = setTimeout(() => aplicarInicio(valor), CONTEXTO_ESPERA_DATA_MS);
  };
  useEffect(() => {
    const espera = esperaData;
    return () => clearTimeout(espera.current);
  }, []);

  const onDragEnd = useCallback(() => {
    const faixa = dragStore.end();
    if (faixa) setZoom(faixa);
  }, [dragStore]);
  const passoMs = PASSO_MS[janela.duracao];
  const dragProps = { passoMs, zoom, dragStore, onDragEnd, domain };

  // soltar o botão fora do gráfico cancela, sem aplicar zoom; soltar dentro é tratado
  // por onDragEnd, que roda antes deste listener
  useEffect(() => {
    window.addEventListener('mouseup', dragStore.cancel);
    return () => window.removeEventListener('mouseup', dragStore.cancel);
  }, [dragStore]);

  // estados dos gráficos estáveis: o gráfico só renderiza quando os dados dele mudam
  const chuva = useMemo(() => ({ ...ana, data: ana.data.chuva }), [ana]);
  const vazao = useMemo(() => ({ ...ana, data: ana.data.vazao }), [ana]);
  const nivel = useMemo(() => ({ ...ana, data: ana.data.nivel }), [ana]);

  const nomeEstacao = ESTACOES_LABEL[estacao];
  const nomeBoia = buoy ? `${buoy.codigo} ${buoy.nome}` : '—';

  return (
    <div className="dashboard-content-area">
      <PageToolbar
        inicio={
          <span>
            Atualizado às {horaMaceio(janela.agora)} (Maceió); renova a cada {CONTEXTO_REFRESH_MS / 60000} min com a aba aberta.
            {' '}Comparação visual: não indica causa.
          </span>
        }
      />

      <RegistryErrorBanner error={isFallback ? erroRegistro : null} onRetry={reload} />

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
        id="turbidez" title={`Turbidez — ${nomeBoia} (NTU)`} unit="NTU" color={COR_TURBIDEZ}
        state={turbidez} {...dragProps}
      />
      <ContextoChart
        id="chuva" title={`Chuva em ${nomeEstacao} (mm por ${rotuloPasso(PASSO_MS[janela.duracao])}, rio acima)`} unit="mm" color="#60a5fa" kind="bar"
        state={chuva} {...dragProps}
      />
      <ContextoChart
        id="vazao" title={`Vazão em ${nomeEstacao} (m³/s)`} unit="m³/s" color="#10b981"
        state={vazao} {...dragProps} rodape={mostrarNivel ? null : DICA}
      />
      {mostrarNivel && (
        <ContextoChart
          id="nivel" title={`Nível em ${nomeEstacao} (cm)`} unit="cm" color="#f59e0b"
          state={nivel} {...dragProps} rodape={DICA}
        />
      )}
    </div>
  );
}
