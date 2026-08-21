# Conta Demo (Visualizador) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma credencial única (`visualizador`) que o dono do projeto entrega
manualmente a avaliadores/parceiros para navegar o painel admin real —
todas as 6 páginas visíveis, nenhuma escrita possível.

**Architecture:** Duas camadas independentes, RLS primeiro (a proteção real),
UI depois (a experiência). RLS aperta 3 policies hoje abertas demais
(`auth.role() = 'authenticated'` → `role IN ('admin','operador')`). A UI abre
visibilidade de navegação para `visualizador` (hoje só admin vê 4 das 6
páginas) e desabilita (nunca esconde) os botões de escrita via um hook
`useReadOnly()` reutilizável.

**Tech Stack:** React 19, Supabase (Postgres RLS + PostgREST), Vite.

**Spec:** `docs/superpowers/specs/2026-08-21-conta-demo-design.md`

## Global Constraints

- **Conta única compartilhada**, não uma por pessoa/ocasião (decisão da spec).
- **`operador` não muda em nenhuma tela.** Todo o trabalho deste plano mira
  `visualizador`; qualquer condição que hoje inclua/exclua `operador` fica
  exatamente como está.
- **`visualizador` vê as 6 páginas admin**, sem exceção — nada fica escondido
  por causa do role, só os botões de escrita.
- **Desabilitar, nunca esconder** os controles de escrita para `visualizador`
  (reforça a impressão de plataforma completa, não quebrada).
- **RLS é a proteção real; a UI é só experiência.** Toda tarefa de RLS deve
  ser verificada com uma chamada REST direta (curl), não só clicando na UI.
- **Sem testes automatizados novos** para este plano — segue o padrão já
  estabelecido no projeto (hooks como `useDiasMonitorados`/`useMqtt` e
  serviços acoplados ao Supabase não têm teste unitário; verificação é via
  REST direto e navegador real).
- **RLS deste plano é idempotente via `DROP POLICY IF EXISTS` + `CREATE
  POLICY`** (substitui policies existentes, não é o padrão `DO $$ IF NOT
  EXISTS` usado para políticas novas em tabelas novas).
- **`must_change_password` não recebe tratamento especial.** A conta demo é
  criada pelo fluxo normal ("Novo Usuário"), que sempre marca
  `must_change_password = true`. Isso é esperado, não um bug a corrigir.

---

## Task 1: RLS — aperta as 3 policies permissivas demais

**Files:**
- Create: `supabase_visualizador_rls_fix.sql`

**Interfaces:**
- Produces: nenhuma interface de código — só substitui 3 policies existentes
  no banco (`mlogs_insert`, `mlogs_update`, `calib_insert`, `fw_insert`,
  `fw_update`). Consumido implicitamente por qualquer escrita nessas 3
  tabelas, de qualquer página.

- [ ] **Step 1: Escrever o arquivo de migration**

Criar `supabase_visualizador_rls_fix.sql` na raiz de `projeto-sentinela/`:

```sql
-- ================================================
-- Fecha o buraco de RLS que a conta demo (role visualizador) expõe:
-- maintenance_logs, sensor_calibrations e firmware_deploys aceitavam
-- escrita de QUALQUER autenticado (auth.role() = 'authenticated'), não só
-- admin/operador. Nunca foi problema na prática porque só admins tinham
-- conta — passa a ser um buraco real assim que uma conta visualizador
-- existir.
--
-- changelog_entries, app_settings e os buckets de Storage (changelog,
-- firmware) já exigem profiles.role = 'admin' nas policies de escrita —
-- não precisam de mudança, o que automaticamente também exclui visualizador.
--
-- Cole e execute no SQL Editor do Supabase. Idempotente (DROP + CREATE).
-- ================================================

DROP POLICY IF EXISTS mlogs_insert ON public.maintenance_logs;
CREATE POLICY mlogs_insert ON public.maintenance_logs
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'operador'))
  );

DROP POLICY IF EXISTS mlogs_update ON public.maintenance_logs;
CREATE POLICY mlogs_update ON public.maintenance_logs
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'operador'))
  );

DROP POLICY IF EXISTS calib_insert ON public.sensor_calibrations;
CREATE POLICY calib_insert ON public.sensor_calibrations
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'operador'))
  );

DROP POLICY IF EXISTS fw_insert ON public.firmware_deploys;
CREATE POLICY fw_insert ON public.firmware_deploys
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'operador'))
  );

DROP POLICY IF EXISTS fw_update ON public.firmware_deploys;
CREATE POLICY fw_update ON public.firmware_deploys
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'operador'))
  );
```

