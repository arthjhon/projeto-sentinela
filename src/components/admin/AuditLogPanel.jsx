import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RotateCw } from 'lucide-react';
import { listarAuditoria, AUDIT_LABELS, LIMITE_AUDITORIA } from '../../services/auditLog';
import { formatDataHoraSeg } from '../../utils/format';
import { paginar } from '../../utils/paginar';
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

const POR_PAGINA = 25;

/** Categoria visual da ação (ponto colorido): prefixo antes do primeiro `_` ou `.`. */
function categoriaAcao(acao) {
  return String(acao ?? '').split(/[._]/)[0] || 'outro';
}

export default function AuditLogPanel({ operadores = [], operadoresIndisponiveis = false }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);
  const [filtroOperador, setFiltroOperador] = useState('');
  const [filtroAcao, setFiltroAcao] = useState('');
  const [pagina, setPagina] = useState(1);

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
      if (minha === requisicaoRef.current) { setLogs(dados); setPagina(1); }
    } catch (err) {
      if (minha === requisicaoRef.current) setErro(err.message);
    } finally {
      if (minha === requisicaoRef.current) setLoading(false);
    }
  }, [filtroOperador, filtroAcao]);

  useEffect(() => { carregar(); }, [carregar]);

  const { itens: visiveis, pagina: paginaAtual, totalPaginas } = paginar(logs, pagina, POR_PAGINA);

  return (
    <div className="audit-panel glass">
      <div className="audit-header">
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
              {visiveis.map(l => (
                <tr key={l.id}>
                  <td data-label="Quando" className="audit-when">{formatDataHoraSeg(l.created_at)}</td>
                  <td data-label="Operador" className="audit-who">{l.operador_nome}</td>
                  <td data-label="Ação" className="audit-acao-cell">
                    <span className="audit-acao" data-cat={categoriaAcao(l.acao)}>{AUDIT_LABELS[l.acao] ?? l.acao}</span>
                  </td>
                  <td data-label="Alvo" className="audit-alvo">{l.entidade_afetada ?? '—'}</td>
                  <td data-label="Detalhes" className="audit-detalhes">{resumirDetalhes(l.detalhes) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!erro && logs.length > POR_PAGINA && (
        <nav className="audit-paginacao" aria-label="Paginação do log">
          <button
            type="button"
            className="btn-table"
            onClick={() => setPagina(paginaAtual - 1)}
            disabled={paginaAtual <= 1}
          >
            Anterior
          </button>
          <span className="audit-pagina-info" role="status">Página {paginaAtual} de {totalPaginas}</span>
          <button
            type="button"
            className="btn-table"
            onClick={() => setPagina(paginaAtual + 1)}
            disabled={paginaAtual >= totalPaginas}
          >
            Próxima
          </button>
        </nav>
      )}
    </div>
  );
}
