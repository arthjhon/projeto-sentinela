import React from 'react';
import { History } from 'lucide-react';
import { formatDataHora } from '../../../utils/format';
import { statusEfetivo, rotuloStatusDeploy } from '../../../services/otaDeployState';
import { TOM_CLASSE } from '../../../utils/dashboardView';

/**
 * Tabela "Últimos deploys" (firmware_deploys). `pendente` com mais de 15 min é
 * exibido como "sem resposta" — só exibição: o CHECK de `status` não aceita
 * esse valor e a linha não é reescrita.
 *
 * @param {object} p
 * @param {object[]|null} p.deploys  null = ainda não carregou
 * @param {string|null} p.error      falha de leitura: "indisponível", nunca lista vazia
 * @param {number} p.agoraMs
 */
export default function DeployHistory({ deploys, error, agoraMs }) {
  return (
    <section className="ota-section">
      <h2 className="ota-section-title">
        <History size={18} className="text-primary" />
        Últimos deploys
      </h2>
      {error ? (
        <p className="ota-history-note" role="alert">Histórico indisponível ({error}).</p>
      ) : deploys === null ? (
        <p className="ota-history-note">Carregando…</p>
      ) : deploys.length === 0 ? (
        <p className="ota-history-note">Nenhum deploy registrado.</p>
      ) : (
        <div className="ota-history-wrap glass">
          <table className="sensors-table ota-history-table">
            <thead>
              <tr><th>Versão</th><th>Bóia</th><th>Status</th><th>Operador</th><th>Quando</th></tr>
            </thead>
            <tbody>
              {deploys.map(d => {
                const rotulo = rotuloStatusDeploy(statusEfetivo(d, agoraMs));
                return (
                  <tr key={d.id}>
                    <td>{d.versao}</td>
                    <td>{d.boia_id}</td>
                    <td><span className={`badge ${TOM_CLASSE[rotulo.tom]}`}>{rotulo.texto}</span></td>
                    <td>{d.operador_nome || '—'}</td>
                    <td>{formatDataHora(d.data_deploy)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
