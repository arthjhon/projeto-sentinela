import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("⚠️ O Supabase URL ou Anon Key não constam no arquivo .env.local!");
}

// Cliente Principal da Sessão do Usuário
export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '')

// Cliente Paralelo Desconectado (Gambiarra Oficial de Nuvem)
// Usado exclusivamente pelo Administrador para criar novos Usuários
// sem que o Supabase feche a sessão atual do Admin (comportamento nativo seguro).
export const supabaseCreateUser = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  auth: {
    persistSession: false, // Não escreve no localStorage
    autoRefreshToken: false, // Não vira sessão primária
  }
})
