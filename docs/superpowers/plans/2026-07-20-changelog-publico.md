# Changelog Público ("Evolução") — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Página pública `/evolucao` mostrando marcos e novidades do projeto (curados por um admin, com foto opcional), misturados com marcos automáticos de "dias monitorando" calculados a partir de uma data oficial definida no painel admin.

**Architecture:** Modelo híbrido DB-backed. Tabela nova `changelog_entries` (Supabase + Storage) para entradas manuais; marcos de dias calculados no cliente (sem I/O) a partir de `app_settings.monitoramento_inicio`. Reusa os padrões já estabelecidos no projeto: RLS com policies split público/admin, bucket de Storage com policies admin-only, helper de auditoria `logAcao`.

**Tech Stack:** React 19 + Vite, react-router-dom, Supabase JS (Postgres + Storage + Auth), lucide-react, Vitest. Nenhuma dependência nova.

**Spec de referência:** `docs/superpowers/specs/2026-07-20-changelog-publico-design.md`

## Global Constraints

- **Sem backend.** Todo código roda no navegador; nada pode depender de um processo servidor sob agenda.
- **RLS obrigatória em toda tabela nova**, seguindo o padrão de `supabase_backlog_schema.sql`: policies via `DO $$ ... IF NOT EXISTS ... END $$` (idempotente).
- **Commits: autorizados localmente para esta execução via Subagent-Driven Development.** O usuário aprovou explicitamente commits locais para esta execução (necessários para o mecanismo de revisão do SDD gerar diffs BASE..HEAD) — nada é enviado (push) sem pedido separado. Cada tarefa termina com um commit descritivo (`git add <arquivos> && git commit -m "..."`), não apenas stage. Fora do contexto desta execução SDD, a regra do projeto continua sendo "só commita quando pedido".
- **CSS de página admin deve ser autossuficiente.** Cada página `/admin/*` é um chunk lazy-loaded independente — uma classe usada por duas páginas mas definida em só uma delas aparece de forma inconsistente conforme a ordem de navegação (bug já identificado e corrigido nesta sessão para `.btn-primary`/`.btn-table`). `UsersPage.css` e `SensorsPage.css` já têm cópias **divergentes** de `.crud-modal-overlay`/`.form-group` (cores, padding e z-index diferentes — confirmado por diff). `ChangelogPage.css` **não** reusa nenhuma delas: usa classes próprias prefixadas `changelog-`.
- **Nenhum teste automatizado para services que chamam Supabase** — segue o padrão já estabelecido no projeto (`auditLog.js`, `settings.js`, `maintenance.js` não têm testes unitários; são verificados via chamadas REST diretas). Só funções puras (`milestones.js`) ganham teste Vitest, como `sha256.js` e `exportHistoryCsv.js` já fazem.
- **Categorias válidas** (idênticas no CHECK constraint do banco e na constante JS): `Hardware`, `Sensor`, `Marco`, `Parceria`, `Reconhecimento`, `Software`.
- **Ordem de dependência entre Tasks 4-6, intencional.** A Task 4 registra rotas para `ChangelogPage`/`EvolucaoPage` antes desses componentes existirem (criados nas Tasks 5 e 6). O commit da Task 4, isolado, **não compila** — isso é esperado e documentado no próprio texto da task, não um defeito a apontar na revisão daquela task especificamente. O build só precisa passar a partir da Task 6 em diante.
- **`implementados.md` fica fora deste repositório git** (em `/home/arthjhon/workspace/projects/IoT/`, que não tem `.git` — só `projeto-sentinela/` é versionado). A Task 7 o edita como arquivo de texto comum, sem `git add`/`commit` nele; um revisor de diff não vai enxergar essa edição porque ela não pertence a este repositório — não é uma omissão do commit, é escopo diferente por natureza.

---

## Task 1: Migration — tabela, RLS e bucket de Storage

**Files:**
- Create: `supabase_changelog_schema.sql`

**Interfaces:**
- Produces: tabela `public.changelog_entries` (colunas: `id, titulo, descricao, categoria, data, imagem_url, publicado, created_by, created_at, updated_at`), bucket Storage `changelog`. Consumido pelas Tasks 2 (indiretamente, via `app_settings` já existente) e 3 (diretamente).

- [ ] **Step 1: Escrever o arquivo de migration**

Criar `supabase_changelog_schema.sql` na raiz de `projeto-sentinela/` (mesmo nível de `supabase_backlog_schema.sql`):

```sql
-- ================================================
-- Changelog público ("Evolução") — tabela + storage
-- Cole e execute no SQL Editor do Supabase.
--
-- Cobre a spec docs/superpowers/specs/2026-07-20-changelog-publico-design.md:
--   changelog_entries  -> entradas do changelog (manuais, curadas pelo admin)
--   bucket 'changelog' -> fotos das entradas
--
-- A data oficial que ancora os marcos automáticos de dias
-- (app_settings.monitoramento_inicio) NÃO precisa de migração: app_settings
-- já existe e é genérica (ver supabase_backlog_schema.sql).
--
-- Arquivo isolado de propósito: pode rodar em produção sem depender do resto
-- do backlog já ter sido aplicado — só depende de `public.profiles` existir.
-- ================================================

CREATE TABLE IF NOT EXISTS public.changelog_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo      TEXT NOT NULL,
  descricao   TEXT NOT NULL,
  categoria   TEXT NOT NULL
              CHECK (categoria IN ('Hardware','Sensor','Marco','Parceria','Reconhecimento','Software')),
  data        DATE NOT NULL,
  imagem_url  TEXT,
  publicado   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS changelog_entries_public_idx
  ON public.changelog_entries (publicado, data DESC);

ALTER TABLE public.changelog_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Leitura pública: só publicados. Duas policies permissivas em SELECT se
  -- somam com OR (semântica nativa do Postgres) — anon só bate na primeira;
  -- admin bate nas duas, então enxerga rascunho também.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='changelog_entries' AND policyname='changelog_select_public') THEN
    CREATE POLICY changelog_select_public ON public.changelog_entries
      FOR SELECT USING (publicado = true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='changelog_entries' AND policyname='changelog_select_admin') THEN
    CREATE POLICY changelog_select_admin ON public.changelog_entries
      FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;

  -- Escrita: só admin
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='changelog_entries' AND policyname='changelog_insert_admin') THEN
    CREATE POLICY changelog_insert_admin ON public.changelog_entries
      FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='changelog_entries' AND policyname='changelog_update_admin') THEN
    CREATE POLICY changelog_update_admin ON public.changelog_entries
      FOR UPDATE USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='changelog_entries' AND policyname='changelog_delete_admin') THEN
    CREATE POLICY changelog_delete_admin ON public.changelog_entries
      FOR DELETE USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
END $$;

-- ── Storage: bucket 'changelog' (fotos das entradas) ──────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('changelog', 'changelog', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='changelog_storage_public_read') THEN
    CREATE POLICY changelog_storage_public_read ON storage.objects
      FOR SELECT USING (bucket_id = 'changelog');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='changelog_storage_admin_insert') THEN
    CREATE POLICY changelog_storage_admin_insert ON storage.objects
      FOR INSERT WITH CHECK (
        bucket_id = 'changelog' AND
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='changelog_storage_admin_delete') THEN
    CREATE POLICY changelog_storage_admin_delete ON storage.objects
      FOR DELETE USING (
        bucket_id = 'changelog' AND
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
      );
  END IF;
END $$;
```

