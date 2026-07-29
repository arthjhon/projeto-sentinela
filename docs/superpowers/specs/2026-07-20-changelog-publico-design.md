# Changelog público ("Evolução") — Design

**Data:** 2026-07-20
**Status:** aprovado (aguardando revisão da spec)
**Escopo:** 1 feature. O relatório PDF é feature separada, spec própria, depois.

## Objetivo

Página pública que mostra a evolução do Projeto Sentinela ao longo do tempo
(marcos, novas bóias/sensores, parcerias, reconhecimentos), para demonstrar
tração a avaliadores de edital (ex.: Centelha) e apoiadores.

## Contexto e restrições

- **Sem backend.** O frontend (React/Vite) fala direto com Supabase (dados +
  Storage) e InfluxDB (via proxy). Nada roda no servidor sob agenda.
- **Reuso de padrões existentes:** tabelas com RLS (ver `app_settings`,
  `audit_logs`), bucket com RLS (ver `supabase_ota_schema.sql` → bucket
  `firmware`), helper de auditoria `src/services/auditLog.js`, config em
  `app_settings` via `src/services/settings.js`.
- **Integridade:** o número de "dias monitorando" é público e vai a prestação
  de contas. Por isso a data-âncora é definida e assumida pelo admin, não
  derivada de telemetria (que hoje é mock e tem lacuna desde 08/07).

## Modelo de conteúdo (híbrido)

1. **Entradas manuais** (curadas pelo admin) — o grosso do conteúdo.
2. **Marcos automáticos de dias** — calculados no cliente a partir da data
   oficial. Único tipo automático. "Nova bóia/sensor" NÃO é automático (não há
   fonte persistente: `fleet.js` é código, o CRUD de bóias não grava) — quando
   acontecer, vira entrada manual.

## Dados

### Tabela `public.changelog_entries` (nova)

| coluna       | tipo        | nota |
|--------------|-------------|------|
| id           | uuid pk     | `gen_random_uuid()` |
| titulo       | text not null | |
| descricao    | text not null | |
| categoria    | text not null | CHECK IN ('Hardware','Sensor','Marco','Parceria','Reconhecimento','Software') |
| data         | date not null | data do evento (definida pelo admin) |
| imagem_url   | text        | nullable (entrada pode não ter foto) |
| publicado    | boolean not null default true | permite rascunho |
| created_by   | uuid → auth.users (ON DELETE SET NULL) | |
| created_at   | timestamptz default now() | |
| updated_at   | timestamptz default now() | |

Índice: `(publicado, data DESC)` para a listagem pública.

### RLS

- **SELECT público** só de publicados:
  `USING (publicado = true)` — libera anon (a página é pública).
  (Admin lê tudo, inclusive rascunho, via política adicional que checa
  `profiles.role = 'admin'`.)
- **INSERT/UPDATE/DELETE** só admin (checa `profiles.role = 'admin'`), igual ao
  padrão do `app_settings`/OTA.

### Storage — bucket `changelog`

- Espelha o bucket `firmware`: leitura pública, upload/delete só admin (checa
  `profiles.role = 'admin'`).
- `imagem_url` guarda a URL pública do objeto.

### Config em `app_settings` (reusa a tabela)

- Chave `monitoramento_inicio` → `{ "data": "YYYY-MM-DD", "rotulo": "desde o início do projeto" }`.
- Escrita só admin (política já existente do `app_settings`), leitura pública.

## Componentes

### Serviço `src/services/changelog.js`

Interface (o que faz, como se usa, do que depende — depende de `lib/supabase` e
`auditLog`):

- `listarPublicadas()` → entradas com `publicado = true` E `data <= hoje`,
  `data DESC` (uso público; o filtro de data futura vive na query, alinhado com
  os marcos, que também só mostram o que já ocorreu).
- `listarTodas()` → todas, incl. rascunho (uso admin).
- `criarEntrada(dados)` → insert + `logAcao(AUDIT.CHANGELOG_CRIAR, …)`.
- `atualizarEntrada(id, dados)` → update + auditoria.
- `removerEntrada(id)` → delete (+ remove imagem do bucket) + auditoria.
- `uploadImagem(file)` → sobe no bucket `changelog`, devolve URL pública.

