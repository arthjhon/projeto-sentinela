import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useBuoyRegistry } from '../../hooks/useBuoyRegistry';
import { useFichaBoia } from '../../components/admin/ficha/useFichaBoia';
import { useFichaAoVivo } from '../../components/admin/ficha/useFichaAoVivo';
import FichaIdentificacao from '../../components/admin/ficha/FichaIdentificacao';
import FichaSensores from '../../components/admin/ficha/FichaSensores';
import FichaLinhaDoTempo from '../../components/admin/ficha/FichaLinhaDoTempo';
import DeviceInfoList from '../../components/admin/dashboard/DeviceInfoList';
import BuoyFormModal from '../../components/admin/boias/BuoyFormModal';
import PageToolbar from '../../components/admin/PageToolbar';
import AcaoAviso from '../../components/admin/AcaoAviso';
import RegistryErrorBanner from '../../components/admin/RegistryErrorBanner';
import { resolverFicha, hrefFicha, linhasSensores } from '../../utils/fichaBoia';
import { formDoRegistro, permissaoAcao, hrefHistorico } from '../../utils/boiasView';
import { serialValido } from '../../utils/deviceIds';
import { normalizeModo } from '../../services/buoyRegistry';
import { TOM_CLASSE } from '../../utils/dashboardView';
import './BuoyFichaPage.css';

const MOTIVO_FALLBACK = 'Cadastro indisponível: ficha só leitura.';
const ID_AVISO = 'ficha-aviso-editar';

function FichaConteudo({ buoy, registry }) {
  const { currentUser } = useAuth();
  const role = currentUser?.role;
  const navigate = useNavigate();
  const [editando, setEditando] = useState(false);
  const ficha = useFichaBoia(buoy, role);
  const vivo = useFichaAoVivo(buoy);

  const serial = serialValido(buoy);
  const modo = normalizeModo(buoy.modo);
  const sensores = linhasSensores({
    saudeAtual: ficha.saudeAtual, calibracoes: ficha.fontes.calibracao, serial, modo, firmwareCalibrado: vivo.statusMsg?.calibrated,
  });

  const permissao = permissaoAcao(role, 'cadastro');
  const podeEditar = permissao.permitido && !registry.isFallback;
  const motivo = !permissao.permitido ? permissao.motivo : registry.isFallback ? MOTIVO_FALLBACK : null;

  const aoSalvar = (novo) => {
    registry.reload();
    ficha.recarregar('cadastro');
    if (novo !== buoy.codigo) navigate(hrefFicha(novo), { replace: true });
  };

  return (
    <div className="dashboard-content-area">
      <PageToolbar inicio={<><span className="ficha-titulo">{buoy.codigo} · {buoy.nome}</span><Link to="/admin/boias/frota">Frota</Link></>}>
        <Link className="btn-table" to={hrefHistorico(buoy.codigo)}>Ver gráficos</Link>
        <button
          type="button"
          className="btn-table"
          onClick={() => setEditando(true)}
          disabled={!podeEditar}
          title={motivo ?? undefined}
          aria-describedby={podeEditar ? undefined : ID_AVISO}
        >
          Editar
        </button>
      </PageToolbar>
      <AcaoAviso id={ID_AVISO}>{motivo && `Editar desabilitado: ${motivo}`}</AcaoAviso>

      <RegistryErrorBanner error={registry.isFallback ? registry.error : null} onRetry={registry.reload} />

      {editando && (
        <BuoyFormModal
          inicial={formDoRegistro(buoy)}
          editando
          codigosExistentes={registry.buoys.map((r) => r.codigo)}
          onClose={() => setEditando(false)}
          onSaved={aoSalvar}
          onFalha={registry.reload}
        />
      )}

      <div className="ficha-grade">
        <section className="ficha-bloco glass" aria-labelledby="ficha-ident">
          <h2 id="ficha-ident">Identificação</h2>
          <FichaIdentificacao buoy={buoy} aberta={ficha.aberta} agoraMs={vivo.agoraMs} onRecarregarManutencao={() => ficha.recarregar('manutencao')} />
        </section>

        <section className="ficha-bloco glass" aria-labelledby="ficha-disp">
          <h2 id="ficha-disp">Dispositivo</h2>
          <p className="ficha-conexao">
            <span className={`badge ${TOM_CLASSE[vivo.conexao.tom]}`}>{vivo.conexao.texto}</span>
          </p>
          <DeviceInfoList statusMsg={vivo.statusMsg} agoraMs={vivo.agoraMs} deployBloco={ficha.ultimoDeploySucesso} />
        </section>

        <section className="ficha-bloco glass" aria-labelledby="ficha-sens">
          <h2 id="ficha-sens">Sensores</h2>
          <FichaSensores linhas={sensores} onTentarDeNovo={ficha.recarregar} />
        </section>

        <section className="ficha-bloco glass" aria-labelledby="ficha-tl">
          <h2 id="ficha-tl">Linha do tempo</h2>
          <FichaLinhaDoTempo fontes={ficha.fontes} agoraMs={vivo.agoraMs} serialAtual={serial} modo={modo} onTentarDeNovo={ficha.recarregar} />
        </section>
      </div>
    </div>
  );
}

export default function BuoyFichaPage() {
  const { codigo } = useParams();
  const registry = useBuoyRegistry();
  const resolvido = resolverFicha({
    codigo, buoys: registry.buoys, loading: registry.loading, isFallback: registry.isFallback,
  });

  if (resolvido.tipo === 'carregando') {
    return <div className="dashboard-content-area"><p className="text-muted" role="status">Carregando bóia…</p></div>;
  }
  if (resolvido.tipo === 'nao-encontrada') {
    return (
      <div className="dashboard-content-area">
        <section className="ficha-bloco glass">
          <h2>Bóia não encontrada</h2>
          <p>O código {codigo} não está no cadastro.</p>
          <Link className="btn-table" to="/admin/boias/frota">Voltar à Frota</Link>
        </section>
      </div>
    );
  }
  if (resolvido.tipo === 'indisponivel') {
    return (
      <div className="dashboard-content-area">
        <RegistryErrorBanner error={registry.error} onRetry={registry.reload} />
        <section className="ficha-bloco glass">
          <p>Cadastro indisponível: não foi possível confirmar a bóia {codigo}.</p>
          <Link className="btn-table" to="/admin/boias/frota">Voltar à Frota</Link>
        </section>
      </div>
    );
  }
  return <FichaConteudo key={codigo} buoy={resolvido.buoy} registry={registry} />;
}
