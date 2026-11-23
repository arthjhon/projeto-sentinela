import React, { useState } from 'react';
import Modal from '../Modal';
import { useToast } from '../../../contexts/ToastContext';
import { logAcao, AUDIT } from '../../../services/auditLog';
import { DEVICE_ID_RE, mergeRegistryEdit } from '../../../utils/deviceIds';
import {
  getBuoyRegistry, saveBuoyRegistry, codigoEmUso, upsertRegistryEntry, withModo,
} from '../../../services/buoyRegistry';

// Grava a entrada no registro dinâmico (map_buoys) a partir de uma cópia FRESCA do
// servidor: `saveBuoyRegistry` substitui o array inteiro (sem merge no servidor) e
// o registro do closure pode estar stale. Edição substitui a entrada no lugar (a
// ordem decide a bóia em destaque do mapa público). Lança, sem gravar, se o código
// novo é de outra bóia ou se a bóia em edição foi removida em outra sessão.
async function syncRegistryEntry(codigoOriginal, entry) {
  const fresh = await getBuoyRegistry();
  if (codigoOriginal && !fresh.some((r) => r.codigo === codigoOriginal)) {
    throw new Error(`a bóia ${codigoOriginal} foi removida do registro em outra sessão`);
  }
  const previous = codigoOriginal ? fresh.find((r) => r.codigo === codigoOriginal) : null;
  // Troca de serial: o id antigo vai para deviceIdsAnteriores (histórico do Influx).
  const comSerial = mergeRegistryEdit(previous, entry);
  const comModo = withModo(previous, comSerial, new Date().toISOString());
  await saveBuoyRegistry(upsertRegistryEntry(fresh, codigoOriginal, comModo));
}

/**
 * Cadastro/edição de bóia. `inicial` = dados do formulário (FORM_VAZIO ou o
 * registro fresco lido por quem abriu); `editando` = true quando é edição.
 * Se gravar falhar, nada muda e o modal continua aberto. `salvando` impede o envio duplo.
 */
export default function BuoyFormModal({ inicial, editando, codigosExistentes, onClose, onSaved, onFalha }) {
  const { addToast } = useToast();
  const [form, setForm] = useState(inicial);
  const [erros, setErros] = useState({});
  const [salvando, setSalvando] = useState(false);

  const campo = (nome, limpaErro = false) => (e) => {
    setForm((f) => ({ ...f, [nome]: e.target.value }));
    if (limpaErro) setErros((er) => ({ ...er, [nome]: false }));
  };

  const salvar = async (e) => {
    e.preventDefault();
    if (salvando) return;
    const codigo = form.id.trim();
    const codigoAtual = editando ? inicial.id : null;

    const novos = {};
    if (!codigo) novos.id = true;
    if (!form.name.trim()) novos.name = true;
    if (form.lat === '' || Number.isNaN(Number(form.lat))) novos.lat = true;
    if (form.lng === '' || Number.isNaN(Number(form.lng))) novos.lng = true;
    if (Object.keys(novos).length > 0) {
      setErros(novos);
      addToast('Preencha todos os campos destacados em vermelho.', 'error');
      return;
    }
    if (codigoEmUso(codigosExistentes, codigo, codigoAtual)) {
      setErros({ id: true });
      addToast(`Já existe uma bóia com o código ${codigo}.`, 'error');
      return;
    }
    const deviceId = form.deviceId.trim();
    const nome = form.name.trim();
    if (deviceId && !DEVICE_ID_RE.test(deviceId)) {
      setErros({ deviceId: true });
      addToast('Número de série inválido: use 1 a 40 caracteres entre letras, números, "_" e "-".', 'error');
      return;
    }

    setSalvando(true);
    try {
      await syncRegistryEntry(codigoAtual, {
        codigo, nome, lagoa: form.lagoa, modo: form.modo, lat: Number(form.lat), lng: Number(form.lng), deviceId: deviceId || null,
      });
    } catch (err) {
      addToast(`Bóia não salva: ${err.message}`, 'error');
      onFalha?.(); // mostra o estado real (bóia criada ou removida por outra sessão)
      setSalvando(false);
      return;
    }
    if (editando) {
      addToast('Cadastro da bóia atualizado.', 'success');
      logAcao(AUDIT.BOIA_EDITAR, codigo, { nome, deviceId, modo: form.modo });
    } else {
      addToast('Bóia cadastrada.', 'success');
      logAcao(AUDIT.BOIA_CRIAR, codigo, { nome, deviceId, modo: form.modo });
    }
    onSaved();
    onClose();
  };

  return (
    <Modal
      title={editando ? 'Editar Registros da Bóia' : 'Cadastrar Novo Sistema (Bóia)'}
      onClose={onClose}
      dismissible={!salvando}
      onSubmit={salvar}
      footer={(
        <>
          <button type="button" className="btn-table" onClick={onClose} disabled={salvando}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={salvando}>
            {salvando ? 'Salvando...' : editando ? 'Salvar Modificações' : 'Implantar Bóia'}
          </button>
        </>
      )}
    >
      {/* Nome em linha inteira: Lagoa fica ao lado de Modo e Latitude ao lado de Longitude. */}
      <div className="form-grid boia-form-grid">
        <div className="form-group">
          <label htmlFor="boia-id">Identificação de Frota (ID)</label>
          <input id="boia-id" type="text" className={`w-100 ${erros.id ? 'input-error' : ''}`} value={form.id} onChange={campo('id', true)} placeholder="Ex: SM-09" />
        </div>
        <div className="form-group">
          <label htmlFor="boia-serial">Número de Série do Dispositivo</label>
          <input id="boia-serial" type="text" className={`w-100 boia-form-mono ${erros.deviceId ? 'input-error' : ''}`} value={form.deviceId} onChange={campo('deviceId')} placeholder="Ex: snt-0001" />
          {editando && form.deviceIdsAnteriores?.length > 0 && (
            <small className="text-muted boia-form-mono">
              Seriais anteriores (histórico preservado): {form.deviceIdsAnteriores.join(', ')}
            </small>
          )}
        </div>
        <div className="form-group form-group-full">
          <label htmlFor="boia-nome">Nome Comercial/Apelido</label>
          <input id="boia-nome" type="text" className={`w-100 ${erros.name ? 'input-error' : ''}`} value={form.name} onChange={campo('name', true)} placeholder="Ponto Canal A" />
        </div>
        <div className="form-group">
          <label htmlFor="boia-lagoa">Lagoa (mapa)</label>
          <select id="boia-lagoa" value={form.lagoa} onChange={campo('lagoa')}>
            <option value="mundau">Mundaú</option>
            <option value="manguaba">Manguaba</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="boia-modo">Modo</label>
          <select id="boia-modo" value={form.modo} onChange={campo('modo')}>
            <option value="bancada">Bancada</option>
            <option value="campo">Campo</option>
          </select>
          <small className="text-muted">Em bancada, alertas do detector ficam neutros.</small>
        </div>
        <div className="form-group">
          <label htmlFor="boia-lat">Latitude (mapa)</label>
          <input id="boia-lat" type="number" step="any" className={`w-100 ${erros.lat ? 'input-error' : ''}`} value={form.lat} onChange={campo('lat', true)} placeholder="Ex: -9.6559" />
        </div>
        <div className="form-group">
          <label htmlFor="boia-lng">Longitude (mapa)</label>
          <input id="boia-lng" type="number" step="any" className={`w-100 ${erros.lng ? 'input-error' : ''}`} value={form.lng} onChange={campo('lng', true)} placeholder="Ex: -35.7701" />
        </div>
      </div>
    </Modal>
  );
}
