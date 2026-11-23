import React, { useState } from 'react';
import { Wifi, WifiOff, Search, Plus } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import Modal from '../../components/admin/Modal';
import RegistryErrorBanner from '../../components/admin/RegistryErrorBanner';
import { CollectionHealth } from '../../components/admin/SensorHealth';
import { useFleetRows } from '../../components/admin/boias/useFleetRows';
import BuoyRow from '../../components/admin/boias/BuoyRow';
import BuoyDetails from '../../components/admin/boias/BuoyDetails';
import BuoyFormModal from '../../components/admin/boias/BuoyFormModal';
import { logAcao, AUDIT } from '../../services/auditLog';
import { getBuoyRegistry, saveBuoyRegistry, normalizeModo } from '../../services/buoyRegistry';
import { FORM_VAZIO, permissaoAcao } from '../../utils/boiasView';
import PageToolbar from '../../components/admin/PageToolbar';
import './SensorsPage.css';

// Casca da página Bóias: busca, cadastro/remoção e a tabela. Os dados vêm de
// useFleetRows; cada linha e cada detalhe são componentes em components/admin/boias/.
const SensorsPage = () => {
  const { currentUser } = useAuth();
  const { addToast } = useToast();
  const {
    rows, agora, connected, healthRows, workerJobs, healthError, manutencoes, recarregarManutencoes, registry,
  } = useFleetRows();
  const { buoys: registryBuoys, loading: registryLoading, error: registryError, reload: reloadRegistry } = registry;

  const [expandedId, setExpandedId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formulario, setFormulario] = useState(null); // { inicial, editando }
  const [aRemover, setARemover] = useState(null);
  const [removendo, setRemovendo] = useState(false);
  // Notas da manutenção por bóia: sobrevivem a fechar o painel, recolher a linha ou filtrar a busca.
  const [notasManut, setNotasManut] = useState({});

  const cadastro = permissaoAcao(currentUser?.role, 'cadastro');

  const abrirCadastro = () => setFormulario({ inicial: FORM_VAZIO, editando: false });

  // deviceId, nome, lagoa e posição vêm do registro FRESCO, lido ao abrir o modal: a
  // linha local pode estar desatualizada (outra sessão trocou o deviceId/posição) e
  // salvar a partir dela reverteria a mudança da outra sessão sem aviso.
  const abrirEdicao = async (linha) => {
    let reg;
    try {
      reg = (await getBuoyRegistry()).find((r) => r.codigo === linha.id);
    } catch (err) {
      addToast(`Não foi possível ler o registro de bóias: ${err.message}`, 'error');
      return;
    }
    // Removida em outra sessão: recusa a edição em vez de recriar a bóia ao salvar.
    if (!reg) {
      addToast(`A bóia ${linha.id} não está mais no registro: foi removida em outra sessão.`, 'error');
      reloadRegistry();
      return;
    }
    setFormulario({
      editando: true,
      inicial: {
        id: linha.id,
        deviceId: reg.deviceId ?? '',
        deviceIdsAnteriores: reg.deviceIdsAnteriores ?? [],
        name: reg.nome ?? linha.nome,
        lagoa: reg.lagoa ?? 'mundau',
        modo: normalizeModo(reg.modo),
        lat: reg.lat ?? '',
        lng: reg.lng ?? '',
      },
    });
  };

  // Registro primeiro: a tabela é derivada dele, então a bóia só some da lista quando
  // a remoção foi gravada. Parte de uma cópia fresca (saveBuoyRegistry substitui o array inteiro).
  const confirmarRemocao = async () => {
    if (removendo) return;
    const id = aRemover;
    const alvo = rows.find((b) => b.id === id);
    setRemovendo(true);
    try {
      const fresh = await getBuoyRegistry();
      await saveBuoyRegistry(fresh.filter((r) => r.codigo !== id));
      logAcao(AUDIT.BOIA_REMOVER, id, { nome: alvo?.nome, deviceId: alvo?.deviceId });
      if (expandedId === id) setExpandedId(null);
      addToast(`Bóia ${id} removida do registro.`, 'success');
    } catch (err) {
      addToast(`Falha ao remover a bóia: ${err.message}`, 'error');
    } finally {
      setRemovendo(false);
      setARemover(null);
      reloadRegistry();
    }
  };

  const termo = searchTerm.toLowerCase();
  const filtradas = rows.filter((b) => b.nome.toLowerCase().includes(termo) || b.id.toLowerCase().includes(termo));

  return (
    <div className="dashboard-content-area boias-frota">
      <PageToolbar
        inicio={
          <>
            <CollectionHealth jobs={workerJobs} unavailable={healthError} />
            <span className={`badge mqtt-badge badge-${connected ? 'online' : 'offline'}`}>
              {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
              MQTT {connected ? 'Online' : 'Offline'}
            </span>
          </>
        }
      >
        <div className="search-bar glass">
          <Search size={18} className="text-muted" />
          <input
            type="text"
            aria-label="Buscar bóia"
            placeholder="Buscar bóia..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        {/* A RLS de app_settings (map_buoys) só aceita escrita de admin; os demais
            perfis veem o botão desabilitado, com a explicação. */}
        <button
          type="button"
          className="btn-primary"
          onClick={abrirCadastro}
          aria-describedby={cadastro.permitido ? undefined : 'aviso-cadastro'}
          disabled={!cadastro.permitido || Boolean(registryError)}
          title={cadastro.motivo ?? (registryError ? 'Cadastro indisponível: não dá para cadastrar com o registro ilegível.' : undefined)}
        >
          <Plus size={18} /> Nova Bóia
        </button>
      </PageToolbar>

      {!cadastro.permitido && <p className="acao-aviso text-muted" id="aviso-cadastro">Nova Bóia, Editar e Remover desabilitados: {cadastro.motivo}</p>}

      <RegistryErrorBanner error={registryError} onRetry={reloadRegistry} />

      {formulario && (
        <BuoyFormModal
          inicial={formulario.inicial}
          editando={formulario.editando}
          codigosExistentes={registryBuoys.map((r) => r.codigo)}
          onClose={() => setFormulario(null)}
          onSaved={reloadRegistry}
          onFalha={reloadRegistry}
        />
      )}

      {aRemover && (
        <Modal
          title="Remover Bóia"
          size="sm"
          onClose={() => setARemover(null)}
          dismissible={!removendo}
          footer={(
            <>
              <button type="button" className="btn-table" onClick={() => setARemover(null)} disabled={removendo}>Cancelar</button>
              <button type="button" className="btn-primary danger-btn" onClick={confirmarRemocao} disabled={removendo}>
                {removendo ? 'Removendo...' : 'Sim, Apagar a Bóia'}
              </button>
            </>
          )}
        >
          <p>
            A bóia {aRemover} sai do registro (mapa, painel e assinaturas MQTT). As leituras já gravadas e o
            histórico de manutenção continuam no banco. Deseja prosseguir?
          </p>
        </Modal>
      )}

      <div className="sensors-list fleet-list glass">
        <table className="sensors-table fleet-table">
          <thead>
            <tr>
              <th className="expand-column"></th>
              <th>Identificação</th>
              <th>Localização</th>
              <th>Status Geral</th>
              <th>Bateria</th>
              <th>Última Leitura</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.length === 0 && (
              <tr>
                <td colSpan="6" className="text-muted fleet-vazio">
                  {registryLoading ? 'Carregando bóias...' : searchTerm ? 'Nenhuma bóia encontrada.' : 'Nenhuma bóia cadastrada.'}
                </td>
              </tr>
            )}
            {filtradas.map((linha) => (
              <BuoyRow
                key={linha.id}
                linha={linha}
                expandida={expandedId === linha.id}
                onToggle={(id) => setExpandedId((atual) => (atual === id ? null : id))}
                healthRows={healthRows}
                manutencao={manutencoes[linha.id]}
                agoraMs={agora}
              >
                <BuoyDetails
                  linha={linha}
                  notas={notasManut[linha.id] ?? ''}
                  onNotas={(texto) => setNotasManut((n) => ({ ...n, [linha.id]: texto }))}
                  onEditar={abrirEdicao}
                  onRemover={setARemover}
                  onMudou={recarregarManutencoes}
                />
              </BuoyRow>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SensorsPage;