- [ ] **Step 2: Aplicar no Supabase local**

```bash
cd /home/arthjhon/workspace/projects/IoT
docker exec -i supabase-db psql -U postgres -d postgres < projeto-sentinela/supabase_changelog_schema.sql
```

Expected: linhas `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE`, `DO` (duas vezes), `INSERT 0 1`. Nenhuma linha `ERROR`.

- [ ] **Step 3: Verificar idempotência (rodar de novo, deve ser inofensivo)**

```bash
docker exec -i supabase-db psql -U postgres -d postgres < projeto-sentinela/supabase_changelog_schema.sql 2>&1 | grep -ic "^ERROR"
```

Expected: `0`.

- [ ] **Step 4: Verificar RLS via REST — admin escreve, anon lê publicado, anon não escreve**

```bash
cd /home/arthjhon/workspace/projects/IoT
ANON=$(grep VITE_SUPABASE_ANON_KEY projeto-sentinela/.env.local | cut -d= -f2)
TOKEN=$(curl -s -X POST "http://172.16.200.22:8000/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"email":"arthur@sentinela.app","password":"wgrKzpbaM8DZU0Am"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# 1) admin cria uma entrada de teste
curl -s -X POST "http://172.16.200.22:8000/rest/v1/changelog_entries" \
  -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"titulo":"Teste plano","descricao":"verificacao task 1","categoria":"Software","data":"2026-07-01","publicado":true}'
```
Expected: HTTP 201 implícito, corpo JSON com o registro criado (id, titulo="Teste plano").

```bash
# 2) anon (sem token) le a entrada publicada
curl -s "http://172.16.200.22:8000/rest/v1/changelog_entries?titulo=eq.Teste%20plano&select=titulo,publicado" \
  -H "apikey: $ANON"
```
Expected: `[{"titulo":"Teste plano","publicado":true}]`.

```bash
# 3) anon tenta escrever — deve ser negado
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://172.16.200.22:8000/rest/v1/changelog_entries" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"titulo":"hack","descricao":"x","categoria":"Software","data":"2026-07-01"}'
```
Expected: `401`.

```bash
# 4) limpa o registro de teste
docker exec supabase-db psql -U postgres -d postgres -tAc \
  "delete from public.changelog_entries where titulo='Teste plano';"
```

- [ ] **Step 5: Verificar o bucket de Storage**

```bash
docker exec supabase-db psql -U postgres -d postgres -tAc \
  "select id, public from storage.buckets where id='changelog';"
```
Expected: `changelog|t`.

- [ ] **Step 6: Commit**

```bash
cd /home/arthjhon/workspace/projects/IoT/projeto-sentinela
git add supabase_changelog_schema.sql
git commit -m "feat(changelog): migration — tabela changelog_entries, RLS e bucket de storage"
```

---

## Task 2: `milestones.js` — marcos automáticos de dias (TDD)

**Files:**
- Create: `src/utils/milestones.js`
- Create: `src/utils/milestones.test.js`

**Interfaces:**
- Produces: `diasDesde(dataInicioIso: string|null, hoje?: Date): number|null`; `marcosDeDias(dataInicioIso: string|null, hoje?: Date): Array<{data: string, categoria: 'Marco', titulo: string, auto: true}>`. Consumido pela Task 5 (`ChangelogPage.jsx` só indiretamente, via a config; `EvolucaoPage.jsx` diretamente na Task 6).
- Consumes: nada (funções puras, sem I/O, sem imports do projeto).

- [ ] **Step 1: Escrever os testes (vão falhar — o módulo ainda não existe)**