- [ ] **Step 2: Aplicar no Supabase local (homolog) e verificar idempotência**

```bash
cd /home/arthjhon/workspace/projects/IoT/projeto-sentinela
docker exec -i supabase-db psql -U postgres -d postgres < supabase_visualizador_rls_fix.sql
docker exec -i supabase-db psql -U postgres -d postgres < supabase_visualizador_rls_fix.sql 2>&1 | grep -ic "^ERROR"
```

Expected: primeira execução mostra `DROP POLICY`/`CREATE POLICY` 10 vezes (5
pares), sem erro. Segunda execução: `0`.

- [ ] **Step 3: Criar um usuário de teste `visualizador` e confirmar que a escrita é bloqueada**

```bash
cd /home/arthjhon/workspace/projects/IoT/supabase/docker
SERVICE=$(grep "^SERVICE_ROLE_KEY=" .env | cut -d= -f2-)
ANON=$(grep "^ANON_KEY=" .env | cut -d= -f2-)

curl -s -X POST "http://localhost:8000/auth/v1/admin/users" \
  -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H "Content-Type: application/json" \
  -d '{"email":"teste.demo.rls@sentinela.app","password":"SenhaTesteDemo123!","email_confirm":true,"user_metadata":{"name":"Teste Demo RLS","username":"teste.demo.rls","role":"visualizador"}}'

TOKEN=$(curl -s -X POST "http://localhost:8000/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"email":"teste.demo.rls@sentinela.app","password":"SenhaTesteDemo123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")

echo "=== visualizador tenta inserir em maintenance_logs (espera 401/403 ou 0 linhas) ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST "http://localhost:8000/rest/v1/maintenance_logs" \
  -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"boia_id":"SM-01","operador_nome":"Teste Demo RLS","motivo":"teste"}'
```

Expected: `401` ou `403` (RLS bloqueia o INSERT — a mensagem exata de erro
varia, o que importa é não ser `200`/`201`).

- [ ] **Step 4: Confirmar que `operador` continua conseguindo escrever (não regrediu)**

```bash
cd /home/arthjhon/workspace/projects/IoT/supabase/docker
SERVICE=$(grep "^SERVICE_ROLE_KEY=" .env | cut -d= -f2-)
ANON=$(grep "^ANON_KEY=" .env | cut -d= -f2-)

curl -s -X POST "http://localhost:8000/auth/v1/admin/users" \
  -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H "Content-Type: application/json" \
  -d '{"email":"teste.demo.operador@sentinela.app","password":"SenhaTesteOp123!","email_confirm":true,"user_metadata":{"name":"Teste Demo Operador","username":"teste.demo.operador","role":"operador"}}'

TOKEN=$(curl -s -X POST "http://localhost:8000/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"email":"teste.demo.operador@sentinela.app","password":"SenhaTesteOp123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")

echo "=== operador insere em maintenance_logs (espera sucesso, 201) ==="
curl -s -o /tmp/op_test.json -w "HTTP %{http_code}\n" -X POST "http://localhost:8000/rest/v1/maintenance_logs" \
  -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"boia_id":"SM-01","operador_nome":"Teste Demo Operador","motivo":"teste operador"}'
cat /tmp/op_test.json
```

Expected: `HTTP 201` com a linha criada. Se falhar aqui, a policy está errada
(bloqueando quem devia poder escrever) — não avance sem entender por quê.

- [ ] **Step 5: Limpar dados e contas de teste**

