import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ScrollText, RotateCw } from 'lucide-react';
import { listarAuditoria, AUDIT_LABELS, LIMITE_AUDITORIA } from '../../services/auditLog';
import { formatDataHora } from '../../utils/format';
import './AuditLogPanel.css';

// Log de auditoria (backlog 6.1). Aba própria em Configurações
// (/admin/config/auditoria), ao lado de Operadores: auditoria é sobre quem fez
// o quê. Era aba interna da tela de operadores até a reorganização de 2026-11-22.

/** Resumo legível do JSONB, sem despejar o objeto cru na tela. */
function resumirDetalhes(detalhes) {
  if (!detalhes || typeof detalhes !== 'object') return null;
  const partes = Object.entries(detalhes)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => {
      const s = String(v);
      // hashes e afins: mostra só o começo, senão a linha da tabela explode
      return `${k}: ${s.length > 24 ? `${s.slice(0, 24)}…` : s}`;
    });
  return partes.length ? partes.join(' · ') : null;
}

export default function AuditLogPanel({ operadores = [], operadoresIndisponiveis = false }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);
  const [filtroOperador, setFiltroOperador] = useState('');
  const [filtroAcao, setFiltroAcao] = useState('');

  // Token de requisição: trocar o filtro rápido não deixa a resposta antiga
  // sobrescrever a nova (e o spinner só some quando a última termina).
  const requisicaoRef = useRef(0);

  const carregar = useCallback(async () => {
    const minha = ++requisicaoRef.current;
    setLoading(true);
    setErro(null);
    try {
      const dados = await listarAuditoria({
        operador: filtroOperador || undefined,
        acao: filtroAcao || undefined,
      });
      if (minha === requisicaoRef.current) setLogs(dados);
    } catch (err) {
      if (minha === requisicaoRef.current) setErro(err.message);
    } finally {
      if (minha === requisicaoRef.current) setLoading(false);
    }
  }, [filtroOperador, filtroAcao]);

  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div className="audit-panel glass">
      <div className="audit-header">
        <div className="audit-title">
          <ScrollText size={18} className="text-primary" />
          <h3>Log de Auditoria</h3>
        </div>

        <div className="audit-filters">
          <select
            className="audit-select"
            value={filtroOperador}
            disabled={operadoresIndisponiveis}
            onChange={e => setFiltroOperador(e.target.value)}
            aria-label="Filtrar por operador"
          >
            <option value="">{operadoresIndisponiveis ? 'Lista de operadores indisponível' : 'Todos os operadores'}</option>
            {operadores.map(o => (
              <option key={o.id} value={o.id}>{o.username ?? o.name}</option>
            ))}
          </select>

          <select
            className="audit-select"
            value={filtroAcao}
            onChange={e => setFiltroAcao(e.target.value)}
            aria-label="Filtrar por tipo de ação"
          >
            <option value="">Todas as ações</option>
            {Object.entries(AUDIT_LABELS).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>{rotulo}</option>
            ))}
          </select>

          <button className="btn-table action-btn" onClick={carregar} disabled={loading}>
            <RotateCw size={14} /> {loading ? 'Carregando…' : 'Atualizar'}
          </button>
        </div>
      </div>

      {!erro && logs.length >= LIMITE_AUDITORIA && (
        <p className="audit-empty" role="status">
          Mostrando os últimos {LIMITE_AUDITORIA} registros.
        </p>
      )}

      {erro ? (
        <p className="audit-empty">Não foi possível carregar o log: {erro}</p>
      ) : logs.length === 0 && !loading ? (
        <p className="audit-empty">Nenhuma ação registrada para este filtro.</p>
      ) : (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Operador</th>
                <th>Ação</th>
                <th>Alvo</th>
                <th>Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id}>
                  <td className="audit-when">{formatDataHora(l.created_at)}</td>
                  <td className="audit-who">{l.operador_nome}</td>
                  <td><span className="audit-acao">{AUDIT_LABELS[l.acao] ?? l.acao}</span></td>
                  <td className="audit-alvo">{l.entidade_afetada ?? '—'}</td>
                  <td className="audit-detalhes">{resumirDetalhes(l.detalhes) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
