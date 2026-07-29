import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Edit2, Trash2, X, Image as ImageIcon, Eye, EyeOff } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import ConfirmModal from '../../components/ConfirmModal';
import {
  listarTodas, criarEntrada, atualizarEntrada, removerEntrada, uploadImagem,
  CATEGORIAS, CATEGORIA_COLORS,
} from '../../services/changelog';
import { getSetting, saveSetting, MONITORAMENTO_INICIO_KEY } from '../../services/settings';
import './ChangelogPage.css';

const initialFormData = { titulo: '', descricao: '', categoria: 'Hardware', data: '' };

const ChangelogPage = () => {
  const { addToast } = useToast();

  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [formData, setFormData] = useState(initialFormData);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState(null);

  // Data oficial que ancora os marcos automáticos (src/utils/milestones.js)
  const [dataInicio, setDataInicio] = useState('');
  const [rotuloInicio, setRotuloInicio] = useState('');
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const data = await listarTodas();
        if (ativo) setEntries(data);
      } catch (err) {
        if (ativo) setLoadError(err.message);
      } finally {
        if (ativo) setLoading(false);
      }
    })();
    return () => { ativo = false; };
  }, []);

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const atual = await getSetting(MONITORAMENTO_INICIO_KEY, { data: '', rotulo: 'desde o início do projeto' });
        if (!ativo) return;
        setDataInicio(atual.data ?? '');
        setRotuloInicio(atual.rotulo ?? 'desde o início do projeto');
      } catch (err) {
        if (ativo) addToast(`Não foi possível carregar a data oficial: ${err.message}`, 'error');
      } finally {
        if (ativo) setConfigLoading(false);
      }
    })();
    return () => { ativo = false; };
  }, [addToast]);

  const handleSalvarConfig = async () => {
    if (!dataInicio) {
      addToast('Informe a data oficial de início do monitoramento.', 'error');
      return;
    }
    setConfigSaving(true);
    try {
      await saveSetting(MONITORAMENTO_INICIO_KEY, {
        data: dataInicio,
        rotulo: rotuloInicio.trim() || 'desde o início do projeto',
      });
      addToast('Data oficial atualizada. A página Evolução já reflete o novo valor.', 'success');
    } catch (err) {
      addToast(`Falha ao salvar: ${err.message}`, 'error');
    } finally {
      setConfigSaving(false);
    }
  };

  const handleOpenCreate = () => {
    setEditingEntry(null);
    setFormData(initialFormData);
    setImageFile(null);
    setImagePreview(null);
    setFormErrors({});
    setIsModalOpen(true);
  };

  const handleOpenEdit = (entry) => {
    setEditingEntry(entry);
    setFormData({
      titulo: entry.titulo,
      descricao: entry.descricao,
      categoria: entry.categoria,
      data: entry.data,
    });
    setImageFile(null);
    setImagePreview(entry.imagem_url ?? null);
    setFormErrors({});
    setIsModalOpen(true);
  };

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleSaveForm = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!formData.titulo.trim()) errors.titulo = true;
    if (!formData.descricao.trim()) errors.descricao = true;
    if (!formData.data) errors.data = true;
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      addToast('Preencha todos os campos destacados em vermelho.', 'error');
      return;
    }

    setSaving(true);
    try {
      let imagemUrl = editingEntry?.imagem_url ?? null;
      if (imageFile) {
        imagemUrl = await uploadImagem(imageFile);
      }

      if (editingEntry) {
        const atualizado = await atualizarEntrada(editingEntry.id, {
          ...formData, imagemUrl, publicado: editingEntry.publicado,
        });
        setEntries((prev) => prev.map((it) => (it.id === atualizado.id ? atualizado : it)));
        addToast('Entrada atualizada.', 'success');
      } else {
        const criado = await criarEntrada({ ...formData, imagemUrl, publicado: true });
        setEntries((prev) => [criado, ...prev].sort((a, b) => b.data.localeCompare(a.data)));
        addToast('Entrada publicada no changelog.', 'success');
      }
      setIsModalOpen(false);
    } catch (err) {
      addToast(`Erro ao salvar: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePublicado = async (entry) => {
    try {
      const atualizado = await atualizarEntrada(entry.id, {
        titulo: entry.titulo,
        descricao: entry.descricao,
        categoria: entry.categoria,
        data: entry.data,
        imagemUrl: entry.imagem_url,
        publicado: !entry.publicado,
      });
      setEntries((prev) => prev.map((it) => (it.id === atualizado.id ? atualizado : it)));
      addToast(atualizado.publicado ? 'Entrada publicada.' : 'Entrada despublicada (rascunho).', 'success');
    } catch (err) {
      addToast(`Falha ao atualizar: ${err.message}`, 'error');
    }
  };

  const requestDelete = (entry) => {
    setEntryToDelete(entry);
    setConfirmDeleteOpen(true);
  };

  const confirmDeleteAction = async () => {
    try {
      await removerEntrada(entryToDelete.id, entryToDelete.imagem_url);
      setEntries((prev) => prev.filter((it) => it.id !== entryToDelete.id));
      addToast('Entrada removida.', 'success');
    } catch (err) {
      addToast(`Falha ao remover: ${err.message}`, 'error');
    } finally {
      setConfirmDeleteOpen(false);
      setEntryToDelete(null);
    }
  };

  return (
    <div className="dashboard-content-area">
      <div className="page-header changelog-page-header">
        <div>
          <h1>Changelog Público</h1>
          <p>Marcos e novidades exibidos na página pública "Evolução".</p>
        </div>
        <button className="btn-primary" onClick={handleOpenCreate}>
          <Plus size={18} /> Nova Entrada
        </button>
      </div>

      {/* Data oficial — ancora o contador e os marcos automáticos de dias */}
      <div className="changelog-config-card glass mt-4">
        <h3>Data Oficial de Início do Monitoramento</h3>
        <p>Define o contador "N dias monitorando" e os marcos automáticos (100 dias, 1 ano, ...) na página pública.</p>
        <div className="changelog-config-row">
          <label className="changelog-field">
            <span>Data de início</span>
            <input
              type="date"
              value={dataInicio}
              disabled={configLoading}
              onChange={(e) => setDataInicio(e.target.value)}
            />
          </label>
          <label className="changelog-field changelog-field-grow">
            <span>Rótulo exibido</span>
            <input
              type="text"
              value={rotuloInicio}
              disabled={configLoading}
              onChange={(e) => setRotuloInicio(e.target.value)}
              placeholder="Ex: desde o início do projeto"
            />
          </label>
        </div>
        <button className="btn-primary" onClick={handleSalvarConfig} disabled={configSaving || configLoading}>
          {configSaving ? 'Salvando...' : 'Salvar Data Oficial'}
        </button>
      </div>

      {/* Lista de entradas */}
      <div className="changelog-list-wrapper glass mt-4">
        {loading ? (
          <p className="changelog-empty">Carregando entradas...</p>
        ) : loadError ? (
          <p className="changelog-empty">Não foi possível carregar: {loadError}</p>
        ) : entries.length === 0 ? (
          <p className="changelog-empty">Nenhuma entrada criada ainda.</p>
        ) : (
          <table className="changelog-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Categoria</th>
                <th>Título</th>
                <th>Status</th>
                <th className="text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="changelog-cell-data">{entry.data}</td>
                  <td>
                    <span className="changelog-badge" style={{ '--c': CATEGORIA_COLORS[entry.categoria] }}>
                      {entry.categoria}
                    </span>
                  </td>
                  <td>{entry.titulo}</td>
                  <td>
                    <button
                      className={`changelog-status-btn ${entry.publicado ? 'publicado' : 'rascunho'}`}
                      onClick={() => handleTogglePublicado(entry)}
                      title={entry.publicado ? 'Clique para despublicar (vira rascunho)' : 'Clique para publicar'}
                    >
                      {entry.publicado ? <Eye size={14} /> : <EyeOff size={14} />}
                      {entry.publicado ? 'Publicado' : 'Rascunho'}
                    </button>
                  </td>
                  <td className="text-right">
                    <button className="btn-table action-btn" onClick={() => handleOpenEdit(entry)}>
                      <Edit2 size={16} />
                    </button>
                    <button className="btn-table action-btn danger-btn" onClick={() => requestDelete(entry)}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {isModalOpen && createPortal(
        <div className="changelog-modal-overlay">
          <div className="changelog-modal animate-fade-in">
            <div className="changelog-modal-header">
              <h3>{editingEntry ? 'Editar Entrada' : 'Nova Entrada do Changelog'}</h3>
              <button className="changelog-btn-close" onClick={() => setIsModalOpen(false)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveForm} className="changelog-modal-body" noValidate>
              <div className="changelog-form-group">
                <label>Título</label>
                <input
                  type="text"
                  className={formErrors.titulo ? 'changelog-input-error' : ''}
                  value={formData.titulo}
                  onChange={(e) => { setFormData({ ...formData, titulo: e.target.value }); setFormErrors({ ...formErrors, titulo: false }); }}
                  placeholder="Ex: 3ª bóia entrou em operação"
                />
              </div>

              <div className="changelog-form-row">
                <div className="changelog-form-group">
                  <label>Data do evento</label>
                  <input
                    type="date"
                    className={formErrors.data ? 'changelog-input-error' : ''}
                    value={formData.data}
                    onChange={(e) => { setFormData({ ...formData, data: e.target.value }); setFormErrors({ ...formErrors, data: false }); }}
                  />
                </div>
                <div className="changelog-form-group">
                  <label>Categoria</label>
                  <select
                    value={formData.categoria}
                    onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                  >
                    {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div className="changelog-form-group">
                <label>Descrição</label>
                <textarea
                  className={formErrors.descricao ? 'changelog-input-error' : ''}
                  value={formData.descricao}
                  onChange={(e) => { setFormData({ ...formData, descricao: e.target.value }); setFormErrors({ ...formErrors, descricao: false }); }}
                  placeholder="Descrição curta do marco ou novidade"
                  rows={3}
                />
              </div>

              <div className="changelog-form-group">
                <label>Foto (opcional)</label>
                <label className="changelog-image-upload">
                  {imagePreview ? (
                    <img src={imagePreview} alt="Pré-visualização" className="changelog-image-preview" />
                  ) : (
                    <span className="changelog-image-placeholder"><ImageIcon size={24} /> Clique para escolher uma foto</span>
                  )}
                  <input type="file" accept="image/*" onChange={handleImageChange} hidden />
                </label>
              </div>

              <div className="changelog-modal-footer">
                <button type="button" className="btn-table" onClick={() => setIsModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Salvando...' : editingEntry ? 'Salvar Alterações' : 'Publicar Entrada'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}

      <ConfirmModal
        isOpen={confirmDeleteOpen}
        title="Remover Entrada"
        text="Tem certeza de que deseja remover esta entrada do changelog? Ela some da página pública imediatamente."
        confirmText="Sim, Remover"
        onConfirm={confirmDeleteAction}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
};

export default ChangelogPage;