Criar `src/utils/milestones.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { diasDesde, marcosDeDias } from './milestones';

describe('diasDesde', () => {
  it('mesmo dia da âncora → 0', () => {
    expect(diasDesde('2024-01-01', new Date('2024-01-01T00:00:00'))).toBe(0);
  });

  it('um dia depois → 1', () => {
    expect(diasDesde('2024-01-01', new Date('2024-01-02T00:00:00'))).toBe(1);
  });

  it('sem data-âncora → null', () => {
    expect(diasDesde(null)).toBe(null);
    expect(diasDesde(undefined)).toBe(null);
    expect(diasDesde('')).toBe(null);
  });
});

describe('marcosDeDias', () => {
  it('inclui o marco de 100 dias exatamente na data certa', () => {
    // 2024 é bissexto: Jan(31)+Fev(29)+Mar(31)=91 dias até 1º/abr; +9 = 10/abr
    const marcos = marcosDeDias('2024-01-01', new Date('2024-04-10T00:00:00'));
    expect(marcos).toEqual([
      { data: '2024-04-10', categoria: 'Marco', titulo: '100 dias de monitoramento', auto: true },
    ]);
  });

  it('não retorna marcos futuros (1 dia após o início)', () => {
    expect(marcosDeDias('2026-01-01', new Date('2026-01-02T00:00:00'))).toEqual([]);
  });

  it('marca o aniversário de 1 ano por calendário, não por múltiplo de 365', () => {
    // 2023-05-12 → 2024-05-12 são 366 dias corridos (2024 é bissexto), mas o
    // aniversário é o mesmo dia/mês no ano seguinte, não day+365.
    const marcos = marcosDeDias('2023-05-12', new Date('2024-05-12T00:00:00'));
    expect(marcos).toContainEqual({
      data: '2024-05-12', categoria: 'Marco', titulo: '1 ano de monitoramento', auto: true,
    });
  });

  it('sem data-âncora → lista vazia', () => {
    expect(marcosDeDias(null)).toEqual([]);
    expect(marcosDeDias(undefined)).toEqual([]);
  });

  it('marcos vêm ordenados por data crescente e com o formato esperado', () => {
    const marcos = marcosDeDias('2015-01-01', new Date('2026-07-20T00:00:00'));
    expect(marcos.length).toBeGreaterThan(5);
    for (const m of marcos) {
      expect(m.auto).toBe(true);
      expect(m.categoria).toBe('Marco');
      expect(m.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    for (let i = 1; i < marcos.length; i++) {
      expect(marcos[i].data >= marcos[i - 1].data).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

```bash
cd /home/arthjhon/workspace/projects/IoT/projeto-sentinela
npx vitest run src/utils/milestones.test.js
```

Expected: FAIL — `Failed to resolve import "./milestones"` (o arquivo ainda não existe).

- [ ] **Step 3: Implementar `milestones.js`**

Criar `src/utils/milestones.js`:

```js
// Marcos automáticos de "dias monitorando" (changelog público). Puramente
// funções de data — sem I/O, sem Supabase — para poderem ser testadas
// isoladamente e para o cálculo nunca depender de rede.
//
// A data-âncora vem de app_settings.monitoramento_inicio (definida pelo
// admin), não de telemetria: ver
// docs/superpowers/specs/2026-07-20-changelog-publico-design.md.

const UM_DIA_MS = 86_400_000;

// Marcos de dias "redondos" — independem de calendário/ano bissexto.
const DIAS_REDONDOS = [100, 500, 1000, 2000, 5000, 10000];

// Aniversários anuais são calculados por calendário (setFullYear), e não por
// múltiplos de 365 dias — assim não desalinham por causa de anos bissextos.
const MAX_ANOS_ANIVERSARIO = 50;

