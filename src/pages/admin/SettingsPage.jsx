import React, { useState, useEffect } from 'react';
import { SlidersHorizontal, FlaskConical, Radio, Target, Radar, CircleHelp } from 'lucide-react';
import { useMockMode } from '../../config/mockData';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { useReadOnly } from '../../hooks/useReadOnly';
import { getSetting, saveSetting, FUNDING_GOAL_KEY, MAP_COLLECTION_RADIUS_KEY } from '../../services/settings';
import {
  collectionRings,
  DEFAULT_COLLECTION_RADIUS_M, MIN_COLLECTION_RADIUS_M, MAX_COLLECTION_RADIUS_M,
} from '../../utils/collectionRadius';
import { carregarConfiguracoes } from '../../utils/settingsLoad';
import AcessoNegado from '../../components/admin/AcessoNegado';
import AcaoAviso from '../../components/admin/AcaoAviso';
import { MOTIVO_DEMO } from '../../utils/acaoAviso';
import { ehPerfilGestao } from '../../config/adminNav';
import './SettingsPage.css';

const MOEDA = 'BRL';

const SettingsPageConteudo = () => {
  const [mockEnabled, setMockEnabled, mockEstado, recarregarMock] = useMockMode();
  const mockDesconhecido = mockEstado === 'desconhecido';
  const mockCarregando = mockEstado === 'carregando';
  const [salvandoMock, setSalvandoMock] = useState(false);
  const { addToast } = useToast();
  const readOnly = useReadOnly();
  const { currentUser } = useAuth();
  // app_settings: escrita só de admin (RLS) — operador vê, mas não altera
  const podeEditarMock = currentUser?.role === 'admin';

  const handleToggleMock = async (on) => {
    setSalvandoMock(true);
    try {
      await setMockEnabled(on);
      addToast(on
        ? 'Dados simulados ligados para todos os visitantes.'
        : 'Dados simulados desligados: o site mostra só as leituras reais.', 'success');
    } catch (err) {
      addToast(`Falha ao salvar: ${err.message}`, 'error');
    } finally {
      setSalvandoMock(false);
    }
  };

  // 5.4 — meta de financiamento, editável aqui e exibida na página de apoio
  const [meta, setMeta] = useState('');
  const [arrecadado, setArrecadado] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // Raio de coleta desenhado ao redor das bóias no mapa público
  const [raio, setRaio] = useState('');
  const [salvandoRaio, setSalvandoRaio] = useState(false);

  // Falha de leitura NÃO preenche defaults: o campo fica vazio e o "Salvar" bloqueado
  // (salvar gravaria o default por cima do valor real).
  const [erroMeta, setErroMeta] = useState(null);
  const [erroRaio, setErroRaio] = useState(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let ativo = true;
    (async () => {
      const r = await carregarConfiguracoes(getSetting, { metaKey: FUNDING_GOAL_KEY, raioKey: MAP_COLLECTION_RADIUS_KEY });
      if (!ativo) return;
      if (r.meta.ok) {
        setMeta(String(r.meta.valor.meta ?? 0));
        setArrecadado(String(r.meta.valor.arrecadado ?? 0));
      }
      if (r.raio.ok) setRaio(String(r.raio.valor));
      setErroMeta(r.meta.ok ? null : r.meta.erro);
      setErroRaio(r.raio.ok ? null : r.raio.erro);
      setCarregando(false);
    })();
    return () => { ativo = false; };
  }, [tentativa]);

  const recarregar = () => { setCarregando(true); setTentativa((n) => n + 1); };

  const handleSalvarRaio = async () => {
    const n = Number(raio);
    if (!Number.isFinite(n) || n < MIN_COLLECTION_RADIUS_M || n > MAX_COLLECTION_RADIUS_M) {
      addToast(`Informe um raio entre ${MIN_COLLECTION_RADIUS_M} e ${MAX_COLLECTION_RADIUS_M} metros.`, 'error');
      return;
    }
    setSalvandoRaio(true);
    try {
      await saveSetting(MAP_COLLECTION_RADIUS_KEY, { raio_m: Math.round(n) });
      addToast('Raio de coleta atualizado. O mapa público usa o novo valor ao recarregar.', 'success');
    } catch (err) {
      addToast(`Falha ao salvar: ${err.message}`, 'error');
    } finally {
      setSalvandoRaio(false);
    }
  };

  const aneis = collectionRings(raio);

  const handleSalvarMeta = async () => {
    const metaNum = Number(meta);
    const arrecNum = Number(arrecadado);
    if (Number.isNaN(metaNum) || metaNum <= 0) {
      addToast('Informe uma meta maior que zero.', 'error');
      return;
    }
    if (Number.isNaN(arrecNum) || arrecNum < 0) {
      addToast('O valor arrecadado não pode ser negativo.', 'error');
      return;
    }
    setSalvando(true);
    try {
      await saveSetting(FUNDING_GOAL_KEY, { meta: metaNum, arrecadado: arrecNum, moeda: MOEDA });
      addToast('Meta atualizada. A página de apoio já reflete os novos valores.', 'success');
    } catch (err) {
      addToast(`Falha ao salvar: ${err.message}`, 'error');
    } finally {
      setSalvando(false);
    }
  };

  const pct = Number(meta) > 0
    ? Math.min(100, Math.round((Number(arrecadado) / Number(meta)) * 100))
    : 0;

  return (
    <div className="dashboard-content-area">
      <div className="page-header">
        <h1><SlidersHorizontal size={22} /> Configurações</h1>
        <p>Ajustes gerais da plataforma.</p>
      </div>

      <AcaoAviso id="aviso-config">{readOnly && `Ações desabilitadas: ${MOTIVO_DEMO}`}</AcaoAviso>

      {/* Dados simulados */}
      <div className="settings-card glass mt-4">
        <div className="settings-card-icon" data-on={mockEnabled}>
          {mockEnabled ? <FlaskConical size={22} /> : mockDesconhecido ? <CircleHelp size={22} /> : <Radio size={22} />}
        </div>

        <div className="settings-card-body">
          <h3>Dados Simulados (Mock)</h3>
          <p>
            {mockDesconhecido
              ? 'Não foi possível ler o estado atual. O site público pode estar mostrando dados simulados: o interruptor fica bloqueado até a leitura funcionar.'
              : mockEnabled
                ? 'A dashboard de monitoramento exibe dados simulados enquanto a bóia não está em operação.'
                : 'A dashboard usa os dados reais da bóia via MQTT.'}
          </p>
          {mockDesconhecido && (
            <button type="button" className="btn-table" onClick={recarregarMock}>Tentar de novo</button>
          )}
          <p className="settings-hint">
            Vale para <strong>todos os visitantes</strong> do site, não só para este navegador.
            Deixe desligado com a bóia em operação; ligue só para demonstrações. O histórico
            simulado é limpo ao desligar.
          </p>
        </div>

        <label
          className="settings-switch"
          title={mockDesconhecido ? 'Estado desconhecido: leitura falhou' : podeEditarMock ? 'Ligar/desligar dados simulados' : 'Só administradores alteram esta opção'}
        >
          <input
            type="checkbox"
            checked={mockEnabled && !mockDesconhecido}
            aria-describedby={!podeEditarMock && readOnly ? 'aviso-config' : undefined}
            disabled={!podeEditarMock || salvandoMock || mockDesconhecido || mockCarregando}
            onChange={(e) => handleToggleMock(e.target.checked)}
          />
          <span className="settings-slider" />
          <span className="settings-switch-label">{mockDesconhecido ? 'Desconhecido' : mockCarregando ? '…' : mockEnabled ? 'Ligado' : 'Desligado'}</span>
        </label>
      </div>

      {/* 5.4 — Meta de financiamento */}
      <div className="settings-card glass mt-4">
        <div className="settings-card-icon" data-on="true">
          <Target size={22} />
        </div>

        <div className="settings-card-body">
          <h3>Meta de Financiamento</h3>
          <p>Valores exibidos na barra de progresso da página <strong>Apoie a Causa</strong>.</p>
          {erroMeta && (
            <p className="settings-hint text-danger" role="alert">
              Não foi possível ler a meta atual ({erroMeta}); salvar fica bloqueado para não gravar valores em branco por cima.{' '}
              <button type="button" className="btn-table" onClick={recarregar}>Tentar de novo</button>
            </p>
          )}

          <div className="settings-field-row">
            <label className="settings-field">
              <span>Meta (R$)</span>
              <input
                type="number" min="0" step="100"
                value={meta}
                disabled={carregando || Boolean(erroMeta)}
                onChange={(e) => setMeta(e.target.value)}
                placeholder="Ex: 20000"
              />
            </label>
            <label className="settings-field">
              <span>Arrecadado (R$)</span>
              <input
                type="number" min="0" step="100"
                value={arrecadado}
                disabled={carregando || Boolean(erroMeta)}
                onChange={(e) => setArrecadado(e.target.value)}
                placeholder="Ex: 7500"
              />
            </label>
          </div>

          {/* prévia da barra, para o admin conferir antes de salvar */}
          <div className="settings-meta-preview">
            <div className="settings-meta-bar">
              <div className="settings-meta-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="settings-meta-pct">{pct}%</span>
          </div>

          <button className="btn-primary settings-save-btn" onClick={handleSalvarMeta} disabled={salvando || carregando || readOnly || Boolean(erroMeta)} aria-describedby={readOnly ? 'aviso-config' : undefined} title={readOnly ? MOTIVO_DEMO : undefined}>
            {salvando ? 'Salvando...' : 'Salvar Meta'}
          </button>
        </div>
      </div>

      {/* Raio de coleta no mapa público */}
      <div className="settings-card glass mt-4">
        <div className="settings-card-icon" data-on="true">
          <Radar size={22} />
        </div>

        <div className="settings-card-body">
          <h3>Raio de Coleta no Mapa</h3>
          <p>Tamanho da área de cobertura desenhada ao redor de cada bóia no mapa de <strong>Monitoramento</strong>.</p>
          {erroRaio && (
            <p className="settings-hint text-danger" role="alert">
              Não foi possível ler o raio atual ({erroRaio}); salvar fica bloqueado para não gravar o padrão por cima.{' '}
              <button type="button" className="btn-table" onClick={recarregar}>Tentar de novo</button>
            </p>
          )}

          <div className="settings-field-row">
            <label className="settings-field">
              <span>Raio externo (metros)</span>
              <input
                type="number" min={MIN_COLLECTION_RADIUS_M} max={MAX_COLLECTION_RADIUS_M} step="50"
                value={raio}
                disabled={carregando || Boolean(erroRaio)}
                onChange={(e) => setRaio(e.target.value)}
                placeholder={`Ex: ${DEFAULT_COLLECTION_RADIUS_M}`}
              />
            </label>
          </div>

          <p className="settings-hint">
            Entre {MIN_COLLECTION_RADIUS_M} e {MAX_COLLECTION_RADIUS_M} m.{raio !== '' && ` Anéis desenhados: ${aneis.map(r => `${r.radius} m`).join(' · ')}.`}
          </p>

          <button className="btn-primary settings-save-btn" onClick={handleSalvarRaio} disabled={salvandoRaio || carregando || readOnly || Boolean(erroRaio)} aria-describedby={readOnly ? 'aviso-config' : undefined} title={readOnly ? MOTIVO_DEMO : undefined}>
            {salvandoRaio ? 'Salvando...' : 'Salvar Raio'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Guarda de perfil fora do componente: os hooks da tela não rodam para quem
// não pode vê-la (e a regra de hooks não permite retorno antecipado depois deles).
const SettingsPage = () => {
  const { currentUser } = useAuth();
  if (!ehPerfilGestao(currentUser?.role)) {
    return <AcessoNegado>Você não possui privilégios de Administrador para consultar as configurações do site público.</AcessoNegado>;
  }
  return <SettingsPageConteudo />;
};

export default SettingsPage;
