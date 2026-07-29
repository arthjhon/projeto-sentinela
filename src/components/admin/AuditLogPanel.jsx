import React, { useState, useEffect, useCallback } from 'react';
import { ScrollText, RotateCw } from 'lucide-react';
import { listarAuditoria, AUDIT_LABELS } from '../../services/auditLog';
import './AuditLogPanel.css';

// Log de auditoria (backlog 6.1). Vive dentro de /admin/operadores como uma
// aba, e não numa rota nova: auditoria é sobre quem fez o quê, então fica
// junto de onde os operadores são geridos.

function formatarData(iso) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

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

export default function AuditLogPanel({ operadores = [] }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);
  const [filtroOperador, setFiltroOperador] = useState('');
  const [filtroAcao, setFiltroAcao] = useState('');

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      setLogs(await listarAuditoria({
        operador: filtroOperador || undefined,
        acao: filtroAcao || undefined,
      }));
    } catch (err) {
      setErro(err.message);
    } finally {
      setLoading(false);
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
            onChange={e => setFiltroOperador(e.target.value)}
            aria-label="Filtrar por operador"
          >
            <option value="">Todos os operadores</option>
            {operadores.map(o => (
              <option key={o.id} value={o.id}>{o.username}</option>
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
                  <td className="audit-when">{formatarData(l.created_at)}</td>
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
