import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Credenciais do Supabase não encontradas.\n" +
    "Crie o arquivo .env.local na raiz do projeto com:\n" +
    "  VITE_SUPABASE_URL=https://xxxx.supabase.co\n" +
    "  VITE_SUPABASE_ANON_KEY=eyJ..."
  )
}

// Cliente Principal da Sessão do Usuário
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