```bash
cd /home/arthjhon/workspace/projects/IoT/supabase/docker
docker exec supabase-db psql -U postgres -d postgres -tAc "delete from public.maintenance_logs where motivo='teste operador';"
SERVICE=$(grep "^SERVICE_ROLE_KEY=" .env | cut -d= -f2-)
for EMAIL in teste.demo.rls teste.demo.operador; do
  ID=$(docker exec supabase-db psql -U postgres -d postgres -tAc "select id from auth.users where email='${EMAIL}@sentinela.app';")
  curl -s -X DELETE "http://localhost:8000/auth/v1/admin/users/${ID}" -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -o /dev/null -w "delete ${EMAIL}: %{http_code}\n"
done
rm -f /tmp/op_test.json
```

- [ ] **Step 6: Commit**

```bash
cd /home/arthjhon/workspace/projects/IoT/projeto-sentinela
git add supabase_visualizador_rls_fix.sql
git commit -m "feat(demo): aperta RLS de maintenance_logs/sensor_calibrations/firmware_deploys para role IN (admin, operador)"
```

---

## Task 2: Hook `useReadOnly` + navegação e selo no `AdminLayout`

**Files:**
- Create: `src/hooks/useReadOnly.js`
- Modify: `src/pages/admin/AdminLayout.jsx`

**Interfaces:**
- Consumes: `useAuth()` de `src/contexts/AuthContext.jsx` — usa
  `currentUser.role` (string: `'admin' | 'operador' | 'visualizador'`).
- Produces: `useReadOnly(): boolean` — `true` quando `currentUser.role ===
  'visualizador'`. Tasks 3 e 4 importam e chamam este hook.

- [ ] **Step 1: Criar o hook**

Criar `src/hooks/useReadOnly.js`:

```js
import { useAuth } from '../contexts/AuthContext';

/**
 * true quando o usuário logado é a conta demo (role 'visualizador').
 * Usado para desabilitar (nunca esconder) controles de escrita nas páginas
 * admin — a proteção real é a RLS, isto é só a experiência de uso.
 */
export function useReadOnly() {
  const { currentUser } = useAuth();
  return currentUser?.role === 'visualizador';
}
```

- [ ] **Step 2: Abrir a navegação de Operadores/Firmware/Configurações/Changelog para `visualizador`**

Em `src/pages/admin/AdminLayout.jsx`, as 4 ocorrências de
`{currentUser?.role === 'admin' && (` (linhas 48, 58, 68, 78 — Operadores,
Firmware, Configurações, Changelog) viram
`{(currentUser?.role === 'admin' || currentUser?.role === 'visualizador') && (`.
Os 4 blocos completos, só com a condição trocada (o resto de cada `NavLink`
fica exatamente como está hoje):

```jsx
          {(currentUser?.role === 'admin' || currentUser?.role === 'visualizador') && (
            <NavLink
              to="/admin/users"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Users size={20} />
              <span>Operadores</span>
            </NavLink>
          )}

          {(currentUser?.role === 'admin' || currentUser?.role === 'visualizador') && (
            <NavLink
              to="/admin/ota"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Cpu size={20} />
              <span>Firmware</span>
            </NavLink>
          )}

          {(currentUser?.role === 'admin' || currentUser?.role === 'visualizador') && (
            <NavLink
              to="/admin/settings"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <SlidersHorizontal size={20} />
              <span>Configurações</span>
            </NavLink>
          )}

          {(currentUser?.role === 'admin' || currentUser?.role === 'visualizador') && (
            <NavLink
              to="/admin/changelog"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Rss size={20} />
              <span>Changelog</span>
            </NavLink>
          )}
```

- [ ] **Step 3: Adicionar o selo "Modo Demonstração" no header**

Em `src/pages/admin/AdminLayout.jsx`, importar `Eye` de `lucide-react` (já
importa outros ícones da mesma lib) e adicionar o badge dentro de
`.admin-header`, ao lado de `.header-status`:

```jsx
import { LogOut, LayoutDashboard, ActivitySquare, ShieldAlert, Users, Cpu, SlidersHorizontal, Rss, Eye } from 'lucide-react';
```