/** 'YYYY-MM-DD' → Date à meia-noite local (mesmo fuso usado em toIso). */
function parseIso(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date local → 'YYYY-MM-DD', via getters locais (evita virar o dia via UTC). */
function toIso(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function rotuloAnos(anos) {
  return `${anos} ${anos === 1 ? 'ano' : 'anos'} de monitoramento`;
}

function rotuloDias(dias) {
  return `${dias.toLocaleString('pt-BR')} dias de monitoramento`;
}

/**
 * Dias corridos entre a data-âncora e `hoje` (ambas à meia-noite local).
 * @param {string|null|undefined} dataInicioIso  'YYYY-MM-DD'
 * @param {Date} [hoje]
 * @returns {number|null} null se a data-âncora for inválida/ausente
 */
export function diasDesde(dataInicioIso, hoje = new Date()) {
  const inicio = parseIso(dataInicioIso);
  if (!inicio) return null;
  return Math.max(0, Math.floor((hoje.getTime() - inicio.getTime()) / UM_DIA_MS));
}

/**
 * Marcos JÁ atingidos (data <= hoje), ordenados por data crescente. Mistura
 * dias redondos (100/500/1000/...) com aniversários de calendário (1 ano,
 * 2 anos, ...). Cada item tem o mesmo formato de uma entrada de
 * changelog_entries (`data`, `categoria`, `titulo`), mais `auto: true` — para
 * a timeline pública (EvolucaoPage) tratar os dois tipos de forma uniforme.
 *
 * @param {string|null|undefined} dataInicioIso  'YYYY-MM-DD'
 * @param {Date} [hoje]
 * @returns {Array<{data: string, categoria: 'Marco', titulo: string, auto: true}>}
 */
export function marcosDeDias(dataInicioIso, hoje = new Date()) {
  const inicio = parseIso(dataInicioIso);
  if (!inicio) return [];

  const marcos = [];

  for (const n of DIAS_REDONDOS) {
    const dataMarco = new Date(inicio.getTime() + n * UM_DIA_MS);
    if (dataMarco > hoje) break; // DIAS_REDONDOS está em ordem crescente
    marcos.push({ data: toIso(dataMarco), categoria: 'Marco', titulo: rotuloDias(n), auto: true });
  }

  for (let anos = 1; anos <= MAX_ANOS_ANIVERSARIO; anos++) {
    const aniversario = new Date(inicio);
    aniversario.setFullYear(aniversario.getFullYear() + anos);
    if (aniversario > hoje) break;
    marcos.push({ data: toIso(aniversario), categoria: 'Marco', titulo: rotuloAnos(anos), auto: true });
  }

  return marcos.sort((a, b) => a.data.localeCompare(b.data));
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

```bash
npx vitest run src/utils/milestones.test.js
```

Expected: `Test Files 1 passed (1)`, `Tests 9 passed (9)`.

- [ ] **Step 5: Rodar a suíte inteira (não quebrou nada)**

```bash
npx vitest run
```

Expected: todos os arquivos de teste existentes continuam passando, mais o novo (`milestones.test.js`).

- [ ] **Step 6: Commit**

```bash
git add src/utils/milestones.js src/utils/milestones.test.js
git commit -m "feat(changelog): milestones.js — marcos automaticos de dias, com testes"
```

---

## Task 3: `changelog.js` — service de CRUD + upload de imagem

**Files:**
- Modify: `src/services/auditLog.js`
- Modify: `src/services/settings.js`
- Create: `src/services/changelog.js`

**Interfaces:**
- Consumes: `supabase` de `src/lib/supabase.js` (já existe); `logAcao`, `AUDIT` de `src/services/auditLog.js` (modificado nesta task).
- Produces: `listarPublicadas(): Promise<Array>`, `listarTodas(): Promise<Array>`, `criarEntrada(dados): Promise<object>`, `atualizarEntrada(id, dados): Promise<object>`, `removerEntrada(id, imagemUrl): Promise<void>`, `uploadImagem(file): Promise<string>`, `CATEGORIAS: string[]`, `CATEGORIA_COLORS: Record<string,string>`. `dados` em `criarEntrada`/`atualizarEntrada` tem o formato `{titulo, descricao, categoria, data, imagemUrl, publicado}` (camelCase — mapeado para `imagem_url` snake_case na escrita). Consumido pelas Tasks 5 e 6 — `CATEGORIA_COLORS` é importado por ambas, e não redefinido localmente (ver self-review do plano).
- Também produz: `AUDIT.CHANGELOG_CRIAR/EDITAR/REMOVER` em `auditLog.js`; `MONITORAMENTO_INICIO_KEY` em `settings.js` (consumido pelas Tasks 5 e 6).

- [ ] **Step 1: Adicionar constantes de auditoria em `auditLog.js`**

Em `src/services/auditLog.js`, no objeto `AUDIT` (linha 27), adicionar antes do `};` de fechamento:

```js
export const AUDIT = {
  BOIA_CRIAR:        'boia.criar',
  BOIA_EDITAR:       'boia.editar',
  BOIA_REMOVER:      'boia.remover',
  MANUTENCAO_INICIO: 'manutencao.iniciar',
  MANUTENCAO_FIM:    'manutencao.finalizar',
  SENSOR_CALIBRAR:   'sensor.calibrar',
  FIRMWARE_DEPLOY:   'firmware.deploy',
  CONFIG_ALTERAR:    'config.alterar',
  USUARIO_CRIAR:     'usuario.criar',
  USUARIO_EDITAR:    'usuario.editar',
  USUARIO_REMOVER:   'usuario.remover',
  CHANGELOG_CRIAR:   'changelog.criar',
  CHANGELOG_EDITAR:  'changelog.editar',
  CHANGELOG_REMOVER: 'changelog.remover',
};
```

E no objeto `AUDIT_LABELS` (linha 42), adicionar antes do `};` de fechamento:

```js
export const AUDIT_LABELS = {
  [AUDIT.BOIA_CRIAR]:        'Bóia criada',
  [AUDIT.BOIA_EDITAR]:       'Bóia editada',
  [AUDIT.BOIA_REMOVER]:      'Bóia removida',
  [AUDIT.MANUTENCAO_INICIO]: 'Manutenção iniciada',
  [AUDIT.MANUTENCAO_FIM]:    'Manutenção finalizada',
  [AUDIT.SENSOR_CALIBRAR]:   'Sensor calibrado',
  [AUDIT.FIRMWARE_DEPLOY]:   'Firmware implantado',
  [AUDIT.CONFIG_ALTERAR]:    'Configuração alterada',
  [AUDIT.USUARIO_CRIAR]:     'Usuário criado',
  [AUDIT.USUARIO_EDITAR]:    'Usuário editado',
  [AUDIT.USUARIO_REMOVER]:   'Usuário removido',
  [AUDIT.CHANGELOG_CRIAR]:   'Entrada de changelog criada',
  [AUDIT.CHANGELOG_EDITAR]:  'Entrada de changelog editada',
  [AUDIT.CHANGELOG_REMOVER]: 'Entrada de changelog removida',
};
```

- [ ] **Step 2: Adicionar a chave da data oficial em `settings.js`**

Em `src/services/settings.js`, ao final do arquivo (depois de `export const FUNDING_GOAL_KEY = 'funding_goal';`), adicionar:

```js
// Chave da data oficial de início do monitoramento (changelog público). Ancora
// o contador "N dias monitorando" e os marcos automáticos — ver
// src/utils/milestones.js e
// docs/superpowers/specs/2026-07-20-changelog-publico-design.md.
export const MONITORAMENTO_INICIO_KEY = 'monitoramento_inicio';
```

- [ ] **Step 3: Criar `src/services/changelog.js`**

```js
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
```

- [ ] **Step 4: Build e lint (sem UI ainda para clicar — a verificação comportamental completa acontece nas Tasks 5/6)**

```bash
cd /home/arthjhon/workspace/projects/IoT/projeto-sentinela
npx vite build 2>&1 | tail -5
npm run lint 2>&1 | grep -E "✖|changelog|auditLog|settings.js"
```

Expected: build `✓ built`; lint sem novos erros nos três arquivos tocados (compare a contagem total com o baseline atual antes desta task, anotado ao rodar `npm run lint 2>&1 | grep -E "✖"` ANTES do Step 1).

- [ ] **Step 5: Commit**

```bash
git add src/services/auditLog.js src/services/settings.js src/services/changelog.js
git commit -m "feat(changelog): changelog.js — CRUD + upload de imagem, constantes de auditoria e settings"
```

---

## Task 4: Rotas e navegação — admin e público

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/pages/admin/AdminLayout.jsx`
- Modify: `src/components/public/PublicNavbar.jsx`
- Modify: `src/components/public/Footer.jsx`

**Interfaces:**
- Consumes: nada de código novo (só registra rotas para componentes que as Tasks 5 e 6 vão criar).
- Produces: rota `/admin/changelog` (protegida) e `/evolucao` (pública), navegáveis a partir da UI. **Esta task deixa as rotas registradas para componentes que ainda não existem — o build vai falhar até a Task 5 criar `ChangelogPage.jsx` e a Task 6 criar `EvolucaoPage.jsx`.** Por isso as Tasks 4, 5 e 6 devem ser aplicadas em sequência antes de qualquer verificação de build.

- [ ] **Step 1: Registrar as rotas em `App.jsx`**

Em `src/App.jsx`, adicionar os lazy imports (depois da linha 21, `const SettingsPage = ...`):

```js
const ChangelogPage = lazy(() => import('./pages/admin/ChangelogPage'));
```

E depois da linha 11 (`const MonitoringPage = ...`):

```js
const EvolucaoPage = lazy(() => import('./pages/public/EvolucaoPage'));
```

Adicionar a rota pública (dentro do bloco `<Route element={lazyElement(PublicLayout)}>`, depois de `/apoie`):

```jsx
<Route path="/evolucao" element={lazyElement(EvolucaoPage)} />
```

Adicionar a rota admin (dentro do bloco de rotas do `AdminLayout`, depois de `settings`):

```jsx
<Route path="changelog" element={lazyElement(ChangelogPage)} />
```

O arquivo completo do bloco de rotas fica:

```jsx
        {/* Public Routes */}
        <Route element={lazyElement(PublicLayout)}>
          <Route path="/" element={lazyElement(LandingPage)} />
          <Route path="/monitoramento" element={lazyElement(MonitoringPage)} />
          <Route path="/equipe" element={lazyElement(TeamPage)} />
          <Route path="/apoiadores" element={lazyElement(SupportersPage)} />
          <Route path="/apoie" element={lazyElement(SupportUsPage)} />
          <Route path="/evolucao" element={lazyElement(EvolucaoPage)} />
        </Route>

        {/* Auth and Admin Routes */}
        <Route element={lazyElement(AdminProviders)}>
          <Route path="/login" element={lazyElement(LoginPage)} />
          <Route path="/admin" element={lazyElement(ProtectedRoute)}>
            <Route element={lazyElement(AdminLayout)}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={lazyElement(AdminDashboard)} />
              <Route path="sensors" element={lazyElement(SensorsPage)} />
              <Route path="users" element={lazyElement(UsersPage)} />
              <Route path="ota" element={lazyElement(OtaPage)} />
              <Route path="settings" element={lazyElement(SettingsPage)} />
              <Route path="changelog" element={lazyElement(ChangelogPage)} />
            </Route>
          </Route>
        </Route>
```

- [ ] **Step 2: Item no menu lateral do admin**

Em `src/pages/admin/AdminLayout.jsx`, adicionar `Rss` ao import de ícones (linha 4):

```js
import { LogOut, LayoutDashboard, ActivitySquare, ShieldAlert, Users, Cpu, SlidersHorizontal, Rss } from 'lucide-react';
```

E adicionar o link, depois do bloco de `Configurações` (depois da linha 76, antes do `</nav>`):

```jsx
          {currentUser?.role === 'admin' && (
            <NavLink
              to="/admin/changelog"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Rss size={20} />
              <span>Changelog</span>
            </NavLink>
          )}
```

Gate por `role === 'admin'` (não `operador`): consistente com Users/OTA/Settings, que já são admin-only por serem conteúdo editorial/sensível, e não operação de sensor.

- [ ] **Step 3: Link na navbar pública (desktop + mobile, mesmo array)**

Em `src/components/public/PublicNavbar.jsx`, adicionar `Rss` ao import (linha 3):

```js
import { Menu, X, Shield, Users, HeartHandshake, Rocket, Activity, Rss } from 'lucide-react';
```

E adicionar ao array `navLinks` (linha 16-21) — este array já alimenta os menus desktop E mobile, então uma única entrada cobre os dois:

```js
  const navLinks = [
    { name: 'O Projeto', path: '/', icon: <Rocket size={18} /> },
    { name: 'Analytics', path: '/monitoramento', icon: <Activity size={18} /> },
    { name: 'A Equipe', path: '/equipe', icon: <Users size={18} /> },
    { name: 'Apoiadores', path: '/apoiadores', icon: <HeartHandshake size={18} /> },
    { name: 'Evolução', path: '/evolucao', icon: <Rss size={18} /> },
  ];
```

- [ ] **Step 4: Link no rodapé**

Em `src/components/public/Footer.jsx`, no bloco `footer-nav-group` (linhas 22-28), adicionar antes de "Apoie o Projeto":

```jsx
          <ul>
            <li><Link to="/">Início</Link></li>
            <li><Link to="/monitoramento">Monitoramento</Link></li>
            <li><Link to="/equipe">Equipe</Link></li>
            <li><Link to="/apoiadores">Apoiadores</Link></li>
            <li><Link to="/evolucao">Evolução</Link></li>
            <li><Link to="/apoie">Apoie o Projeto</Link></li>
          </ul>
```

- [ ] **Step 5: Commit (build só vai passar depois das Tasks 5 e 6 — não rodar build/lint isolado aqui; é esperado que este commit intermediário não compile sozinho)**

```bash
cd /home/arthjhon/workspace/projects/IoT/projeto-sentinela
git add src/App.jsx src/pages/admin/AdminLayout.jsx src/components/public/PublicNavbar.jsx src/components/public/Footer.jsx
git commit -m "feat(changelog): registra rotas /admin/changelog e /evolucao + navegacao

Build so volta a compilar apos as Tasks 5 e 6 criarem ChangelogPage/EvolucaoPage."
```

---

## Task 5: Página admin `/admin/changelog`

**Files:**
- Create: `src/pages/admin/ChangelogPage.jsx`
- Create: `src/pages/admin/ChangelogPage.css`

**Interfaces:**
- Consumes: `listarTodas, criarEntrada, atualizarEntrada, removerEntrada, uploadImagem, CATEGORIAS, CATEGORIA_COLORS` de `../../services/changelog` (Task 3); `getSetting, saveSetting, MONITORAMENTO_INICIO_KEY` de `../../services/settings` (Task 3); `useToast` de `../../contexts/ToastContext`; `ConfirmModal` de `../../components/ConfirmModal`.
- Produces: componente default `ChangelogPage`, consumido pela rota registrada na Task 4.

- [ ] **Step 1: Criar `src/pages/admin/ChangelogPage.jsx`**

```jsx
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
      <div className="page-header d-flex-between">
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
```

- [ ] **Step 2: Criar `src/pages/admin/ChangelogPage.css`**

```css
/* ChangelogPage - CSS totalmente autocontido (nao reusa as classes de modal
   de UsersPage.css/SensorsPage.css): essas classes ja divergiram entre os
   dois arquivos (cores, padding, z-index diferentes) e nenhum dos dois
   chunks e garantido de estar carregado nesta pagina - cada pagina admin e
   lazy-loaded independentemente (ver styles/shared.css para o historico
   desse problema, corrigido nesta sessao para .btn-primary/.btn-table).
   Prefixo changelog- evita colisao e mantem este chunk autossuficiente,
   independente da ordem de navegacao do admin. */

.changelog-config-card {
  padding: 1.5rem;
}

.changelog-config-card h3 {
  font-size: 1.05rem;
  margin-bottom: 0.4rem;
}

.changelog-config-card > p {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: 1rem;
}

.changelog-config-row {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}

.changelog-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 180px;
}

.changelog-field-grow { flex: 1; }

.changelog-field span {
  font-size: 0.75rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.changelog-field input {
  padding: 0.55rem 0.8rem;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #e2e8f0;
  font-family: inherit;
  font-size: 0.9rem;
  outline: none;
}

.changelog-field input:focus { border-color: rgba(0, 240, 255, 0.35); }
.changelog-field input:disabled { opacity: 0.5; }

.changelog-list-wrapper {
  padding: 1.5rem;
  overflow-x: auto;
}

.changelog-empty {
  color: var(--text-muted);
  font-size: 0.9rem;
  text-align: center;
  padding: 2rem 0;
}

.changelog-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0 0.5rem;
}

.changelog-table th {
  text-align: left;
  padding: 0 1rem 0.75rem;
  color: var(--text-muted);
  font-weight: 500;
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.changelog-table td {
  padding: 0.85rem 1rem;
  background: rgba(0, 0, 0, 0.2);
}

.changelog-table td:first-child { border-radius: 8px 0 0 8px; }
.changelog-table td:last-child { border-radius: 0 8px 8px 0; }

.changelog-cell-data {
  font-family: monospace;
  font-size: 0.85rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.changelog-badge {
  display: inline-block;
  padding: 0.25rem 0.65rem;
  border-radius: 99px;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--c, var(--primary));
  background: color-mix(in srgb, var(--c, var(--primary)) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--c, var(--primary)) 35%, transparent);
}

.changelog-status-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.65rem;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.changelog-status-btn.publicado { color: var(--success); border-color: rgba(16, 185, 129, 0.3); }
.changelog-status-btn.rascunho { color: var(--text-muted); }
.changelog-status-btn:hover { background: rgba(255, 255, 255, 0.05); }

/* ── Modal (autocontido — ver nota no topo do arquivo) ─────── */
.changelog-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 1rem;
}

.changelog-modal {
  width: 100%;
  max-width: 520px;
  max-height: 90vh;
  background: #0d1624;
  border: 1px solid rgba(0, 240, 255, 0.12);
  border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.04);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.changelog-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.changelog-modal-header h3 {
  font-size: 1.05rem;
  font-weight: 700;
  color: #e2e8f0;
  margin: 0;
}

.changelog-btn-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: transparent;
  color: #64748b;
  cursor: pointer;
  flex-shrink: 0;
}

