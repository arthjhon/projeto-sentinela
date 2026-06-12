import React from 'react';
import { SlidersHorizontal, FlaskConical, Radio } from 'lucide-react';
import { useMockMode } from '../../config/mockData';
import './SettingsPage.css';

const SettingsPage = () => {
  const [mockEnabled, setMockEnabled] = useMockMode();

  return (
    <div className="dashboard-content-area">
      <div className="page-header">
        <h1><SlidersHorizontal size={22} /> Configurações</h1>
        <p>Ajustes gerais da plataforma.</p>
      </div>

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
    </div>
  );
};

export default SettingsPage;
