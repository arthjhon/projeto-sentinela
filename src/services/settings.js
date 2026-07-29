import { supabase } from '../lib/supabase';
import { logAcao, AUDIT } from './auditLog';

// Configurações da plataforma (5.4). Chave/valor em app_settings.
// Leitura é pública (RLS libera anon); escrita é só admin (RLS + auditoria).

/**
 * Lê uma configuração. Devolve `fallback` se não existir ainda — assim a UI
 * não precisa tratar o caso "primeira vez, nada salvo".
 * @param {string} key
 * @param {*} fallback
 */
export async function getSetting(key, fallback = null) {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.value ?? fallback;
}

/**
 * Grava (upsert) uma configuração e registra na auditoria.
 * @param {string} key
 * @param {object} value  vai para JSONB
 */
export async function saveSetting(key, value) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('app_settings')
    .upsert(
      { key, value, updated_at: new Date().toISOString(), updated_by: user?.id ?? null },
      { onConflict: 'key' }
    );
  if (error) throw new Error(error.message);

  logAcao(AUDIT.CONFIG_ALTERAR, key, value);
}

// Chave da meta de financiamento (5.4). Constante para não divergir entre
// quem grava (admin) e quem lê (página de apoio).
export const FUNDING_GOAL_KEY = 'funding_goal';