.changelog-btn-close:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
  color: var(--danger);
}

.changelog-modal-body {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow-y: auto;
}

.changelog-form-row {
  display: flex;
  gap: 1rem;
}

.changelog-form-group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  flex: 1;
}

.changelog-form-group label {
  font-size: 0.78rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.changelog-form-group input,
.changelog-form-group select,
.changelog-form-group textarea {
  padding: 0.6rem 0.9rem;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #e2e8f0;
  font-size: 0.9rem;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
  width: 100%;
  resize: vertical;
}

.changelog-form-group input:focus,
.changelog-form-group select:focus,
.changelog-form-group textarea:focus {
  border-color: rgba(0, 240, 255, 0.35);
  box-shadow: 0 0 0 3px rgba(0, 240, 255, 0.06);
}

.changelog-form-group select option { background: #0d1624; }

.changelog-input-error {
  border-color: var(--danger) !important;
  background: rgba(239, 68, 68, 0.05) !important;
}

.changelog-image-upload {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100px;
  border: 1px dashed rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.2s;
}

.changelog-image-upload:hover { border-color: rgba(0, 240, 255, 0.35); }

.changelog-image-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-muted);
  font-size: 0.82rem;
  padding: 1.5rem;
}

.changelog-image-preview {
  width: 100%;
  max-height: 220px;
  object-fit: cover;
  display: block;
}