Novas constantes em `auditLog.js`: `CHANGELOG_CRIAR`, `CHANGELOG_EDITAR`,
`CHANGELOG_REMOVER` (+ rótulos).

### Marcos automáticos — `src/utils/milestones.js`

- `marcosDeDias(dataInicio, hoje)` → lista de marcos JÁ atingidos
  (`data <= hoje`): 100, 365 (1 ano), 500, 730 (2 anos), 1000, 1095 (3 anos),
  … Cada marco vira `{ data, categoria: 'Marco', titulo, auto: true }`.
- Função pura, testável isoladamente (sem rede) → tem teste unitário.

### Admin — página `/admin/changelog`

- Rota nova sob `AdminLayout` (padrão das outras admin).
- Lista das entradas (todas) com editar/remover.
- Formulário (modal ou inline): título, data, categoria (select), descrição,
  upload de imagem (preview), toggle publicado.
- Bloco de **config**: data oficial + rótulo (grava em `app_settings`).
- Item novo no menu lateral do admin.

### Público — página `/evolucao`

- Rota nova sob `PublicLayout`.
- **Hero:** "N dias monitorando" (de `monitoramento_inicio`) + rótulo.
- **Timeline vertical**, mais recente no topo: mescla `listarPublicadas()` +
  `marcosDeDias(...)`, ordenada por `data DESC`. Cada item: data, selo de
  categoria, título, descrição, miniatura da imagem (quando houver).
- Estado vazio tratado (sem entradas → mensagem amistosa).

### Navegação

- Item **"Evolução"** na `PublicNavbar` (verificar responsivo — a navbar já tem
  vários itens; testar 992px e mobile) + link no `Footer`.

## Fluxo de dados

```
Admin  ──cria/edita──►  Supabase (changelog_entries + bucket changelog)
Admin  ──define data──►  app_settings.monitoramento_inicio
Público /evolucao:
  listarPublicadas() ─┐
                      ├─► merge + sort(data DESC) ─► timeline
  marcosDeDias(...)  ─┘
  getSetting(monitoramento_inicio) ─► hero "N dias"
```

## Erros e bordas

- Falha ao carregar entradas → mensagem de erro na página, não tela branca.
- Falha no upload de imagem → toast no admin, entrada não é salva pela metade.
- `monitoramento_inicio` ausente → hero some (ou usa fallback neutro), sem quebrar.
- Auditoria nunca derruba a ação (padrão já estabelecido em `auditLog.js`).
- Data futura numa entrada → permitida (agendar anúncio), mas some da timeline
  pública até chegar a data? Decisão: mostrar só `data <= hoje` na pública
  (consistente com os marcos).

## Testes

- **Unitário** `milestones.js`: marcos corretos para uma data-início conhecida;
  não retorna marcos futuros; fronteiras (exatamente 100 dias).
- **Manual no navegador** (Playwright, já validado nesta sessão como viável):
  criar entrada com foto no admin → aparece em `/evolucao`; rascunho não aparece
  na pública; hero mostra os dias da data oficial; item de nav leva à página.
- **RLS via REST** (padrão já usado): anon lê publicados, não escreve; admin
  escreve; rascunho invisível ao anon.

## Migration

Arquivo novo `supabase_changelog_schema.sql` (mantém a feature isolada e fácil
de rodar sozinha em produção), idempotente, com `changelog_entries` + bucket
`changelog` + políticas RLS. Rodar no Supabase local; documentar que precisa
rodar no de produção.

## Fora de escopo (YAGNI)

Comentários, reações, RSS, i18n, busca/filtro na pública, paginação (volume
baixo), agendamento server-side, marcos automáticos de bóia/sensor, versionamento
de entradas.

## Dependências novas

Nenhuma. Usa o que já existe (Supabase JS, Storage, lucide-react).