```jsx
        <header className="admin-header glass">
          <h2>Centro de Comando</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {currentUser?.role === 'visualizador' && (
              <span className="badge badge-warning">
                <Eye size={14} /> Modo Demonstração — Somente Leitura
              </span>
            )}
            <div className="header-status">
              <span className="status-dot green"></span>
              Sistema Operacional
            </div>
          </div>
        </header>
```

`.badge`/`.badge-warning` já existem em `src/styles/shared.css` (importado
globalmente) — não precisa CSS novo.

- [ ] **Step 4: Verificar visualmente no navegador**

```bash
cd /home/arthjhon/workspace/projects/IoT/projeto-sentinela
npx vite --host 0.0.0.0 --port 5173 &
```

Logar com uma conta `visualizador` de teste (criar uma via SQL Editor/API se
não houver: role `visualizador`, mesma senha de teste do Task 1) e confirmar:
o selo "Modo Demonstração" aparece no header, e os 4 links (Operadores,
Firmware, Configurações, Changelog) aparecem na sidebar. Logar com a conta
admin normal depois e confirmar que o selo NÃO aparece.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useReadOnly.js src/pages/admin/AdminLayout.jsx
git commit -m "feat(demo): hook useReadOnly + navegacao completa e selo Modo Demonstracao para role visualizador"
```

---

## Task 3: `UsersPage.jsx` — acesso de leitura para o visualizador

**Files:**
- Modify: `src/pages/admin/UsersPage.jsx:1-50` (imports e gate de acesso)
- Modify: `src/pages/admin/UsersPage.jsx:203-298` (botões de escrita)

**Interfaces:**
- Consumes: `useReadOnly()` de `src/hooks/useReadOnly.js` (Task 2).
- Produces: nenhuma interface nova — só altera o comportamento visual desta
  página.

- [ ] **Step 1: Trocar o gate de acesso**

Em `src/pages/admin/UsersPage.jsx`, adicionar o import do hook:

```jsx
import { useReadOnly } from '../../hooks/useReadOnly';
```

Trocar (linha ~12) para capturar o hook:

```jsx
const UsersPage = () => {
  const { users, currentUser, createAdminUser, deleteAdminUser, editAdminUser, resetUserPassword } = useAuth();
  const { addToast } = useToast();
  const readOnly = useReadOnly();
```

Trocar o gate (linhas 40-50), de bloquear todo não-admin, para bloquear só
quem não é admin **nem** visualizador:

```jsx
  if (currentUser?.role !== 'admin' && currentUser?.role !== 'visualizador') {
    return (
      <div className="dashboard-content-area">
        <div className="alert-permission glass mt-4">
          <Shield size={32} className="text-danger mb-3" />
          <h2>Acesso Negado</h2>
          <p>Você não possui privilégios de Administrador para gerenciar a base de dados de operadores.</p>
        </div>
      </div>
    );
  }
```

- [ ] **Step 2: Esconder o botão "Novo Usuário" e desabilitar Editar/Remover para o visualizador**

O botão "Novo Usuário" (linha ~222) já está dentro do bloco
`{aba === 'operadores' && (...)}`; ele deixa de aparecer para o visualizador
(não faz sentido nem abrir o modal de criação, que exige senha):

```jsx
            {!readOnly && (
              <button className="btn-primary" onClick={handleOpenCreate}>
                <Plus size={18} /> Novo Usuário
              </button>
            )}
```

Os botões Editar/Remover na tabela (linhas ~286-291) ganham `disabled`:

```jsx
                <td className="actions-cell">
                  <button className="btn-table action-btn" onClick={() => handleOpenEdit(user)} disabled={readOnly} title={readOnly ? 'Indisponível no modo demonstração' : undefined}>
                    <Edit2 size={16} />
                  </button>
                  <button className="btn-table action-btn danger-btn" onClick={() => requestDelete(user.id)} disabled={readOnly || user.id === currentUser.id} title={readOnly ? 'Indisponível no modo demonstração' : (user.id === currentUser.id ? 'Você não pode apagar sua própria conta' : 'Apagar')}>
                    <Trash2 size={16} />
                  </button>
                </td>
```

- [ ] **Step 3: Verificar no navegador**

Logar com a conta `visualizador` de teste, ir em `/admin/users`: a lista de
operadores e a aba "Log de Auditoria" aparecem normalmente; o botão "Novo
Usuário" não aparece; os botões de editar/remover na tabela aparecem
visualmente desabilitados (acinzentados) com o tooltip "Indisponível no modo
demonstração" ao passar o mouse.

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/UsersPage.jsx
git commit -m "feat(demo): acesso de leitura em /admin/users para role visualizador"
```

---

## Task 4: Desabilita escrita nas demais páginas (Bóias, Firmware, Configurações, Changelog)

**Files:**
- Modify: `src/pages/admin/SensorsPage.jsx:749-754` (botão Recalibrar)
- Modify: `src/pages/admin/OtaPage.jsx:359-372` (botão Implantar Firmware)
- Modify: `src/pages/admin/SettingsPage.jsx:140` (botão Salvar Meta)
- Modify: `src/pages/admin/ChangelogPage.jsx:200-280` (5 botões de escrita)

**Interfaces:**
- Consumes: `useReadOnly()` de `src/hooks/useReadOnly.js` (Task 2).

- [ ] **Step 1: `SensorsPage.jsx` — desabilitar "Recalibrar"**

O botão "Entrar em Modo Manutenção" (linha 775) já está gated para
`currentUser?.role !== 'visualizador'` — não mexe nisso. Falta só o botão de
calibração (linha ~749-754). Adicionar o import (já importa `useAuth`, então
só falta o hook):

```jsx
import { useReadOnly } from '../../hooks/useReadOnly';
```

Dentro do componente, ao lado de onde `currentUser` já é obtido, adicionar:

```jsx
  const readOnly = useReadOnly();
```

E o botão passa a ser:

```jsx
                                      <button
                                        className="btn-table action-btn btn-sm calib-btn"
                                        onClick={(e) => { e.stopPropagation(); handleRecalibrar(buoy.id, sensor.name); }}
                                        disabled={readOnly}
                                        title={readOnly ? 'Indisponível no modo demonstração' : undefined}
                                      >
                                        Recalibrar
                                      </button>
```

- [ ] **Step 2: `OtaPage.jsx` — desabilitar "Implantar Firmware"**

Adicionar o import (`useReadOnly` já encapsula `useAuth` internamente — não
precisa importar `useAuth` separadamente aqui, `OtaPage.jsx` não usa
`currentUser` para mais nada):

```jsx
import { useReadOnly } from '../../hooks/useReadOnly';
```

Dentro do componente (`OtaPage.jsx`, logo após a linha que declara
`const { messages, connected, publish } = useMqtt(ALL_TOPICS);`):

```jsx
  const readOnly = useReadOnly();
```

O botão "Implantar Firmware" (linhas 366-372) ganha `disabled`:

```jsx
                  <button
                    className="btn-primary"
                    onClick={() => setConfirmOpen(true)}
                    disabled={!canDeploy || readOnly}
                    title={readOnly ? 'Indisponível no modo demonstração' : undefined}
                  >
                    <Cpu size={15} /> Implantar Firmware
                  </button>
```

- [ ] **Step 3: `SettingsPage.jsx` — desabilitar "Salvar Meta"**

Adicionar o import:

```jsx
import { useReadOnly } from '../../hooks/useReadOnly';
```

Dentro do componente (logo após `const { addToast } = useToast();`):

```jsx
  const readOnly = useReadOnly();
```

O botão (linha ~140) vira:

```jsx
          <button className="btn-primary settings-save-btn" onClick={handleSalvarMeta} disabled={salvando || carregando || readOnly} title={readOnly ? 'Indisponível no modo demonstração' : undefined}>
            {salvando ? 'Salvando...' : 'Salvar Meta'}
          </button>
```

- [ ] **Step 4: `ChangelogPage.jsx` — desabilitar os 5 botões de escrita**

Adicionar o import:

```jsx
import { useReadOnly } from '../../hooks/useReadOnly';
```

Dentro do componente (logo no início, junto dos outros hooks/estado):

```jsx
  const readOnly = useReadOnly();
```

Os 5 pontos de escrita (linhas 200, 230, 265-272, 275, 278) passam a ser:

```jsx
        {!readOnly && (
          <button className="btn-primary" onClick={handleOpenCreate}>
            <Plus size={18} /> Nova Entrada
          </button>
        )}
```

```jsx
        <button className="btn-primary" onClick={handleSalvarConfig} disabled={configSaving || configLoading || readOnly} title={readOnly ? 'Indisponível no modo demonstração' : undefined}>
          {configSaving ? 'Salvando...' : 'Salvar Data Oficial'}
        </button>
```

```jsx
                    <button
                      className={`changelog-status-btn ${entry.publicado ? 'publicado' : 'rascunho'}`}
                      onClick={() => handleTogglePublicado(entry)}
                      disabled={readOnly}
                      title={readOnly ? 'Indisponível no modo demonstração' : (entry.publicado ? 'Clique para despublicar (vira rascunho)' : 'Clique para publicar')}
                    >
                      {entry.publicado ? <Eye size={14} /> : <EyeOff size={14} />}
                      {entry.publicado ? 'Publicado' : 'Rascunho'}
                    </button>
```

```jsx
                    <button className="btn-table action-btn" onClick={() => handleOpenEdit(entry)} disabled={readOnly} title={readOnly ? 'Indisponível no modo demonstração' : undefined}>
                      <Edit2 size={16} />
                    </button>
                    <button className="btn-table action-btn danger-btn" onClick={() => requestDelete(entry)} disabled={readOnly} title={readOnly ? 'Indisponível no modo demonstração' : undefined}>
                      <Trash2 size={16} />
                    </button>
```

- [ ] **Step 5: Rodar lint pra pegar imports/vars não usados**

```bash
cd /home/arthjhon/workspace/projects/IoT/projeto-sentinela
npm run lint 2>&1 | tail -20
```

Expected: mesma baseline de 15 problemas pré-existentes (13 erros, 2
warnings) listada em `docs/superpowers/plans/2026-07-20-changelog-publico.md`
— nenhum problema novo nos 4 arquivos tocados aqui. Se aparecer um novo erro
(ex: `readOnly` declarado e não usado em algum arquivo por engano de
posicionamento), corrigir antes de prosseguir.

- [ ] **Step 6: Verificar visualmente no navegador**

Logar com a conta `visualizador` de teste e navegar pelas 4 páginas
(`/admin/sensors`, `/admin/ota`, `/admin/settings`, `/admin/changelog`):
todos os botões listados acima aparecem desabilitados com o tooltip
"Indisponível no modo demonstração". Logar de novo com a conta admin normal
e confirmar que nenhum desses botões mudou de comportamento.

- [ ] **Step 7: Commit**

```bash
git add src/pages/admin/SensorsPage.jsx src/pages/admin/OtaPage.jsx src/pages/admin/SettingsPage.jsx src/pages/admin/ChangelogPage.jsx
git commit -m "feat(demo): desabilita botoes de escrita em Boias/Firmware/Configuracoes/Changelog para role visualizador"
```

---

## Task 5: Verificação E2E, criação da conta demo e documentação

**Files:**
- Modify: `/home/arthjhon/workspace/projects/IoT/implementados.md` (arquivo
  fora do repositório git — edição de texto simples, sem `git add`/`commit`)
- Modify: `projeto-sentinela/README.md` (seção Roadmap)

**Interfaces:**
- Consumes: todo o trabalho das Tasks 1-4.
- Produces: a conta demo em si (dado no banco, não código).

- [ ] **Step 1: Rodar build/lint/testes completos**

```bash
cd /home/arthjhon/workspace/projects/IoT/projeto-sentinela
npx vitest run 2>&1 | tail -12
npm run lint 2>&1 | tail -10
npx vite build 2>&1 | tail -10
```

Expected: 38/38 testes passando, mesma baseline de lint (15 problemas
pré-existentes), build sem erro.

- [ ] **Step 2: Criar a conta demo de verdade no Supabase local (homolog)**

Pelo próprio painel (não script): logar como admin em
`http://172.16.200.22:5173/login`, ir em Operadores → Novo Usuário:
- Nome: `Conta Demonstração`
- Usuário: `demo`
- Nível: Visualizador
- Senha: gerar (Aleatória) ou digitar uma senha temporária

Depois, deslogar e logar como `demo` com a senha temporária — a tela força
trocar a senha (`must_change_password`, comportamento existente, não deste
plano). Definir ali a senha final que será entregue de fato.

- [ ] **Step 3: Roteiro de verificação manual (navegador real, conta demo)**

Logado como `demo`, confirmar cada item:
- Selo "Modo Demonstração" visível no header em toda página
- As 6 páginas (Dashboard, Bóias, Firmware, Configurações, Changelog,
  Operadores) aparecem na sidebar e carregam sem erro
- Em Bóias: botão de calibração desabilitado; "Entrar em Modo Manutenção"
  não aparece (comportamento pré-existente)
- Em Firmware: "Implantar Firmware" desabilitado
- Em Configurações: "Salvar Meta" desabilitado
- Em Changelog: "Nova Entrada" não aparece; "Salvar Data Oficial", toggle de
  publicado, editar e remover aparecem desabilitados
- Em Operadores: "Novo Usuário" não aparece; editar/remover desabilitados;
  aba "Log de Auditoria" abre e mostra o histórico normalmente

- [ ] **Step 4: Atualizar `implementados.md` (fora do repo, edição simples)**

Ler `/home/arthjhon/workspace/projects/IoT/implementados.md` e adicionar ao
final:

```markdown
---

## Conta Demo (Visualizador) — feature nova, fora do backlog original

> Sugerida pelo usuário em 21/08/2026. Design em
> `projeto-sentinela/docs/superpowers/specs/2026-08-21-conta-demo-design.md`,
> plano em `projeto-sentinela/docs/superpowers/plans/2026-08-21-conta-demo.md`.

### Pré-requisito de segurança corrigido antes desta feature

Duas falhas em `public.profiles` foram corrigidas antes da conta demo ser
viável: auto-escalada de role (qualquer autenticado virava admin via API
direta) e edição de operador silenciosamente quebrada (RLS bloqueava sem
avisar). Ver `supabase_profiles_rls_fix.sql`.

### ✅ Aplicado

- RLS de `maintenance_logs`, `sensor_calibrations` e `firmware_deploys`
  apertada para `role IN ('admin', 'operador')` — antes aceitava qualquer
  autenticado (`supabase_visualizador_rls_fix.sql`)
- Navegação (`AdminLayout.jsx`) e acesso de leitura em `/admin/users` abertos
  para `role = 'visualizador'` — antes só admin via essas 4 páginas
- Hook `useReadOnly()` desabilita (nunca esconde) todos os controles de
  escrita nas 6 páginas admin para essa role, com selo "Modo Demonstração"
  visível
- Conta `demo` criada no painel, role Visualizador

### Migration em produção

Rodei `supabase_visualizador_rls_fix.sql` só no Supabase local. Antes de
considerar em produção, execute o mesmo arquivo no SQL Editor de lá — é
idempotente.
```

- [ ] **Step 5: Atualizar o Roadmap do `README.md`**

Em `projeto-sentinela/README.md`, seção `### Concluído` do Roadmap,
adicionar ao final da lista:

```markdown
- [x] **Conta demo somente leitura** (role `visualizador`) — navega o painel
      admin completo sem conseguir alterar nada, protegido por RLS
```

- [ ] **Step 6: Commit final**

```bash
cd /home/arthjhon/workspace/projects/IoT/projeto-sentinela
git add README.md
git commit -m "docs(demo): atualiza README (roadmap) apos a feature de conta demo"
```

`implementados.md` fica de fora deste commit — vive em
`/home/arthjhon/workspace/projects/IoT/` (raiz sem `.git`), edição de texto
simples, sem `git add`/`commit` nele.