.changelog-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding-top: 0.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
```

- [ ] **Step 3: Commit**

```bash
cd /home/arthjhon/workspace/projects/IoT/projeto-sentinela
git add src/pages/admin/ChangelogPage.jsx src/pages/admin/ChangelogPage.css
git commit -m "feat(changelog): pagina admin /admin/changelog — lista, CRUD com foto e data oficial"
```

(Build ainda vai falhar até a Task 6 criar `EvolucaoPage.jsx` — não rodar build isolado aqui.)

---

## Task 6: Página pública `/evolucao`

**Files:**
- Create: `src/pages/public/EvolucaoPage.jsx`
- Create: `src/pages/public/EvolucaoPage.css`

**Interfaces:**
- Consumes: `listarPublicadas, CATEGORIA_COLORS` de `../../services/changelog` (Task 3); `getSetting, MONITORAMENTO_INICIO_KEY` de `../../services/settings` (Task 3); `diasDesde, marcosDeDias` de `../../utils/milestones` (Task 2).
- Produces: componente default `EvolucaoPage`, consumido pela rota registrada na Task 4. **Depois desta task, o build volta a passar** (rotas da Task 4 finalmente têm todos os componentes que referenciam).

- [ ] **Step 1: Criar `src/pages/public/EvolucaoPage.jsx`**

```jsx
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
        const [cfg, entradas] = await Promise.all([
          getSetting(MONITORAMENTO_INICIO_KEY, null),
          listarPublicadas(),
        ]);
        if (!ativo) return;

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
```

- [ ] **Step 2: Criar `src/pages/public/EvolucaoPage.css`**

```css
.evolucao-page {
  max-width: 780px;
  margin: 0 auto;
  padding: 3rem 2rem 4rem;
  display: flex;
  flex-direction: column;
  gap: 3rem;
}

