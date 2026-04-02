-- ==========================================
-- SCRIPT DE INSTALAÇÃO - PROJETO SENTINELA
-- Banco de Dados Relacional e Autenticação
-- Destino: SQL Editor do Supabase Dashboard
-- ==========================================

-- 1. Criação da Tabela de Perfis Auxiliar (Herda do Auth nativo do Supabase)
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'operador', 'visualizador')),
  must_change_password BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 2. Habilitação de Segurança (Row Level Security)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Políticas de Acesso
-- Todos os usuários logados podem ler propriedades (Para a tabela front-end funcionar).
CREATE POLICY "Allow logged-in users to view profiles" ON public.profiles
  FOR SELECT USING (auth.role() = 'authenticated');

-- A tabela restringe atualizações para impedir operadores de escalar permissão.
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Autoriza os Administradores a deletarem perfis (o que corta o acesso da ponta React)
CREATE POLICY "Admins_Delete_Profiles" ON public.profiles
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- 4. Função Automática (Trigger de Cópia e Defesa)
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, username, role, must_change_password)
  VALUES (
    new.id, 
    COALESCE(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), 'Admin Principal'),
    COALESCE(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1), 'admin'),
    COALESCE(new.raw_user_meta_data->>'role', 'admin'),
    -- O Segredo: Se tem metadado foi criado pelo painel React do Sentinela (Op. precisa trocar senha provisória).
    -- Se não tem (NULL) foi você, dono, criando um Admin no dashboard original do Supabase (NÃO precisa trocar).
    CASE WHEN new.raw_user_meta_data->>'name' IS NULL THEN FALSE ELSE TRUE END
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Arma a Cópia Automática na tabela inalcançável auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
