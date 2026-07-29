import React, { useState, useEffect } from 'react';
import { SlidersHorizontal, FlaskConical, Radio, Target } from 'lucide-react';
import { useMockMode } from '../../config/mockData';
import { useToast } from '../../contexts/ToastContext';
import { getSetting, saveSetting, FUNDING_GOAL_KEY } from '../../services/settings';
import './SettingsPage.css';

const SettingsPage = () => {
  const [mockEnabled, setMockEnabled] = useMockMode();
  const { addToast } = useToast();

  // 5.4 — meta de financiamento, editável aqui e exibida na página de apoio
  const [meta, setMeta] = useState('');
  const [arrecadado, setArrecadado] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    // função interna: setState direto no corpo do effect dispara render em cascata
    let ativo = true;
    (async () => {
      try {
        const atual = await getSetting(FUNDING_GOAL_KEY, { meta: 0, arrecadado: 0 });
        if (!ativo) return;
        setMeta(String(atual.meta ?? 0));
        setArrecadado(String(atual.arrecadado ?? 0));
      } catch (err) {
        if (ativo) addToast(`Não foi possível carregar a meta: ${err.message}`, 'error');
      } finally {
        if (ativo) setCarregando(false);
      }
    })();
    return () => { ativo = false; };
  }, [addToast]);

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
      await saveSetting(FUNDING_GOAL_KEY, { meta: metaNum, arrecadado: arrecNum, moeda: 'BRL' });
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

      {/* Dados simulados */}
      <div className="settings-card glass mt-4">
        <div className="settings-card-icon" data-on={mockEnabled}>
          {mockEnabled ? <FlaskConical size={22} /> : <Radio size={22} />}
        </div>

        <div className="settings-card-body">
          <h3>Dados Simulados (Mock)</h3>
          <p>
            {mockEnabled
              ? 'A dashboard de monitoramento exibe dados simulados enquanto a bóia não está em operação.'
              : 'A dashboard usa os dados reais da bóia via MQTT.'}
          </p>
          <p className="settings-hint">
            Quando a bóia entrar em operação, <strong>desligue</strong> esta opção para remover os
            dados simulados e passar a exibir as leituras reais. O histórico simulado é limpo ao desligar.
          </p>
        </div>

        <label className="settings-switch" title="Ligar/desligar dados simulados">
          <input
            type="checkbox"
            checked={mockEnabled}
            onChange={(e) => setMockEnabled(e.target.checked)}
          />
          <span className="settings-slider" />
          <span className="settings-switch-label">{mockEnabled ? 'Ligado' : 'Desligado'}</span>
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

          <div className="settings-field-row">
            <label className="settings-field">
              <span>Meta (R$)</span>
              <input
                type="number" min="0" step="100"
                value={meta}
                disabled={carregando}
                onChange={(e) => setMeta(e.target.value)}
                placeholder="Ex: 20000"
              />
            </label>
            <label className="settings-field">
              <span>Arrecadado (R$)</span>
              <input
                type="number" min="0" step="100"
                value={arrecadado}
                disabled={carregando}
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

          <button className="btn-primary settings-save-btn" onClick={handleSalvarMeta} disabled={salvando || carregando}>
            {salvando ? 'Salvando...' : 'Salvar Meta'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