@media (max-width: 600px) {
  .evolucao-page { padding: 2rem 1.25rem 3rem; gap: 2rem; }
}

.evolucao-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.evolucao-icon-wrap {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(0, 240, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
}

.evolucao-subtitle {
  font-size: 1rem;
  color: var(--text-muted);
  line-height: 1.7;
  max-width: 520px;
}

.evolucao-counter {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 0.5rem;
  padding: 1rem 2rem;
  border-radius: 14px;
  border: 1px solid rgba(0, 240, 255, 0.15);
  background: rgba(0, 240, 255, 0.04);
}

.evolucao-counter-value {
  font-size: 2.4rem;
  font-weight: 700;
  font-family: 'Outfit', sans-serif;
  color: var(--primary);
  line-height: 1;
}

.evolucao-counter-label {
  font-size: 0.82rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  margin-top: 0.4rem;
}

.evolucao-timeline {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.evolucao-empty {
  color: var(--text-muted);
  text-align: center;
  padding: 2rem 0;
}

.evolucao-item {
  display: flex;
  gap: 1rem;
  padding: 1.25rem 1.5rem;
  border-radius: 14px;
}

.evolucao-item-marker {
  width: 4px;
  border-radius: 4px;
  background: var(--c, var(--primary));
  flex-shrink: 0;
}

.evolucao-item-body {
  flex: 1;
  min-width: 0;
}

.evolucao-item-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.4rem;
}

.evolucao-item-date {
  font-family: monospace;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.evolucao-item-badge {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 99px;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--c, var(--primary));
  background: color-mix(in srgb, var(--c, var(--primary)) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--c, var(--primary)) 35%, transparent);
}

.evolucao-item-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: #fff;
  margin-bottom: 0.35rem;
}

.evolucao-item-desc {
  font-size: 0.88rem;
  color: var(--text-muted);
  line-height: 1.6;
}

.evolucao-item-image {
  margin-top: 0.75rem;
  width: 100%;
  max-height: 280px;
  object-fit: cover;
  border-radius: 10px;
  display: block;
}

@media (max-width: 600px) {
  .evolucao-item { padding: 1rem 1.1rem; gap: 0.75rem; }
}
```

`.glass`, `.animate-fade-in` e `.gradient-text` são classes globais (definidas em `src/index.css` e `src/styles/shared.css`, importadas em `main.jsx` — sempre carregadas, não sofrem do problema de CSS por chunk).

- [ ] **Step 3: Build e lint — agora o app inteiro deve compilar**

```bash
cd /home/arthjhon/workspace/projects/IoT/projeto-sentinela
npx vite build 2>&1 | tail -5
npm run lint 2>&1 | grep -E "✖"
```

Expected: `✓ built` sem erro; contagem de lint igual ou menor que o baseline anotado no Step 4 da Task 3 (nenhum erro novo nos arquivos criados/modificados neste plano).

- [ ] **Step 4: Rodar a suíte de testes inteira**

```bash
npx vitest run
```

Expected: todos os arquivos passam, incluindo `milestones.test.js` (Task 2).

- [ ] **Step 5: Commit**

```bash
git add src/pages/public/EvolucaoPage.jsx src/pages/public/EvolucaoPage.css
git commit -m "feat(changelog): pagina publica /evolucao — hero de dias + timeline com marcos automaticos"
```

---

## Task 7: Verificação end-to-end no navegador + documentação

**Files:**
- Modify: `implementados.md` (raiz do repo `IoT/`, não dentro de `projeto-sentinela/`)
- Modify: `projeto-sentinela/README.md`

**Interfaces:**
- Consumes: todo o trabalho das Tasks 1-6, já staged.
- Produces: nenhuma interface nova — esta task só verifica e documenta.

- [ ] **Step 1: Subir o dev server (se não estiver rodando)**

```bash
cd /home/arthjhon/workspace/projects/IoT/projeto-sentinela
pgrep -f "vite --host" >/dev/null && echo "já rodando" || (npx vite --host 0.0.0.0 --port 5173 &)
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://172.16.200.22:5173/
```

Expected: `200`.

- [ ] **Step 2: Login como admin e navegar para `/admin/changelog`**

Usar as credenciais já existentes neste ambiente (usuário `arthur`, senha `wgrKzpbaM8DZU0Am`) para logar em `http://172.16.200.22:5173/login`, depois navegar para `http://172.16.200.22:5173/admin/changelog`.

Verificar: o item "Changelog" aparece no menu lateral do admin; a página carrega sem erro de console; o card "Data Oficial de Início do Monitoramento" aparece.

- [ ] **Step 3: Definir a data oficial**

Preencher "Data de início" com uma data no passado (ex.: `2023-05-12`) e "Rótulo exibido" com `desde o início do projeto`. Clicar "Salvar Data Oficial".

Verificar: toast de sucesso aparece; recarregando a página, os valores persistem.

- [ ] **Step 4: Criar uma entrada com foto**

