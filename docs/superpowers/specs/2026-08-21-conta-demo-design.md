# Conta Demo (Visualizador) — Design

**Data:** 2026-08-21
**Status:** aprovado (aguardando revisão da spec)
**Escopo:** 1 feature. Não inclui a homepage (spec própria) nem o relatório PDF.

## Objetivo

Uma credencial única, compartilhada, que o dono do projeto entrega manualmente
a avaliadores de edital e parceiros em potencial para navegar o painel
administrativo real — vendo dados reais, todas as 6 páginas — sem conseguir
alterar nada. Reforça credibilidade técnica mostrando a plataforma real
funcionando, não uma versão fake ou capturas de tela.

## Contexto e restrições

- **Público-alvo:** pessoas que o dono do projeto entrega manualmente
  (avaliadores, parceiros), não visitantes anônimos do site público. Ainda
  assim tecnicamente não-confiáveis — a proteção real precisa estar no banco
  (RLS), nunca só na interface.
- **Pré-requisito de segurança já resolvido nesta sessão:** duas falhas em
  `public.profiles` foram corrigidas antes desta feature ser viável —
  auto-escalada de role (qualquer autenticado podia virar admin via API
  direta) e edição de outro operador silenciosamente quebrada (RLS bloqueava,
  código não conferia). Sem essas correções, a conta demo não seria segura de
  entregar a ninguém.
- **Role já existe, mas é decorativo.** `visualizador` está no CHECK
  constraint de `profiles.role` e no dropdown de criação de usuário desde o
  início, mas hoje só é checado em um lugar (esconde um botão em
  `SensorsPage.jsx`) — nenhuma RLS trava escrita para esse role.
- **Auditoria pré-existente para escrita ampla demais.** As policies de
  `maintenance_logs`, `sensor_calibrations` e `firmware_deploys` hoje aceitam
  `auth.role() = 'authenticated'` — qualquer usuário logado, não só
  admin/operador. Isso nunca foi um problema prático porque só admins tinham
  conta, mas passa a ser um buraco real assim que uma conta `visualizador`
  existir.
- **Já protegido, sem mudança necessária:** `changelog_entries`, `app_settings`
  e os buckets de Storage (`changelog`, `firmware`) já checam
  `profiles.role = 'admin'` nas policies de escrita.

## Modelo da conta

Uma única conta compartilhada (não uma por pessoa/ocasião):
- Username: `demo` (email efetivo `demo@sentinela.app`)
- Role: `visualizador`
- Criada pelo fluxo já existente ("Novo Usuário" em `/admin/users`), sem
  necessidade de script ou migração
- O trigger de criação de conta sempre marca `must_change_password = true`
  para contas criadas por esse fluxo — isso não muda. Na prática: o dono do
  projeto cria a conta com uma senha provisória, loga uma vez para passar pela
  tela de troca forçada, e a senha definida ali é a que passa a entregar. Não
  precisa de tratamento especial no código para "pular" essa etapa.

Trade-off aceito conscientemente: como é uma conta só, a auditoria mostra
"demo" como autor de qualquer ação, sem diferenciar qual pessoa específica
estava logada num dado momento. Revogar acesso = trocar a senha uma vez.

## RLS — a proteção real

Aperta as três policies que hoje são mais permissivas do que deveriam,
trocando `auth.role() = 'authenticated'` por uma checagem de role real
(igual ao padrão já usado em `changelog_entries`/`app_settings`):

```sql
role IN ('admin', 'operador')
```

Tabelas afetadas:
- `maintenance_logs` — policies `mlogs_insert`, `mlogs_update`
- `sensor_calibrations` — policy `calib_insert`
- `firmware_deploys` — policies `fw_insert`, `fw_update`

`changelog_entries`, `app_settings` e os buckets `changelog`/`firmware` não
mudam — já exigem `role = 'admin'`, o que automaticamente também exclui
`visualizador`.

A policy de auto-atualização de perfil (`users_update_own_profile`, corrigida
nesta sessão) já impede a conta demo de mudar a própria role — nenhuma
mudança adicional necessária ali.

## Acesso de leitura em `/admin/users`

Hoje: `if (currentUser?.role !== 'admin') return <AcessoNegado/>` bloqueia
qualquer não-admin da página inteira.

Novo comportamento:
- **admin** — acesso total (sem mudança)
- **visualizador** — vê a lista de operadores e a aba de Log de Auditoria;
  botões de criar/editar/remover ficam desabilitados (ver próxima seção)
- **operador** — continua banido da página inteira (sem mudança — gestão de
  usuários nunca foi para esse papel)

## Modo de leitura na interface

**Hook `useReadOnly()`** (novo, em `src/hooks/`): retorna
`currentUser?.role === 'visualizador'`. Usado em todas as 6 páginas admin
para desabilitar (não esconder) os controles de escrita:

| Página | Controles desabilitados |
|---|---|
| Dashboard | nenhum (já é só leitura) |
| Bóias (`SensorsPage`) | Iniciar Manutenção, Registrar Calibração (CRUD de bóia em si não é real, fica como está) |
| Firmware (`OtaPage`) | Enviar OTA |
| Configurações (`SettingsPage`) | Salvar |
| Changelog (`ChangelogPage`) | Nova Entrada, Editar, Remover, toggle Publicar/Rascunho |
| Operadores (`UsersPage`) | Novo Usuário, Editar, Remover |

Cada controle desabilitado leva um `title`/tooltip curto: "Indisponível no
modo demonstração". Desabilitar em vez de esconder é proposital — mantém a
impressão de uma plataforma completa, só com a ação bloqueada.

**Selo "Modo Demonstração"** — badge fixo no `AdminLayout`, visível em toda
página quando `currentUser.role === 'visualizador'`. Evita que a pessoa ache
que o painel travou quando um botão desabilitado não responde.

## Fora de escopo

- Não cria contas por pessoa/ocasião (decisão explícita: conta única).
- Não esconde nenhuma página ou dado de `visualizador` (decisão explícita:
  "vê tudo, só sem escrever").
- Não adiciona um 4º papel na hierarquia — reaproveita `visualizador`, que já
  existe no schema.
- Não altera o comportamento de `operador` em nenhuma tela.
