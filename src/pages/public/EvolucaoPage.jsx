import React, { useState, useEffect } from 'react';
import { Rss } from 'lucide-react';
import { listarPublicadas, CATEGORIA_COLORS } from '../../services/changelog';
import { getSetting, MONITORAMENTO_INICIO_KEY } from '../../services/settings';
import { diasDesde, marcosDeDias } from '../../utils/milestones';
import './EvolucaoPage.css';

function formatarDataBr(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const EvolucaoPage = () => {
  const [config, setConfig] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        // allSettled (não all): uma falha em getSetting (app_settings ausente/
        // mal configurada — ver nota de dependência em supabase_changelog_schema.sql)
        // não pode derrubar a página inteira se listarPublicadas() funcionou.
        // Nesse caso degradamos para "timeline sem contador de dias" em vez de
        // mostrar o estado de erro — só a falha da entradas é fatal.
        const [cfgResult, entradasResult] = await Promise.allSettled([
          getSetting(MONITORAMENTO_INICIO_KEY, null),
          listarPublicadas(),
        ]);
        if (!ativo) return;

        if (entradasResult.status === 'rejected') {
          throw entradasResult.reason;
        }
        const cfg = cfgResult.status === 'fulfilled' ? cfgResult.value : null;
        const entradas = entradasResult.value;

        const marcos = cfg?.data ? marcosDeDias(cfg.data) : [];
        const itens = [
          ...entradas.map((e) => ({
            data: e.data, categoria: e.categoria, titulo: e.titulo,
            descricao: e.descricao, imagemUrl: e.imagem_url, auto: false,
          })),
          ...marcos,
        ].sort((a, b) => b.data.localeCompare(a.data));

        setConfig(cfg);
        setTimeline(itens);
      } catch (err) {
        if (ativo) setError(err.message);
      } finally {
        if (ativo) setLoading(false);
      }
    })();
    return () => { ativo = false; };
  }, []);

  const dias = config?.data ? diasDesde(config.data) : null;

  return (
    <div className="evolucao-page">
      <div className="evolucao-hero text-center animate-fade-in">
        <div className="evolucao-icon-wrap">
          <Rss size={32} color="var(--primary)" />
        </div>
        <h1 className="gradient-text">Evolução do Projeto</h1>
        <p className="evolucao-subtitle">
          Marcos, novidades e conquistas do Projeto Sentinela ao longo do tempo.
        </p>

        {dias != null && (
          <div className="evolucao-counter">
            <span className="evolucao-counter-value">{dias.toLocaleString('pt-BR')}</span>
            <span className="evolucao-counter-label">dias {config?.rotulo || 'monitorando'}</span>
          </div>
        )}
      </div>

      <div className="evolucao-timeline">
        {loading ? (
          <p className="evolucao-empty">Carregando...</p>
        ) : error ? (
          <p className="evolucao-empty">Não foi possível carregar a evolução do projeto: {error}</p>
        ) : timeline.length === 0 ? (
          <p className="evolucao-empty">Ainda não há marcos publicados.</p>
        ) : (
          timeline.map((item, i) => (
            <div key={`${item.data}-${i}`} className="evolucao-item glass animate-fade-in">
              <div className="evolucao-item-marker" style={{ '--c': CATEGORIA_COLORS[item.categoria] ?? 'var(--primary)' }} />
              <div className="evolucao-item-body">
                <div className="evolucao-item-head">
                  <span className="evolucao-item-date">{formatarDataBr(item.data)}</span>
                  <span
                    className="evolucao-item-badge"
                    style={{ '--c': CATEGORIA_COLORS[item.categoria] ?? 'var(--primary)' }}
                  >
                    {item.categoria}
                  </span>
                </div>
                <h3 className="evolucao-item-title">{item.titulo}</h3>
                {item.descricao && <p className="evolucao-item-desc">{item.descricao}</p>}
                {item.imagemUrl && (
                  <img src={item.imagemUrl} alt="" className="evolucao-item-image" loading="lazy" />
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default EvolucaoPage;