Clicar "Nova Entrada". Preencher: título "Terceira bóia entrou em operação", data de hoje, categoria "Hardware", descrição "Bóia SM-03 instalada na Lagoa Manguaba.", escolher uma imagem qualquer. Clicar "Publicar Entrada".

Verificar: toast de sucesso; a entrada aparece na lista com a miniatura de categoria correta e status "Publicado".

- [ ] **Step 5: Verificar a página pública `/evolucao`**

Navegar (sem estar logado, ou em aba anônima) para `http://172.16.200.22:5173/evolucao`.

Verificar:
- O hero mostra um número de dias compatível com a data oficial definida no Step 3 (ex.: se hoje for `2026-07-20` e a data oficial `2023-05-12`, o número deve bater com `diasDesde('2023-05-12', new Date('2026-07-20'))`).
- A entrada criada no Step 4 aparece na timeline, com foto, na posição correta (mais recente no topo, já que a data é hoje).
- Pelo menos um marco automático de dias aparece na timeline (com uma data-âncora de 2023, os marcos "1 ano", "2 anos", "3 anos", "100 dias", "500 dias", "1000 dias" já devem ter ocorrido).
- O link "Evolução" está visível na navbar (desktop) e no rodapé.

- [ ] **Step 6: Verificar o toggle de rascunho**

Voltar ao admin, clicar no botão de status da entrada criada no Step 4 para despublicá-la (vira "Rascunho"). Recarregar `/evolucao` em aba anônima.

Verificar: a entrada não aparece mais na timeline pública (mas os marcos automáticos continuam aparecendo, pois são independentes).

Reverter: clicar de novo no status para publicar novamente.

- [ ] **Step 7: Verificar responsividade da navbar (item novo pode ter apertado o menu)**

Verificar a navbar pública em três larguras: desktop largo (ex. 1902px), o breakpoint mobile do projeto (992px, onde `.desktop-only`/`.mobile-only` alternam — ver `PublicNavbar.css`), e mobile estreito (ex. 390px). Confirmar que o item "Evolução" aparece sem quebrar o layout no desktop e aparece corretamente no menu hambúrguer no mobile.

- [ ] **Step 8: Editar e remover a entrada de teste**

No admin, clicar em editar na entrada criada no Step 4, mudar a descrição, salvar — verificar que a mudança persiste. Depois, clicar em remover, confirmar no modal — verificar que a entrada some da lista e (voltando à página pública) some da timeline.

- [ ] **Step 9: Atualizar `implementados.md`**

Ler o arquivo `/home/arthjhon/workspace/projects/IoT/implementados.md` (já existe, documenta o backlog anterior desta sessão) e adicionar, ao final, uma nova seção seguindo a mesma estrutura visual já usada no documento (títulos com emoji `✅`/`🔧`/`⏸️`, tom direto):

```markdown
---

## Changelog Público ("Evolução") — feature nova, fora do backlog original

> Sugerida pelo usuário em 20/07/2026. Design em
> `projeto-sentinela/docs/superpowers/specs/2026-07-20-changelog-publico-design.md`,
> plano em `projeto-sentinela/docs/superpowers/plans/2026-07-20-changelog-publico.md`.

### ✅ Aplicado

- Tabela `changelog_entries` + bucket `changelog` no Storage (RLS: leitura
  pública só de publicados, escrita só admin) — `supabase_changelog_schema.sql`
- `src/services/changelog.js`: CRUD + upload de imagem
- `src/utils/milestones.js`: marcos automáticos de dias (100/500/1000/...,
  aniversários de calendário) — função pura, 9 testes unitários
- Painel `/admin/changelog`: lista, criar/editar/remover entradas com foto,
  publicar/despublicar, e o campo de **data oficial** que ancora os marcos
- Página pública `/evolucao`: hero com contador de dias + timeline mesclando
  entradas curadas e marcos automáticos, ordenada por data
- Links de navegação: navbar (desktop + mobile) e rodapé

### Decisão de integridade que moldou o design

A data-âncora do contador é definida **manualmente pelo admin**
(`app_settings.monitoramento_inicio`), e não derivada de telemetria — a
telemetria hoje é mock e tem lacuna desde 08/07. Isso mantém o número
defensável numa prestação de contas, ao custo de exigir que alguém confirme a
data uma vez no painel.

### Migration em produção

Rodei `supabase_changelog_schema.sql` só no Supabase local. Em produção,
execute o mesmo arquivo no SQL Editor — é idempotente.
```

- [ ] **Step 10: Atualizar o Roadmap do `README.md`**

Em `projeto-sentinela/README.md`, na seção `### Concluído` do Roadmap, adicionar (seguindo o formato dos itens já existentes):

```markdown
- [x] **Changelog público** (`/evolucao`) — timeline de marcos e novidades
      curados pelo admin, com marcos automáticos de "dias monitorando"
      calculados a partir de uma data oficial definida no painel
```

- [ ] **Step 11: Commit final**

**Atenção:** `implementados.md` fica em `/home/arthjhon/workspace/projects/IoT/` (raiz do projeto), que **não é um repositório git** (só `projeto-sentinela/` tem `.git`). Não rodar `git add`/`git commit` nele — é só um arquivo de texto editado normalmente, sem controle de versão (mesma situação de `docker-compose.yml`/`telegraf.conf` nesta árvore). O commit abaixo cobre só os arquivos dentro de `projeto-sentinela/`.

```bash
cd /home/arthjhon/workspace/projects/IoT/projeto-sentinela
git add docs/superpowers/plans/2026-07-20-changelog-publico.md README.md
git commit -m "docs(changelog): atualiza README (roadmap) apos a feature de changelog publico"
```

---

## Nota de implantação (fora do escopo das tasks acima)

A migration (Task 1) só foi aplicada no Supabase **local**. Antes de considerar
a feature "em produção", alguém com acesso ao Supabase de produção precisa
rodar `supabase_changelog_schema.sql` no SQL Editor de lá — isso não pode ser
automatizado por um agente sem as credenciais de produção.
