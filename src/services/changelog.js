import { supabase } from '../lib/supabase';
import { logAcao, AUDIT } from './auditLog';

// Changelog público ("Evolução"). Ver
// docs/superpowers/specs/2026-07-20-changelog-publico-design.md.
//
// Entradas são manuais/curadas (diferente dos marcos de dias, que são
// calculados no cliente por src/utils/milestones.js — não vivem aqui).

const BUCKET = 'changelog';

/** 'YYYY-MM-DD' de hoje, no fuso local (mesmo critério usado para `data` nas entradas). */
function hojeIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Entradas publicadas com data já ocorrida (uso público). O filtro de data
 * futura fica na query, e não na RLS — a RLS só decide `publicado`, então uma
 * entrada agendada para o futuro fica invisível até a data chegar.
 */
export async function listarPublicadas() {
  const { data, error } = await supabase
    .from('changelog_entries')
    .select('*')
    .eq('publicado', true)
    .lte('data', hojeIso())
    .order('data', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Todas as entradas, incluindo rascunho e data futura (uso admin). */
export async function listarTodas() {
  const { data, error } = await supabase
    .from('changelog_entries')
    .select('*')
    .order('data', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * @param {{titulo: string, descricao: string, categoria: string, data: string,
 *          imagemUrl?: string|null, publicado?: boolean}} dados
 */
export async function criarEntrada(dados) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('changelog_entries')
    .insert({
      titulo: dados.titulo,
      descricao: dados.descricao,
      categoria: dados.categoria,
      data: dados.data,
      imagem_url: dados.imagemUrl ?? null,
      publicado: dados.publicado ?? true,
      created_by: user?.id ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  logAcao(AUDIT.CHANGELOG_CRIAR, dados.titulo, { categoria: dados.categoria, data: dados.data });
  return data;
}

/**
 * @param {string} id
 * @param {{titulo: string, descricao: string, categoria: string, data: string,
 *          imagemUrl?: string|null, publicado: boolean}} dados
 */
export async function atualizarEntrada(id, dados) {
  const { data, error } = await supabase
    .from('changelog_entries')
    .update({
      titulo: dados.titulo,
      descricao: dados.descricao,
      categoria: dados.categoria,
      data: dados.data,
      imagem_url: dados.imagemUrl ?? null,
      publicado: dados.publicado,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);

  logAcao(AUDIT.CHANGELOG_EDITAR, dados.titulo, { id, categoria: dados.categoria });
  return data;
}

/**
 * Remove a entrada e, best-effort, a imagem associada no Storage — se a
 * remoção da imagem falhar (ex.: URL em formato inesperado), a entrada já foi
 * removida do banco e não travamos o admin por causa de um arquivo órfão.
 * @param {string} id
 * @param {string|null} imagemUrl
 */
export async function removerEntrada(id, imagemUrl) {
  const { error } = await supabase.from('changelog_entries').delete().eq('id', id);
  if (error) throw new Error(error.message);

  if (imagemUrl) {
    const path = imagemUrl.split(`/${BUCKET}/`).pop();
    if (path && path !== imagemUrl) {
      const { error: storageError } = await supabase.storage.from(BUCKET).remove([path]);
      if (storageError) console.error('[changelog] falha ao remover imagem órfã:', storageError.message);
    }
  }

  logAcao(AUDIT.CHANGELOG_REMOVER, id);
}

/**
 * Sobe uma imagem para o bucket `changelog` e devolve a URL pública.
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function uploadImagem(file) {
  const ext = file.name.split('.').pop();
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(`Upload da imagem falhou: ${error.message}`);

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(data.path);
  return urlData.publicUrl;
}

/** Categorias válidas — mesma lista do CHECK constraint da tabela. */
export const CATEGORIAS = ['Hardware', 'Sensor', 'Marco', 'Parceria', 'Reconhecimento', 'Software'];

/**
 * Cor de cada categoria — usada tanto no admin (badge da lista) quanto na
 * página pública (badge + marcador da timeline). Centralizado aqui, e não
 * duplicado nos dois componentes, seguindo o precedente já estabelecido no
 * projeto para mapas de cor/config compartilhados (ver src/config/waterQuality.js,
 * usado por MonitoringPage.jsx e AdminDashboard.jsx).
 */
export const CATEGORIA_COLORS = {
  Hardware: '#f59e0b',
  Sensor: '#00f0ff',
  Marco: '#a78bfa',
  Parceria: '#22c55e',
  Reconhecimento: '#ec4899',
  Software: '#60a5fa',
};
