# Infra — Sentinela

## Stack de dados na VM — runbook

Fluxo do deploy (spec §7.7):

```text
CI (main) --rsync, chave 1 (rrsync -wo)--> /srv/sentinela/stack-incoming/   (dono: sentinela-deploy)
CI (main) --ssh, chave 2 (forced command)--> sudo /usr/local/sbin/stack-deploy.sh <sha|none>   (root)
stack-deploy.sh: confere o incoming -> copia para staging root -> checagem textual do compose
  -> render único (docker compose config) -> política do deploy + validate-compose.sh
  -> pull -> releases/<id> -> current aponta para ele -> up -> healthchecks
  -> DEPLOYED, .previous <- .current antigo, .current <- release nova
  -> remove tags locais do worker que nenhuma release (current/.current/.previous) usa
  (falhou -> current volta ao .current, revalidado, e sobe de novo)
```

Layout em `/srv/sentinela/stack/` (root 750; só o root escreve):

```text
.env                          root 600; nunca tocado pelo script
releases/<UTC>-<pid>/         uma por tentativa: compose.yml, telegraf/telegraf.conf,
                              mosquitto/mosquitto.conf, mosquitto/acl, rendered.json (JSON validado, 600), DEPLOYED (só se ficou saudável)
current  -> releases/<id>     o que foi iniciado por último
.current -> releases/<id>     último bom conhecido: só muda depois do healthcheck
.previous -> releases/<id>    o último bom antes desse
compose.yml -> current/compose.yml   telegraf -> current/telegraf   mosquitto -> current/mosquitto
DEPLOYED -> .current/DEPLOYED
```

Toda troca é o `rename` de um symlink (atômico): `compose.yml`, `telegraf.conf` e os arquivos do
mosquitto mudam juntos, e uma
queda em qualquer ponto deixa `.current`/`DEPLOYED` numa release que estava saudável. O deploy
seguinte avisa (`an earlier deploy did not finish`) e segue normalmente. Releases sem ponteiro são
apagadas. O script ignora SIGPIPE/SIGHUP e erros de escrita no stdout: a queda da sessão SSH do CI
não interrompe o deploy no meio.

O CI envia **exatamente** quatro arquivos: `compose.yml`, `telegraf/telegraf.conf`,
`mosquitto/mosquitto.conf` e `mosquitto/acl`. Qualquer outro
arquivo, symlink, hardlink, fifo, device, socket ou setuid no incoming recusa o deploy inteiro. O
validador e a lista de imagens **não** vêm do CI: são instalados à mão (passo 3). Acrescentar um
arquivo novo ao conjunto exige editar `EXPECTED_FILES` em `stack-deploy.sh` e reinstalar o script.

Comandos abaixo rodam na VM, a partir de um checkout do commit revisado da `main` (os caminhos
`infra/...` são relativos à raiz do repo). Nada aqui é feito pelo CI.

### 0. Pré-requisitos (conferir antes)

```bash
docker compose version
docker compose config --help | grep -- --no-env-resolution   # ver "Render e env_file" abaixo
sudo --version | head -1        # >= 1.9.10 (regex no sudoers); Debian 12 = 1.9.13p3
command -v jq rrsync setpriv flock
sysctl fs.protected_hardlinks fs.protected_symlinks          # ambos = 1
docker volume ls | grep sentinela-influxdb                  # ver nota do passo 11
docker ps --format '{{.Names}}' | grep -x supabase-db        # nome usado no DSN (passo 9)
```

**Render e `env_file`.** `docker compose config` resolve `env_file`, `label_file`, `include` e
`extends` lendo arquivos do host **como root**, e o `env_file` resolvido some do JSON (o conteúdo
vira `environment`, invisível ao validador). Por isso o `stack-deploy.sh` faz, sempre, uma checagem
textual estrita do `compose.yml` antes de qualquer render: só ASCII imprimível, sem `\` (escapes
YAML), sem `!` (tags YAML como `!!binary`) e sem as palavras `env_file`, `label_file`, `include`,
`extends` (nem em comentário). Se o compose instalado suporta `config --no-env-resolution`
(o script detecta e registra `no-env-resolution=1` no log), o render usa a flag, e um `env_file`
que passasse sobreviveria como chave e seria negado pela política. Sem a flag, a checagem textual é
a única barreira — por isso ela é estrita.

### 1. Usuário de deploy

```bash
sudo adduser --system --group --home /var/lib/sentinela-deploy --shell /bin/sh sentinela-deploy
sudo install -d -o root -g root -m 755 /var/lib/sentinela-deploy /var/lib/sentinela-deploy/.ssh
id sentinela-deploy        # NÃO pode estar no grupo docker
```

Shell `/bin/sh` é necessário para o forced command. `~/.ssh` fica com dono root: o próprio usuário
não consegue reescrever suas chaves.

### 2. Diretórios

```bash
stat -c '%U %a' /srv/sentinela        # root, sem escrita para grupo/outros
sudo install -d -o sentinela-deploy -g sentinela-deploy -m 750 /srv/sentinela/stack-incoming
sudo install -d -o root -g root -m 750 /srv/sentinela/stack
sudo install -d -o root -g root -m 700 /srv/sentinela/backups /srv/sentinela/backups/influx
sudo install -d -o root -g root -m 755 /usr/local/etc/sentinela
```

`sentinela-deploy` precisa atravessar `/srv/sentinela` (permissão `x` para outros, ou grupo).

### 3. Scripts, validador e lista de imagens (instalação e atualização)

```bash
sudo install -o root -g root -m 755 infra/bin/stack-deploy.sh     /usr/local/sbin/stack-deploy.sh
sudo install -o root -g root -m 755 infra/bin/validate-compose.sh /usr/local/sbin/validate-compose.sh
sudo install -o root -g root -m 755 infra/bin/influx-bootstrap.sh /usr/local/sbin/influx-bootstrap.sh
sudo install -o root -g root -m 755 infra/bin/influx-backup.sh    /usr/local/sbin/influx-backup.sh
sudo install -o root -g root -m 644 infra/stack/allowed-images    /usr/local/etc/sentinela/allowed-images
```

**Atualizar** (mudança no validador, na lista de imagens ou no script de deploy): sempre à mão,
depois de revisar o diff do commit na `main`:

```bash
git fetch origin && git log -p origin/main -- infra/bin/validate-compose.sh infra/stack/allowed-images infra/bin/stack-deploy.sh
diff -u /usr/local/sbin/validate-compose.sh infra/bin/validate-compose.sh
diff -u /usr/local/etc/sentinela/allowed-images infra/stack/allowed-images
diff -u /usr/local/sbin/stack-deploy.sh infra/bin/stack-deploy.sh
# então os mesmos `install` acima; conferir:
sha256sum /usr/local/sbin/validate-compose.sh; git show origin/main:infra/bin/validate-compose.sh | sha256sum
```

O script recusa rodar se o validador, a lista, `/srv/sentinela`, `/srv/sentinela/stack` ou o
`.env` forem symlink, não forem do root ou forem graváveis por grupo/outros (`.env`: exatamente 600). Se uma regra nova do validador recusar o compose em produção, o
deploy falha antes de tocar no que está rodando.

### 4. sudoers

```bash
sudo visudo -f /etc/sudoers.d/sentinela-deploy
```

```text
sentinela-deploy ALL=(root) NOPASSWD: /usr/local/sbin/stack-deploy.sh ^(none|[0-9a-f]{40})$
```

O regex (sudo >= 1.9.10) restringe o argumento já no sudo; o script valida de novo. Testado em
Debian 12 (sudo 1.9.13p3): `none` e 40-hex passam; `none none`, `*`, `none;id`, 41 caracteres
pedem senha (negado). `sudo` limpa o ambiente (`env_reset`), então `SENTINELA_DEPLOY_ROOT` (só para
teste local) nunca chega ao script; mesmo como root ele é ignorado.

### 5. Chaves SSH do CI (`/var/lib/sentinela-deploy/.ssh/authorized_keys`)

Dois pares ed25519 distintos, gerados fora da VM (privadas vão para os secrets
`SSH_KEY_UMJ_STACK_RSYNC` e `SSH_KEY_UMJ_STACK_DEPLOY` **do environment `production`**, passo 6b,
nunca como secrets do repositório):

```text
restrict,from="100.64.0.0/10",command="/usr/bin/rrsync -wo /srv/sentinela/stack-incoming" ssh-ed25519 AAAA... ci-stack-rsync
restrict,from="100.64.0.0/10",command="exec sudo -n /usr/local/sbin/stack-deploy.sh \"$SSH_ORIGINAL_COMMAND\"" ssh-ed25519 AAAA... ci-stack-deploy
```

```bash
sudo install -o root -g root -m 644 authorized_keys /var/lib/sentinela-deploy/.ssh/authorized_keys
```

- `"$SSH_ORIGINAL_COMMAND"` entre aspas: vira **um** argumento, sem word splitting nem glob do shell.
- `from="100.64.0.0/10"`: só endereços Tailscale (CGNAT). Quem de fato pode chegar aqui é
  limitado pela ACL do tailnet para a tag do CI (passo 6b).
- Verificado em container Debian 12 (OpenSSH 9.2, sudo 1.9.13p3; sem o `from=`, por ser local): a
  chave 1 só escreve no incoming (leitura e shell recusados pelo rrsync); a chave 2 só executa o
  script, com `none`/40-hex; `none none`, `*`, `none;id` e `$(id)` são negados pelo sudo.
- O CI deve enviar com `rsync -r --delete` um diretório contendo só os quatro arquivos.

### 6. Chave de host da VM no CI (`UMJ_KNOWN_HOSTS`)

Fingerprint esperado: `SHA256:ZlLsGy9vi17ADaGxXlrE8THwoYtjGz3wzHQ/c3dF/xc`.

1. **Na VM** (sessão já confiável), listar os fingerprints das chaves de host:
   ```bash
   for k in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$k"; done
   ```
   O fingerprint esperado tem de aparecer aqui. Se não aparecer, parar.
2. **Numa máquina do tailnet**, coletar e conferir:
   ```bash
   ssh-keyscan -t ed25519,ecdsa,rsa 100.120.149.19 2>/dev/null > umj_known_hosts
   ssh-keygen -lf umj_known_hosts
   ```
   `ssh-keyscan` não autentica nada: só seguir se a linha do mesmo tipo mostrar exatamente o
   fingerprint visto no passo 1. Em caso de diferença, não criar o secret.
3. Criar o secret **no environment `production`** (passo 6b) e apagar o arquivo local:
   ```bash
   gh secret set UMJ_KNOWN_HOSTS --env production --repo arthjhon/projeto-sentinela < umj_known_hosts && rm umj_known_hosts
   ```

### 6b. Environment `production` no GitHub (segredos do deploy) — ANTES do merge

**Fazer este passo (e o 12) antes de mergear a branch na `main`.** O merge dispara o
`stack.yml` na `main`; sem o environment, o job `deploy` falha (ou, pior, roda com secrets de
repositório antigos).

Secret de repositório é entregue a workflow de **qualquer** branch (um push em branch qualquer
com um workflow novo lê a chave de deploy). Secret de environment só vai para job que declara
`environment: production`, e o environment só aceita a `main` e exige aprovação do Arthur.

```bash
R=arthjhon/projeto-sentinela
ARTHUR_ID=$(gh api users/arthjhon --jq .id)
gh api -X PUT "repos/$R/environments/production" --input - <<JSON
{
  "wait_timer": 0,
  "prevent_self_review": false,
  "reviewers": [ { "type": "User", "id": $ARTHUR_ID } ],
  "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true }
}
JSON
gh api -X POST "repos/$R/environments/production/deployment-branch-policies" -f name=main -f type=branch
gh api "repos/$R/environments/production" --jq '{reviewers: [.protection_rules[]? | select(.type=="required_reviewers") | .reviewers[].reviewer.login], branch_policy: .deployment_branch_policy}'
gh api "repos/$R/environments/production/deployment-branch-policies" --jq '[.branch_policies[].name]'   # ["main"]

gh secret set SSH_KEY_UMJ_STACK_RSYNC  --env production --repo "$R" < ci-stack-rsync      # chave privada
gh secret set SSH_KEY_UMJ_STACK_DEPLOY --env production --repo "$R" < ci-stack-deploy
gh secret set UMJ_KNOWN_HOSTS          --env production --repo "$R" < umj_known_hosts    # passo 6
gh secret list --env production --repo "$R"
gh secret list --repo "$R"        # nenhum destes nomes pode aparecer aqui (apagar com gh secret delete)
shred -u ci-stack-rsync ci-stack-deploy
```

- `prevent_self_review: false`: o Arthur aprova o próprio deploy (projeto de uma pessoa).
- Revisor obrigatório em environment exige repositório público ou plano pago (Pro/Team) em
  repositório privado; conferir `gh repo view "$R" --json visibility`. Sem isso, a restrição de
  branch continua valendo, mas a aprovação manual não.
- Os workflows referenciam `environment: production` no job de deploy. Ao migrar o `deploy.yml`,
  mover também `TAILSCALE_AUTHKEY` e `SSH_KEY_UMJ_RSYNC` para o environment e apagar as versões de
  repositório.

**`TAILSCALE_AUTHKEY` (obrigatório): efêmera, com tag, e ACL só para a VM.** O runner do CI entra
no tailnet com essa chave; sem restrição, quem a obtiver vira um nó com acesso a tudo o que o
tailnet alcança.

1. Na policy do tailnet (Admin console → Access controls), criar a tag e limitar o que ela alcança.
   A regra abaixo é a **única** que pode casar com a tag (se a policy ainda tiver a regra padrão
   "todos → todos", substituí-la antes, senão ela continua liberando tudo):
   ```jsonc
   "tagOwners": { "tag:ci-sentinela": ["autogroup:admin"] },
   "grants": [
     { "src": ["tag:ci-sentinela"], "dst": ["100.120.149.19"], "ip": ["tcp:22"] }
   ]
   ```
   (Equivalente em `acls`: `{"action": "accept", "src": ["tag:ci-sentinela"], "dst": ["100.120.149.19:22"]}`.)
2. Gerar a chave (Settings → Keys → Generate auth key): **Ephemeral** (o nó some quando o job
   termina), **Reusable** (um uso por job), **Pre-approved**, **Tags: `tag:ci-sentinela`**, validade
   curta (≤ 90 dias; rotação no passo 18). Alternativa sem expiração: OAuth client com escopo
   `devices:core` restrito à mesma tag (a action aceita `oauth-client-id`/`oauth-secret`/`tags`).
3. `gh secret set TAILSCALE_AUTHKEY --env production --repo "$R"` (colar sem eco).
4. Conferir: num job de teste, o nó aparece com a tag e expira sozinho; `tailscale ping` para
   qualquer outro nó do tailnet falha.

- O `from=` do `authorized_keys` (passo 5) continua `100.64.0.0/10`: nós efêmeros recebem um
  endereço qualquer da faixa do tailnet a cada job, então não há endereço fixo para fixar. A
  restrição efetiva é a ACL acima (só a tag do CI chega à 22 da VM) somada ao par de chaves
  restritas. Se o tailnet tiver IP pool por tag, estreitar o `from=` para esse pool.

### Ordem do primeiro deploy (visão geral)

Os passos 7 a 15 são feitos **nesta ordem**, uma vez. A branch entra na `main` num merge só (stack,
worker e migration juntos), então tudo o que o worker precisa tem de existir antes do primeiro
deploy dele:

0. **Antes do merge na `main`** (o site deploya sozinho no push): aplicar
   `supabase/migrations/20261118_system_status.sql` em produção (passo 9).
1. Pré-requisitos do worker: rede `sentinela-pg` + override do Supabase (passo 7), acesso ao GHCR
   (passo 8).
2. Migration, role `sentinela_worker` e `PG_WORKER_DSN` (passo 9).
3. `.env` com `SUPABASE_NETWORK=sentinela-pg` e tokens Influx placeholder **não vazios** (passo 10).
4. Primeiro deploy **com um sha de 40 hex cuja imagem já está no GHCR**: o deploy aprovado do CI
   depois do merge, ou `stack-deploy.sh <sha>` à mão. Nunca `none` (sem tag implantada, o script
   recusa `none` e aponta para cá) (passo 11). Verificar o isolamento do worker (passo 11b).
5. `influx-bootstrap.sh`, tokens reais no `.env`, `stack-deploy.sh none` (passo 12).
6. Backfill (passo 13), nginx (passo 14), backup (passo 15).

### 7. Rede `sentinela-pg` (só o `supabase-db` e o worker)

O worker **não** entra na `supabase_default`. Lá o `postgres-meta` (`meta:8080`) aceita SQL sem
autenticação e executa como `supabase_admin` (superuser): reproduzido localmente, de um container
com a mesma postura do worker (`cap_drop: ALL`, `read_only`), `POST http://meta:8080/query`
devolveu `current_user=supabase_admin, super=true`; Kong e Studio também respondem. Por isso o
worker usa uma rede própria, **interna** (sem saída para fora do host), da qual só o `supabase-db`
participa. A saída para a internet do worker (Open-Meteo, ANA) é a rede `default` da stack.

1. Criar a rede (uma vez):
   ```bash
   sudo docker network create --internal sentinela-pg
   sudo docker network inspect sentinela-pg -f 'internal={{.Internal}}'    # internal=true
   ```
2. Persistir no compose do Supabase (diretório do Supabase na VM; se já existir um
   `docker-compose.override.yml`, acrescentar as chaves a ele):
   ```yaml
   # docker-compose.override.yml (Supabase): o db também entra na rede do worker do Sentinela
   services:
     db:
       networks:
         - default
         - sentinela-pg
   networks:
     sentinela-pg:
       external: true
   ```
   Conferir antes de aplicar: `sudo docker compose config | grep -n -A3 'sentinela-pg'` (no
   diretório do Supabase) mostra a rede só no serviço `db`.
3. Ligar o container que está rodando sem recriá-lo (sem downtime):
   ```bash
   sudo docker network connect sentinela-pg supabase-db
   sudo docker network inspect sentinela-pg -f '{{range .Containers}}{{.Name}} {{end}}'   # supabase-db
   ```
   O override garante que o próximo `docker compose up -d` do Supabase (que recria o `db` por
   mudança de configuração: fazer em janela de manutenção, com backup) já suba o `db` nas duas
   redes.

- Nenhum outro container do Supabase entra nessa rede. Conferir depois de cada atualização do
  Supabase (`network inspect` acima: só `supabase-db` e `sentinela-stack-worker-1`).
- O DSN do worker usa o host `supabase-db` (nome do container, resolvido em qualquer rede
  definida pelo usuário; o alias `db` só existe quando o próprio compose do Supabase liga a rede,
  então não usar `db`). Validado localmente: numa rede `--internal` com um Postgres descartável nas duas redes,
  um container nas redes `default` + interna resolve e conecta no Postgres, não resolve nem alcança
  (nem por IP) um serviço que está só na rede padrão do Supabase, e a rota padrão sai pela rede
  `default` (egress preservado).
- `pg_hba` do Supabase: a faixa da `sentinela-pg` (172.16.0.0/12 ou 192.168.0.0/16, conforme o
  daemon) tem de estar coberta por uma linha `scram-sha-256` (o padrão do Supabase cobre); nunca
  `trust`.
- Rollback: `sudo docker network disconnect sentinela-pg supabase-db`, remover as chaves do
  override, `sudo docker network rm sentinela-pg` (com o worker parado).

### 8. Acesso ao GHCR (pull da imagem do worker)

Pacote público dispensa credencial (preferível; a imagem não contém segredo). Conferir:
`sudo docker pull ghcr.io/arthjhon/sentinela-worker:<sha>` depois que o CI publicar.

Se for privado, `docker login ghcr.io` como root com um token **só de leitura de pacotes** e com
validade: fine-grained PAT com permissão Packages: read, se o GHCR já aceitar fine-grained na data
da instalação (até a redação deste runbook o registry exigia PAT clássico); senão PAT clássico com
o escopo único `read:packages`. Entrar sem eco nem histórico:

```bash
read -rs T; printf '%s' "$T" | sudo docker login ghcr.io -u arthjhon --password-stdin; unset T
```

O token fica em base64 (não cifrado) em `/root/.docker/config.json`: usar um credential helper
(`docker-credential-pass`) ou, no mínimo, validade curta e rotação periódica (passo 18).

Disco: cada deploy com sha novo baixa só a camada pequena do código (a camada de dependências só
muda com `worker/requirements.lock`). Depois de um deploy bem-sucedido, o `stack-deploy.sh` apaga
as tags locais de `ghcr.io/arthjhon/sentinela-worker` que nenhuma release em
`current`/`.current`/`.previous` usa (`docker rmi` sem `-f`; nunca outro repositório, nunca prune
global). Falha nessa limpeza só gera log, não falha o deploy.

### 9. Migration e role `sentinela_worker` (`PG_WORKER_DSN`)

A migration `supabase/migrations/20261117_sensor_health.sql` cria as tabelas `sensor_health`,
`sensor_health_events`, `worker_jobs`, o role `sentinela_worker` (NOLOGIN, sem BYPASSRLS, sem
ownership) e as policies de RLS. É idempotente: pode ser reexecutada.

Na VM o Postgres roda no container `supabase-db`; `psql` do host sem `-h` procura um socket que não
existe. Tudo abaixo passa por `docker exec` no container.

1. Aplicar como `postgres`, em transação única e abortando no primeiro erro (o arquivo entra pelo
   stdin; nada é copiado para o container):

   ```bash
   sudo docker exec -i supabase-db psql -U postgres -1 -v ON_ERROR_STOP=1 \
     < supabase/migrations/20261117_sensor_health.sql
   ```

   Aplicar também `supabase/migrations/20261118_system_status.sql` do mesmo jeito (tabela
   `system_status` da página de status; depende do role criado acima e é idempotente).

   **Aplicar `20261118_system_status.sql` em produção ANTES do merge na `main`**: o site faz deploy
   automático a cada push na `main`, e sem a tabela a página e o selo de status mostram
   "tabela system_status ausente — migration pendente?" (selo Degradado em toda rota admin) até a
   migration ser aplicada.

   Impacto: cria objetos novos, revoga escrita de `anon`/`authenticated` nas 3 tabelas novas e
   adiciona uma policy de SELECT e um GRANT SELECT para `sentinela_worker` em `app_settings` e
   `maintenance_logs` (tabelas existentes; nenhuma permissão de outros roles é removida delas).
   Rollback (no Supabase o `postgres` não é superuser; sem o primeiro comando o `DROP OWNED`
   falha com `permission denied` e o `DROP ROLE` também):

   ```sql
   GRANT sentinela_worker TO postgres;
   DROP TABLE public.sensor_health, public.sensor_health_events, public.worker_jobs;
   DROP TABLE IF EXISTS public.system_status;   -- página de status (20261118_system_status.sql)
   DROP OWNED BY sentinela_worker;   -- remove também policies e grants em app_settings/maintenance_logs
   DROP ROLE sentinela_worker;
   ```

2. Senha e DSN. A senha nunca passa por SQL literal (`ALTER ROLE ... PASSWORD '<literal>'` cai em
   texto claro no log do Postgres com `log_statement=ddl` e no `pg_stat_statements`), nem por argv
   (aparece em `ps` e no `COMMAND=` do sudo em `auth.log`), nem por clipboard (VM sem interface
   gráfica). Num shell root (`sudo -i`), num terminal que não é gravado:

   ```bash
   umask 077
   PW="$(openssl rand -hex 32)"
   docker exec supabase-db psql -U postgres -c 'ALTER ROLE sentinela_worker WITH LOGIN'
   # Grava/substitui PG_WORKER_DSN no .env (cria com 600 se não existir). printf é builtin:
   # o segredo vai por pipe, nunca por argv; linhas PG_WORKER_DSN antigas são removidas.
   F=/srv/sentinela/stack/.env; [ -e "$F" ] || install -m 600 /dev/null "$F"
   { grep -v '^PG_WORKER_DSN=' "$F"
     printf "PG_WORKER_DSN='postgresql://sentinela_worker:%s@supabase-db:5432/postgres'\n" "$PW"
   } > "$F.new" && chmod 600 "$F.new" && mv -f "$F.new" "$F"
   grep -c '^PG_WORKER_DSN=' "$F"                       # 1
   printf '%s\n' "$PW"      # mostrado UMA vez, só para colar no prompt abaixo; limpar a tela depois
   docker exec -it supabase-db psql -U postgres -c '\password sentinela_worker'   # colar 2x
   unset PW; clear
   ```

   `\password` envia só o hash SCRAM. A senha é hex (sem caracteres que precisem de escape no DSN).
   Para trocar a senha depois, repetir o bloco (o `.env` é substituído, não duplicado) e
   `stack-deploy.sh none`.
3. Verificar (de dentro do container do banco, sem senha no argv):

   ```bash
   sudo docker exec -it supabase-db psql -U sentinela_worker -h 127.0.0.1 -d postgres \
     -c 'SELECT count(*) FROM app_settings' -c 'UPDATE app_settings SET id = id WHERE false'
   ```
   Pede a senha (colar); o `SELECT` funciona e o `UPDATE` falha com `permission denied`. (Se o
   `pg_hba` do container tiver `trust` para 127.0.0.1, não pede senha: o teste da senha real é o
   worker conectando pela `sentinela-pg` no passo 11b.)

**Risco residual aceito: privilégios herdados via PUBLIC.** Todo role herda de `PUBLIC`: EXECUTE
em `net.http_get/post/delete` (extensão gerenciada `pg_net`), arwdDxt em `net.http_request_queue` e
`net._http_response`, e TEMP/CONNECT no banco. A migration não mexe na extensão gerenciada. Motivo:
o container do worker já tem egress de rede próprio, então o `pg_net` acrescenta pouco; alterar
objetos da extensão arrisca quebrar o Supabase. Se o dono quiser fechar (opcional, avançado;
testar em staging antes):

```sql
-- Conectar como supabase_admin: os grants em net.* pertencem a ele; como `postgres` os REVOKE
-- abaixo retornam "no privileges could be revoked" e nada muda.

-- 1) Descobrir se pg_net está em uso (qualquer resultado = em uso; não prosseguir sem revisar):
SELECT extname FROM pg_extension WHERE extname = 'pg_net';
SELECT tgrelid::regclass, tgname FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
 WHERE p.proname = 'http_request';                                    -- Database Webhooks
SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE p.prosrc ILIKE '%net.http\_%' AND n.nspname NOT IN ('net', 'pg_catalog');  -- funções
SELECT jobid, jobname FROM cron.job WHERE command ILIKE '%net.http\_%';  -- só se pg_cron existir

-- 2) As funções net.http_* NÃO são SECURITY DEFINER: quem as chama precisa de direitos nas tabelas.
--    Revogar do PUBLIC e re-conceder aos roles do Supabase:
REVOKE EXECUTE ON FUNCTION net.http_get, net.http_post, net.http_delete FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION net.http_get, net.http_post, net.http_delete
  TO postgres, service_role, supabase_functions_admin;
REVOKE ALL ON net.http_request_queue, net._http_response FROM PUBLIC;
GRANT  SELECT, INSERT, UPDATE, DELETE ON net.http_request_queue, net._http_response
  TO postgres, service_role, supabase_functions_admin;
GRANT  USAGE ON ALL SEQUENCES IN SCHEMA net TO postgres, service_role, supabase_functions_admin;

-- 3) TEMP no banco vem do PUBLIC (revogar do role é inerte). Opcional:
REVOKE TEMP ON DATABASE postgres FROM PUBLIC;
GRANT  TEMP ON DATABASE postgres TO postgres, supabase_admin, authenticated, anon, service_role;
-- CONNECT continua necessário para o worker.
```

Reverter = `GRANT ... TO PUBLIC` dos mesmos objetos (como `supabase_admin`).

### 10. `.env` da stack

```bash
sudo test -e /srv/sentinela/stack/.env || sudo install -o root -g root -m 600 /dev/null /srv/sentinela/stack/.env
sudoedit /srv/sentinela/stack/.env      # nomes em infra/stack/.env.example
```

- Segredos novos: `openssl rand -hex 32`.
- Valor com `$`: entre aspas simples (`KEY='a$b'`), senão o compose interpola.
- Proibido: linhas `COMPOSE_*` e `DOCKER_*` (o script recusa). `WORKER_TAG` não vai no `.env`: o
  script sempre exporta a tag do argumento (ou a implantada, com `none`), e ela tem precedência.
- `SUPABASE_NETWORK=sentinela-pg` (passo 7). Nunca `supabase_default`.
- `PG_WORKER_DSN`: já gravado no passo 9; não copiar a linha vazia do `.env.example` por cima
  (`sudo grep -c '^PG_WORKER_DSN=' /srv/sentinela/stack/.env` tem de dar 1).
- `INFLUX_TELEGRAF_TOKEN` e `INFLUX_WORKER_TOKEN`: placeholders **não vazios** até o passo 12 (ex.
  `pendente-bootstrap`). O compose exige as variáveis (`:?`); com o placeholder a stack sobe, o
  Telegraf e os jobs do worker recebem 401 do InfluxDB e só registram falha (nada é gravado errado,
  o healthcheck do worker continua ok), até o token real entrar no passo 12.
- O stdout do script (que o CI vê) não traz nada derivado do compose renderizado nem das
  mensagens do validador/política: só rótulos fixos, contagens (`validator: denied (N
  violation(s))`, `policy: denied (N violation(s))`), nomes de serviço da lista fixa (`influxdb`,
  `telegraf`, `worker`) e nomes de arquivo do incoming. As mensagens completas (que podem conter
  valores do `.env`) e a saída do compose vão só para o log do host
  (`/var/log/sentinela-stack-deploy.log`, root 600), sem máscara. O validador escapa caracteres de
  controle (`\n` vira o texto `\n`), então cada violação ocupa uma linha só no log.

### 11. Primeiro deploy (com sha)

Nota: se `sentinela-influxdb-data` já existir na VM (dados antigos), o InfluxDB ignora os
`DOCKER_INFLUXDB_INIT_*` e o `INFLUX_ADMIN_TOKEN` do `.env` tem de ser o token admin já existente.

O compose tem o worker, então o primeiro deploy precisa de uma tag: o sha (40 hex) de um commit da
`main` cuja imagem o CI já publicou no GHCR. `none` só mantém uma tag já implantada; sem
`DEPLOYED`, o script recusa `none` com `no worker tag deployed ... (runbook: infra/README.md,
"Primeiro deploy")` antes de qualquer render.

- **Caminho normal**: mergear na `main` (passos 6b e 16 feitos); o `stack.yml` testa, publica a
  imagem `ghcr.io/arthjhon/sentinela-worker:<sha>` e o job `deploy` (aprovação do Arthur) roda
  `stack-deploy.sh <sha>`.
- **À mão** (ex.: o deploy do CI falhou por pré-requisito e já foi corrigido), com o sha da imagem
  publicada:
  ```bash
  SHA=<40 hex do commit da main>
  sudo docker pull "ghcr.io/arthjhon/sentinela-worker:$SHA"        # confere o GHCR (passo 8)
  git show "$SHA:infra/stack/compose.yml" | sudo -u sentinela-deploy tee /srv/sentinela/stack-incoming/compose.yml >/dev/null
  sudo -u sentinela-deploy install -d -m 755 /srv/sentinela/stack-incoming/telegraf
  git show "$SHA:infra/stack/telegraf/telegraf.conf" | sudo -u sentinela-deploy tee /srv/sentinela/stack-incoming/telegraf/telegraf.conf >/dev/null
  sudo -u sentinela-deploy install -d -m 755 /srv/sentinela/stack-incoming/mosquitto
  for f in mosquitto.conf acl; do
    git show "$SHA:infra/stack/mosquitto/$f" | sudo -u sentinela-deploy tee "/srv/sentinela/stack-incoming/mosquitto/$f" >/dev/null
  done
  sudo /usr/local/sbin/stack-deploy.sh "$SHA"
  sudo cat /srv/sentinela/stack/DEPLOYED
  sudo tail -n 50 /var/log/sentinela-stack-deploy.log
  ```

Saída 0 = implantado; 1 = negado (nada mudou) ou falhou (rollback tentado); 2 = argumento inválido.
O log (`/var/log/sentinela-stack-deploy.log`, root 600) guarda a saída do compose e as mensagens
completas do validador; o stdout (que o CI vê) só traz passos e a contagem de violações. Para
ver o motivo de um `denied`: `sudo grep -E 'validate\||policy DENY' /var/log/sentinela-stack-deploy.log | tail`.

### 11b. Verificar o isolamento do worker (obrigatório)

Do container do worker, só o Postgres do Supabase pode responder; `meta` (postgres-meta), `kong` e
`studio` não podem nem resolver:

```bash
W=$(sudo docker ps -q --filter label=com.docker.compose.project=sentinela-stack --filter label=com.docker.compose.service=worker)
sudo docker exec -i "$W" python - <<'PY'
import socket
for host, port in (("supabase-db", 5432), ("meta", 8080), ("kong", 8000), ("studio", 3000),
                   ("supabase-meta", 8080), ("supabase-kong", 8000), ("supabase-studio", 3000)):
    try:
        socket.create_connection((host, port), timeout=3).close()
        r = "ALCANCAVEL"
    except OSError as e:
        r = f"bloqueado ({type(e).__name__})"
    print(f"{host}:{port} {r}")
PY
```

Esperado: `supabase-db:5432 ALCANCAVEL` e todas as outras linhas `bloqueado`. Também por IP (sem
DNS), com o IP do Kong na rede do Supabase:

```bash
K=$(sudo docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' supabase-kong); echo "$K"
sudo docker exec -i "$W" python - $K <<'PY'
import socket, sys
for ip in sys.argv[1:]:
    s = socket.socket(); s.settimeout(3)
    rc = s.connect_ex((ip, 8000)); s.close()
    print(ip, "ALCANCAVEL" if rc == 0 else f"bloqueado (errno {rc})")
PY
```

Esperado: `bloqueado` (timeout ou sem rota), nunca `ALCANCAVEL`. (Portas que o host publica em
`0.0.0.0`, como o Kong `:8000` com autenticação, continuam alcançáveis pelo IP do host, como de
qualquer máquina da LAN; o que fica fora é o tráfego direto entre as redes docker.) E a rede só tem os dois:
`sudo docker network inspect sentinela-pg -f '{{range .Containers}}{{.Name}} {{end}}'` →
`supabase-db sentinela-stack-worker-1`. Se qualquer item falhar, parar o worker
(`sudo docker stop "$W"`) e revisar o passo 7.

Conferir também que o worker fala com o banco com o DSN real: `sudo docker logs --since 10m "$W" 2>&1 | grep -E '"detector"' | tail -3`
(o job do detector registra `job ok`, ou falha de Influx 401 enquanto o token for placeholder,
nunca erro de conexão/autenticação no Postgres).

### 12. Buckets e tokens (`influx-bootstrap.sh`)

```bash
sudo /usr/local/sbin/influx-bootstrap.sh
```

Idempotente: cria `externos` e `qualidade` (retenção infinita) e os tokens que faltam; um token
novo é impresso **uma vez**, entre `===== NEW TOKEN '<nome>' ... =====`, com o destino; token
existente nunca é impresso. O token admin vem do `.env` (ou `INFLUX_ADMIN_TOKEN`, ou prompt sem
eco) e entra no container por `docker exec -e INFLUX_TOKEN`, nunca na linha de comando.

| Token | Permissão | Destino |
| --- | --- | --- |
| `telegraf` | write `iot` | `INFLUX_TELEGRAF_TOKEN` no `.env` |
| `worker` | read `iot`; write `externos`, `qualidade` | `INFLUX_WORKER_TOKEN` no `.env` |
| `nginx-publico` | read `iot` | `/etc/nginx/sentinela-influx-token.conf` (só se o proxy for ativado, passo 14b) |
| `backup` | operator (exigido por `influx backup`) | `/usr/local/etc/sentinela/influx-backup.token` |

```bash
sudoedit /srv/sentinela/stack/.env                     # telegraf e worker (substituir os placeholders)
sudo /usr/local/sbin/stack-deploy.sh none              # mantém a tag implantada; recria com os tokens novos
sudo docker logs --since 2m sentinela-stack-telegraf-1 2>&1 | grep -iE 'error|401' || echo ok
sudo docker logs --since 5m sentinela-stack-worker-1 2>&1 | grep -E '"job (ok|failed)' | tail -5
```

O token `backup` é de operador (mesmo poder do admin) e existe só para poder ser revogado sem
mexer no admin; fica apenas no arquivo do timer.

### 13. Backfill (spec, objetivo 5)

Uma vez, depois do passo 12 (precisa do token real do worker). Roda num container **avulso**
(`docker run --rm`) com a imagem implantada, na rede `default` da stack (alcança o InfluxDB, não a
`sentinela-pg`), limitado a 384 MiB, um comando por vez. Não usar `docker compose exec` (o projeto é
`sentinela-stack` com o JSON renderizado) nem rodar dentro do worker vivo (somaria ao uso de
memória dele dentro do mesmo limite de 384 MiB: risco de OOM no detector).

O ambiente vem do JSON validado da release atual, sem imprimir segredo: só `INFLUX_URL`,
`INFLUX_ORG` e `INFLUX_WORKER_TOKEN` vão para um env-file root 600 em tmpfs; o backfill não usa o
Postgres, então `PG_WORKER_DSN` recebe um valor inerte (o real não entra no container avulso). O
JSON escapa `$` como `$$`; o `gsub` desfaz isso.

```bash
sudo -i
R=/srv/sentinela/stack/.current/rendered.json
IMG=$(jq -r '.services.worker.image' "$R"); echo "$IMG"       # ghcr.io/arthjhon/sentinela-worker:<sha>
NET=$(jq -r '.networks.default.name' "$R"); echo "$NET"       # sentinela-stack_default
E=$(mktemp /run/sentinela-backfill.XXXXXX)                     # 600, tmpfs
jq -r '.services.worker.environment | {INFLUX_URL, INFLUX_ORG, INFLUX_WORKER_TOKEN}
       | to_entries[] | "\(.key)=\(.value | gsub("\\$\\$"; "$"))"' "$R" > "$E"
echo 'PG_WORKER_DSN=nao-usado-no-backfill' >> "$E"
cut -d= -f1 "$E"                                               # só os nomes
bf() { docker run --rm --name sentinela-backfill --network "$NET" \
         --memory 384m --memory-swap 384m --read-only --tmpfs /tmp \
         --cap-drop ALL --security-opt no-new-privileges:true \
         --env-file "$E" "$IMG" python -m sentinela_worker "$@"; }
bf backfill-openmeteo --start 2024-01-01      # 1 chamada por mês, pausa de 2 s
bf backfill-ana --start 2024-01-01            # 5 estações x meses, pausa de 2 s
shred -u "$E"; unset E
```

- Sem `--end`, vai até ontem (UTC). Os dois são idempotentes (mesmo ponto = mesma chave), então
  repetir um intervalo só regrava os mesmos valores.
- **Retomar**: o log de cada bloco mensal traz `"chunk done"` com `start`/`end`.
  - `backfill-openmeteo` para no primeiro erro: repetir com `--start` = `start` do bloco que
    falhou (o dia seguinte ao último `end` com `chunk done`).
  - `backfill-ana` percorre estação por estação, todos os meses de cada uma, e no fim falha
    listando as estações com bloco com erro (`"chunk failed"` traz `estacao`, `start`, `end`).
    Repetir só o mês que falhou: `bf backfill-ana --start <start> --end <end>` (pede de novo as 5
    estações daquele mês; inofensivo). Se o processo morreu no meio (ex. OOM, VM reiniciou), as
    estações seguintes ainda não começaram: repetir o intervalo inteiro (`--start 2024-01-01`).
- Exit 0 = tudo gravado; 1 = algum bloco falhou (ver o log); 2 = argumento inválido.

Conferir a contagem por mês (token de operador, lido sem eco; um mês com 0 ou faltando = lacuna):

```bash
C=$(docker ps -q --filter label=com.docker.compose.project=sentinela-stack --filter label=com.docker.compose.service=influxdb)
read -rs INFLUX_TOKEN; export INFLUX_TOKEN
docker exec -e INFLUX_TOKEN "$C" influx query --org sentinela '
from(bucket: "externos")
  |> range(start: 2024-01-01T00:00:00Z)
  |> filter(fn: (r) => r._measurement == "ana_telemetria" and r._field == "nivel")
  |> group(columns: ["estacao"])
  |> aggregateWindow(every: 1mo, fn: count, createEmpty: true)
  |> keep(columns: ["estacao", "_time", "_value"])'
docker exec -e INFLUX_TOKEN "$C" influx query --org sentinela '
from(bucket: "externos")
  |> range(start: 2024-01-01T00:00:00Z)
  |> filter(fn: (r) => r._measurement == "previsao" and r._field == "temperature_2m")
  |> group(columns: ["antecedencia_h"])
  |> aggregateWindow(every: 1mo, fn: count, createEmpty: true)
  |> keep(columns: ["antecedencia_h", "_time", "_value"])'
unset INFLUX_TOKEN; exit
```

Esperado: `previsao` com ~24 x dias do mês por antecedência (24, 48, ..., 168); `ana_telemetria`
com ~96 x dias por estação com dados (passo de 15 min; 39800100 hoje sem dados, então vazia).

### 14. nginx

O vhost versionado sai com o proxy `/influx/` **desligado**: todo `/influx/` responde 404 até o
Arthur decidir a mitigação do SSRF (passo 14a). Os blocos do proxy ficam em
`infra/nginx/sentinela-influx-proxy.conf`, incluídos só se estiverem em `/etc/nginx/sentinela.d/`.

```bash
readlink -f /etc/nginx/sites-enabled/sentinela.conf          # arquivo real do vhost
sudo cp -a "$(readlink -f /etc/nginx/sites-enabled/sentinela.conf)" /root/sentinela.conf.bak-$(date +%F)
diff -u "$(readlink -f /etc/nginx/sites-enabled/sentinela.conf)" infra/nginx/sentinela.conf
```

O diff deve mostrar só o realip, o `include /etc/nginx/sentinela.d/*.conf` e o `location ^~ /influx/`
(404). A regex de extensões estáticas foi reconstruída da spec (que a abrevia): se o diff mostrar
diferença nela, manter a de produção e corrigir o arquivo versionado. Depois:

```bash
sudo install -d -o root -g root -m 755 /etc/nginx/sentinela.d        # vazio = proxy desligado
sudo install -o root -g root -m 644 infra/nginx/sentinela.conf "$(readlink -f /etc/nginx/sites-enabled/sentinela.conf)"
sudo install -o root -g root -m 644 infra/nginx/sentinela-http.conf /etc/nginx/conf.d/sentinela-http.conf
sudo nginx -t && sudo systemctl reload nginx
H='Host: sentinela.arthlabs.dev'; U=http://127.0.0.1:8088/influx
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" -X POST "$U/api/v2/query?org=sentinela"   # 404 (desligado)
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" http://127.0.0.1:8088/                    # 200
```

- O IP do visitante vem de `CF-Connecting-IP` (`set_real_ip_from 127.0.0.1` dentro do server do
  Sentinela, não no `http{}`: os outros vhosts continuam vendo o IP do socket). Sem isso o
  `limit_req` do proxy seria global, porque todo tráfego chega do cloudflared em loopback.
- Rollback: `sudo install -m 644 /root/sentinela.conf.bak-<data> <arquivo real>`,
  `sudo rm /etc/nginx/conf.d/sentinela-http.conf`, `sudo nginx -t && sudo systemctl reload nginx`.

### 14a. Proxy `/influx/` — risco de SSRF

Qualquer visitante que alcance `POST /influx/api/v2/query` executa **Flux** no InfluxDB, e o Flux
tem pacotes de rede. Mesmo com o token `nginx-publico` (só leitura de `iot`), uma consulta pode:

- buscar URLs a partir do container (`http/requests`): serviços em loopback do container, a rede
  docker da stack, o host e a internet;
- abrir conexões de banco (`sql.from(driverName: "postgres", dataSourceName: ...)`) para qualquer
  host alcançável, inclusive o Postgres do Supabase se houver rota.

Prova (reproduzida localmente em `influxdb:2.7.12` com token só-leitura; devolve o corpo do
`/health`):

```bash
curl -s -X POST 'https://sentinela.arthlabs.dev/influx/api/v2/query?org=sentinela' \
  -H 'Content-Type: application/vnd.flux' --data 'import "http/requests"
import "array"
r = requests.get(url: "http://127.0.0.1:8086/health")
array.from(rows: [{status: r.statusCode, body: string(v: r.body)}])'
```

O que já existe: limites de consulta no `compose.yml` (`INFLUXD_QUERY_CONCURRENCY=4`,
`INFLUXD_QUERY_QUEUE_SIZE=10`, `INFLUXD_QUERY_MEMORY_BYTES=64 MiB`,
`INFLUXD_QUERY_MAX_MEMORY_BYTES=256 MiB`, confirmados em `/api/v2/config` e no log de start), e o
proxy só aceita `POST` com corpo de até 16 KiB e 5 r/s por IP. Isso limita o custo de uma consulta
abusiva, **não** o SSRF. Opções (decisão do Arthur):

| Opção | O que é | Prós | Contras |
| --- | --- | --- | --- |
| **(a) recomendada** | Migrar as leituras do frontend para InfluxQL v1 (`/query`) com mapeamento DBRP do bucket `iot`; o nginx expõe só `GET /influx/query` com `db` fixo | InfluxQL não tem pacotes de rede: elimina o SSRF na origem | Mudança no `useInfluxHistory` e criação do DBRP (`influx v1 dbrp create`) |
| (b) | Firewall de saída para o container do InfluxDB (cadeia `DOCKER-USER`: só respostas a conexões estabelecidas) | Sem mudar o frontend | Não cobre o loopback do próprio container nem a rede da stack; regra de host fora do compose (drift) |
| (c) | Aceitar o risco | Nada a fazer | Visitante anônimo usa o InfluxDB como cliente HTTP/SQL de dentro da VM |

### 14b. Ativar o proxy (só depois da decisão acima)

```bash
sudo install -o root -g root -m 600 /dev/null /etc/nginx/sentinela-influx-token.conf
sudoedit /etc/nginx/sentinela-influx-token.conf    # set $influx_token "<token nginx-publico>";
sudo install -o root -g root -m 644 infra/nginx/sentinela-influx-proxy.conf /etc/nginx/sentinela.d/influx-proxy.conf
sudo nginx -t && sudo systemctl reload nginx
H='Host: sentinela.arthlabs.dev'; U=http://127.0.0.1:8088/influx
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" "$U/health"                       # 200
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" "$U/api/v2/query?org=sentinela"   # 403 (GET)
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" "$U/api/v2/buckets"              # 404
```

Desativar: `sudo rm /etc/nginx/sentinela.d/influx-proxy.conf && sudo nginx -t && sudo systemctl reload nginx`.

- Só `POST /influx/api/v2/query` e `GET /influx/health` chegam ao InfluxDB; o resto de `/influx/` é
  404. Corpo máximo 16 KiB; `limit_req` 5 r/s por IP com burst 10 (429 acima disso).
- Validado localmente com `nginx:1.22.1` (versão do Debian 12): desligado, todo `/influx/` 404 e o
  SPA 200; ligado, POST 200, GET 403, buckets/write 404, corpo de 20 KB 413, 25 requisições do mesmo
  IP → 6 x 429, outro IP logo depois → 200, cabeçalhos `X-Influxdb-*` ocultos.

### 15. Backup (timer systemd)

```bash
sudo install -o root -g root -m 600 /dev/null /usr/local/etc/sentinela/influx-backup.token
sudoedit /usr/local/etc/sentinela/influx-backup.token          # só o token 'backup'
sudo install -o root -g root -m 644 infra/systemd/influx-backup.service infra/systemd/influx-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start influx-backup.service; sudo journalctl -u influx-backup.service -n 20 --no-pager
sudo ls -l /srv/sentinela/backups/influx/
sudo systemctl enable --now influx-backup.timer && systemctl list-timers influx-backup.timer
```

Diário às 03:30 (hora local), `Persistent=true` (roda depois se a VM estava desligada). Mantém os 7
mais recentes em `/srv/sentinela/backups/influx/<UTC>/influx-backup.tar` + `SHA256SUMS`. O tar nunca
é extraído no host. O serviço roda sem nenhuma capability, sem rede, com `ProtectSystem=strict` e
escrita só no diretório de backup; o acesso ao socket do Docker continua equivalente a root (o
sandbox limita o script, não a API do Docker). O sandbox não foi exercitado em systemd real fora da
VM: o primeiro `systemctl start` acima é a validação. Backup offsite segue pendente (spec §9).

Restauração (shell root: `sudo -i`):

```bash
B=/srv/sentinela/backups/influx/<UTC>
(cd "$B" && sha256sum -c SHA256SUMS)
C=$(docker ps -q --filter label=com.docker.compose.project=sentinela-stack --filter label=com.docker.compose.service=influxdb)
docker cp "$B/influx-backup.tar" "$C:/tmp/restore.tar"
docker exec "$C" sh -c 'rm -rf /tmp/restore && mkdir /tmp/restore && tar -C /tmp/restore -xf /tmp/restore.tar'
read -rs INFLUX_TOKEN; export INFLUX_TOKEN            # token de operador
# um bucket, para conferir antes: --bucket iot --new-bucket iot_restaurado
docker exec -e INFLUX_TOKEN "$C" influx restore /tmp/restore --bucket iot --new-bucket iot_restaurado
# tudo (substitui metadados, inclusive tokens): influx restore /tmp/restore --full
docker exec "$C" rm -rf /tmp/restore /tmp/restore.tar; unset INFLUX_TOKEN
```

### 16. Proteção de branch na `main` — ANTES do merge

Junto com o 6b, antes do merge desta branch: a confiança do deploy (R15, "Riscos residuais") é a
`main` protegida.

```bash
gh api -X PUT repos/arthjhon/projeto-sentinela/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
gh api repos/arthjhon/projeto-sentinela/branches/main/protection --jq '{enforce_admins: .enforce_admins.enabled, force: .allow_force_pushes.enabled, pr: (.required_pull_request_reviews != null)}'
```

PR obrigatório também para admin, sem force push nem deleção. Quando o `stack.yml` existir, exigir
o job de teste: `"required_status_checks": {"strict": true, "contexts": ["test"]}`.

### 17. Worker: restrições que o deploy exige (referência)

- Imagem só `ghcr.io/arthjhon/sentinela-worker:${WORKER_TAG}` (40-hex; o CI passa o SHA como
  argumento, `none` mantém o implantado). O compose usa `${WORKER_TAG:?}`; sem tag implantada o
  script recusa `none` antes do render (fail-closed; passo 11).
- O `.env` da VM precisa de `INFLUX_WORKER_TOKEN`, `PG_WORKER_DSN` e
  `SUPABASE_NETWORK=sentinela-pg`. O worker entra na `sentinela-pg` (passo 7) só para alcançar o
  Postgres, e a saída para a internet é pela rede `default` da stack.
- Rede externa: só o serviço `worker` pode entrar nela (o validador nega `influxdb`/`telegraf`),
  com `cap_drop: [ALL]` e anexo **vazio** (`networks: { pg: {} }`; sem `aliases`, `ipv4_address`,
  `mac_address`, prioridades); rede top-level `pg: { external: true, name: ${SUPABASE_NETWORK} }`.
- `hostname`/`container_name`, se usados, começam com `sentinela-`.
- Sem bind mount (a política do deploy só aceita bind somente leitura dos arquivos do conjunto
  esperado); config embutida na imagem. Sem `env_file`: `environment: { KEY: ${KEY} }`.
- No `compose.yml`: sem `\`, sem `!`, e sem as palavras `env_file`, `label_file`, `include`,
  `extends`, nem em comentário.
- Logs: `logging: { driver: local, options: { max-size: "10m", max-file: "3" } }` nos três
  serviços (no máximo ~30 MiB por container no disco compartilhado).
- Recomendado: `read_only: true`, `user` não-root, `security_opt: [no-new-privileges:true]`,
  `mem_limit: 384m`, healthcheck (o deploy espera `healthy`).

### Riscos residuais aceitos

- **Confiança no CI (R15).** Um compose malicioso que passe no validador, junto com uma imagem
  maliciosa do worker, pode levar qualquer valor do `.env` para dentro do worker (o validador não
  fixa valor por variável). A fronteira de confiança é a `main` protegida + PR revisado + aprovação
  do environment `production`. Com a `sentinela-pg`, o que um worker comprometido alcança no
  Supabase é só a porta 5432 do `supabase-db` com as credenciais que tiver (`sentinela_worker`,
  sem BYPASSRLS; o `.env` não guarda credencial de superuser). Antes desta correção, na
  `supabase_default`, o mesmo worker teria SQL como `supabase_admin` (superuser) via `meta:8080`,
  sem credencial nenhuma: por isso o passo 11b é obrigatório e repetido a cada atualização do
  Supabase.
- **Portas do host.** O worker alcança, pelo IP do host, o que estiver publicado em `0.0.0.0`
  (ex. Kong `:8000`, que exige chave), como qualquer máquina da LAN. Portas publicadas em
  `127.0.0.1` (InfluxDB `:8086`, nginx `:8088`) não são alcançáveis a partir dos containers.
- **`pg_net` via PUBLIC**: passo 9.

### 18. Rotação de segredos

- **Token Influx** (`telegraf`, `worker`, `nginx-publico`, `backup`):
  ```bash
  sudo -i
  C=$(docker ps -q --filter label=com.docker.compose.project=sentinela-stack --filter label=com.docker.compose.service=influxdb)
  read -rs INFLUX_TOKEN; export INFLUX_TOKEN          # admin
  ID=$(docker exec -e INFLUX_TOKEN "$C" influx auth list --json | jq -r '.[] | select(.description=="telegraf") | .id')
  docker exec -e INFLUX_TOKEN "$C" influx auth delete --id "$ID" >/dev/null
  /usr/local/sbin/influx-bootstrap.sh                 # recria só o que falta e imprime o novo
  ```
  Atualizar o destino (tabela do passo 12) e aplicar: `.env` → `stack-deploy.sh none`; include do
  nginx → `nginx -t && systemctl reload nginx`; arquivo do backup → nada. Entre o `delete` e a
  aplicação o consumidor recebe 401 (Telegraf reenvia o buffer; site sem histórico por instantes).
- **Senha MQTT do Telegraf**: `sudo infra/bin/mqtt-user.sh add svc/telegraf` (rotaciona e imprime a nova
  senha), colocar em `MQTT_TELEGRAF_PASS` no `.env` e `stack-deploy.sh none`. Entre o `add` e o deploy
  o Telegraf é recusado (reenvia o buffer). Ver "Rotação e vazamento" na seção Broker MQTT.
- **`INFLUX_ADMIN_TOKEN`**: só vale no setup inicial. Para trocar, criar outro token de operador
  (`influx auth create --operator --description admin-<data>`), pôr no `.env`, testar, apagar o
  antigo. O container guarda o token antigo na config do CLI (`/etc/influxdb2/influx-configs`).
- **Chaves SSH do CI**: gerar par novo, trocar a linha em `authorized_keys` (passo 5) e o secret
  do environment `production` (passo 6b).
- **Token do GHCR** (se o pacote for privado): gerar novo antes de expirar, `docker login` de novo
  como root (passo 8), revogar o antigo no GitHub.
- **Senha do `sentinela_worker`**: repetir o bloco 2 do passo 9 (substitui `PG_WORKER_DSN` no
  `.env`) e `stack-deploy.sh none`.
- **`TAILSCALE_AUTHKEY`**: gerar outra com as mesmas opções (efêmera, tag `tag:ci-sentinela`),
  trocar o secret do environment `production` (passo 6b), revogar a antiga no admin do tailnet.
- **Chave de host da VM** (se regenerada): refazer o passo 6.

### 19. Rollback

- **Automático**: se o `up` falhar ou algum serviço não ficar saudável em 120 s (ou ficar
  `unhealthy`), o script volta `current` para `.current` (último bom conhecido, re-renderizado e
  revalidado com o `.env` e a política atuais), sobe de novo e sai com 1. `DEPLOYED` e `.current`
  só mudam em sucesso. No primeiro deploy não há `.current`: os containers ficam como estão para
  diagnóstico.
- **Queda no meio** (VM reiniciou, processo morto): `.current`/`DEPLOYED` continuam na última release
  saudável; `current` pode apontar para a release incompleta. Rodar um deploy (CI ou
  `sudo /usr/local/sbin/stack-deploy.sh none`) resolve; se ele falhar, o rollback automático volta
  ao `.current`.
- **Preferido (GitOps)**: `git revert` do commit na `main` via PR; o CI implanta a versão anterior.
- **Emergência** (sem CI), voltar ao `.previous`:
  ```bash
  sudo cat /srv/sentinela/stack/.previous/DEPLOYED                       # <data> <sha|none>
  sudo cat /srv/sentinela/stack/.previous/compose.yml | sudo -u sentinela-deploy tee /srv/sentinela/stack-incoming/compose.yml >/dev/null
  sudo cat /srv/sentinela/stack/.previous/telegraf/telegraf.conf | sudo -u sentinela-deploy tee /srv/sentinela/stack-incoming/telegraf/telegraf.conf >/dev/null
  sudo -u sentinela-deploy install -d -m 755 /srv/sentinela/stack-incoming/mosquitto
  for f in mosquitto.conf acl; do   # um .previous anterior ao broker nao tem estes: usar os do repo
    sudo cat "/srv/sentinela/stack/.previous/mosquitto/$f" | sudo -u sentinela-deploy tee "/srv/sentinela/stack-incoming/mosquitto/$f" >/dev/null
  done
  sudo /usr/local/sbin/stack-deploy.sh <sha-do-.previous|none>
  ```
- **Parar a stack** (nunca `down -v`: apagaria os volumes de dados):
  ```bash
  sudo docker compose -p sentinela-stack -f /srv/sentinela/stack/current/rendered.json down
  ```
- **Dados**: restaurar backup (passo 15). **nginx**: passo 14.
- Diagnóstico: `sudo tail -n 100 /var/log/sentinela-stack-deploy.log`,
  `sudo docker compose -p sentinela-stack ps -a`, `sudo ls -l /srv/sentinela/stack/`.

### Testes locais (workstation)

```bash
bash infra/tests/validate-compose.test.sh   # política do validador
bash infra/tests/stack-deploy.test.sh       # deploy ponta a ponta (projeto sentinela-stack-test); publica 127.0.0.1:9001
                                            # no host: falha se outro broker já ocupa essa porta
bash infra/tests/influx-ops.test.sh         # bootstrap + backup em InfluxDB descartável
bash infra/tests/mosquitto.test.sh          # ACL do broker (container descartável, ~60 s)
```

O teste do deploy roda como usuário comum com `SENTINELA_DEPLOY_ROOT=<tmp>` (prefixo de todos os
caminhos; ignorado como root), usa volumes `sentinela-stack-test_*` e remove só o que criou; nunca
toca nos volumes `sentinela-influxdb-*` da máquina.

## Broker MQTT

O broker é o Mosquitto (`eclipse-mosquitto:2.0.22`) do próprio compose da stack, na VM da UMJ;
substitui o HiveMQ Cloud. Configuração e ACL em `infra/stack/mosquitto/` (versionadas, enviadas
pelo CI como parte dos quatro arquivos do deploy).

```text
Telegraf --TCP 1883, com senha--> mosquitto (rede interna do compose; sem porta no host)
boias, navegador, edge function OTA (MQTT_OTA_URL) --WSS--> Cloudflare --túnel cloudflared--> 127.0.0.1:9001
                                                    (wss://mqtt.arthlabs.dev/mqtt; WebSocket do mosquitto, só no loopback)
```

- Listener `1883`: só dentro da rede do compose, autenticação obrigatória. Não é publicado no host.
- Listener `9001` (WebSocket): publicado só em `127.0.0.1` (o validador recusa outra porta ou
  outro IP). Leitura anônima de telemetria; publicar exige credencial (ACL em `mosquitto/acl`).
- O serviço não entra na rede externa `sentinela-pg`.
- Healthcheck sem credencial: conexão TCP nos dois listeners. Não prova auth/ACL; isso é o
  `infra/tests/mosquitto.test.sh`.

### Rollout (migração do HiveMQ)

Ordem única da troca HiveMQ Cloud → mosquitto próprio. Cada passo só começa com o anterior
conferido; mudança em produção só com o go do Arthur. Meta: concluído até 2026-12-15; o cluster
HiveMQ precisa ser apagado antes de 2026-12-31.

**Pré-requisitos (bloqueiam tudo):** correção do congelamento do hypervisor (queda de 2026-11-17,
fsfreeze sem thaw) aplicada e a stack da Fase 2 (InfluxDB/Telegraf/worker) já em produção.

1. **Reinstalar na VM** `stack-deploy.sh`, `validate-compose.sh` e `allowed-images` desta versão
   (passo 3, "Atualizar", com revisão do diff). As cópias antigas não conhecem o serviço
   `mosquitto` e **recusam** o compose novo (fail closed): sem isto o deploy do passo 4 falha
   antes de tocar no que está rodando.
2. **Porta livre:** `ss -ltn 'sport = :9001'` na VM não pode listar nada em `127.0.0.1:9001`
   (nem em `0.0.0.0`); senão o `up` do mosquitto falha no bind.
3. **Túnel:** regra de ingress de `mqtt.arthlabs.dev` **acima** do catch-all no `config.yml` do
   cloudflared (backup do `config.yml` antes; seção "Exposição" abaixo), restart e `journalctl`.
   O CNAME `mqtt` já foi criado pelo Arthur em 2026-11-18 (proxied, sem Access).
4. **Merge na `main` sem o frontend → primeiro deploy do broker.** O `deploy.yml` e o `pages.yml`
   publicam o site a cada push na `main`; se o frontend novo for junto, o painel passa a ler o
   broker novo anônimo antes de o secret mudar (sem dados ao vivo) e a mandar OTA para uma função
   que ainda não existe. Por isso os dois commits de frontend ficam **no topo** do `dev` e vão só
   no passo 11:
   - `feat(frontend): anonymous read-only MQTT and OTA via edge function`
   - `fix(frontend): keep a fast device rejection and gate OTA deploy to admins`

   Conferir antes do merge: `git log --oneline -2 dev` mostra exatamente esses dois, e
   `git diff --stat dev~2 dev` só lista `src/`, `Dockerfile`, `README.md`, `.env.example` e os
   workflows `deploy.yml`/`pages.yml`. Se aparecer commit novo depois deles, reordenar antes. O
   merge na `main` é de `dev~2`. O push dispara o `stack.yml`: aprovar o "Deploy data stack" — é o
   primeiro deploy do broker, com o Telegraf **ainda no HiveMQ** (`.env` sem mudança de
   `MQTT_BROKER`; seção "Primeiro deploy com o broker", passos 1–2). O deploy do site que o mesmo
   push dispara publica o painel atual (inalterado).
5. **Provisionar** `svc/telegraf`, `svc/ota` e cada boia (`esp_sururu`) com `mqtt-user.sh add`
   (seção "Credenciais"). A senha de `svc/telegraf` vai para o cofre; o `.env` **ainda não** muda.
6. **Prova pública** com `infra/tests/mqtt_probe.py` a partir da workstation, pelo hostname
   público (precisa de `paho-mqtt==2.1.0` num venv; senhas só por variável de ambiente, nunca em
   argv). Rodar antes do passo 10: nada consome o broker novo ainda, então o marcador publicado
   pelo probe não chega ao Telegraf nem a painel.

   ```bash
   U=wss://mqtt.arthlabs.dev/mqtt
   read -rs MQTT_FEED_PASS; export MQTT_FEED_PASS; MQTT_PASS=$MQTT_FEED_PASS; export MQTT_PASS   # senha da boia
   # anônimo lê a telemetria
   python3 infra/tests/mqtt_probe.py --url $U --sub esp_sururu/status --feeder esp_sururu --feeder-url $U --expect allowed
   # anônimo não publica
   python3 infra/tests/mqtt_probe.py --url $U --pub esp_sururu/status --observer - --obs-url $U --expect denied
   # a boia publica no próprio prefixo, e só nele
   python3 infra/tests/mqtt_probe.py --url $U --user esp_sururu --pub esp_sururu/status --observer - --expect allowed
   python3 infra/tests/mqtt_probe.py --url $U --user esp_sururu --pub outra_boia/status --observer - --expect denied
   unset MQTT_PASS MQTT_FEED_PASS
   ```

   Exit 0 em todos = ACL pública conforme. Qualquer outro resultado: parar aqui.
7. **Banco e Edge Function cedo** (os dois são compatíveis com o painel atual: a coluna
   `arquivo_path` é nullable e a função não tem chamador até o passo 11): `pg_dump` do Supabase
   antes; aplicar `supabase/migrations/20261119_firmware_deploys_path.sql`; publicar a função
   `ota-command` com as quatro variáveis (seção "Edge Function"). Assim os testes de bancada de
   OTA e rollback do firmware 5.1.0 (`BENCH.md` do firmware) já rodam contra o broker novo.
8. **Bancada do 5.1.0** concluída (`BENCH.md`), com uma placa de teste no broker novo. Os itens
   que usam o painel exigem o **frontend novo rodando local** (`npm run dev` na workstation, com
   `VITE_MQTT_BROKER_URL=wss://mqtt.arthlabs.dev/mqtt` no `.env.local`, contra o Supabase de
   produção): o painel em produção ainda é o atual. Usar na placa de teste um `DEVICE_ID` próprio
   de bancada (não o da boia), para o `<id>/ota/status` retido dos testes de rollback não aparecer
   no card da boia depois do passo 11; ao terminar, limpar os retidos dela com a credencial dela
   (`mosquitto_pub -r -n` em `<id>/ota/status` e `<id>/availability`) e `mqtt-user.sh del`.
9. **OTA 5.1.0 para a boia via HiveMQ, com o painel ATUAL** (o 5.0.x só fala com o HiveMQ e o
   painel novo não publica lá). Conferir que a boia aparece no broker novo com uma assinatura
   anônima no WSS (`mqtt_probe.py --url wss://mqtt.arthlabs.dev/mqtt --sub <id>/status --receive
   --expect allowed`, ou o painel local do passo 8): `<id>/availability` = `online`,
   `<id>/status` com `firmware 5.1.0`. Plano B: USB. Entre os passos 9 e 11 o painel de produção
   mostra a boia offline e o InfluxDB fica sem pontos até o passo 10: fazer 9 → 10 → 11 em
   sequência.
10. **Trocar o Telegraf** só depois que a boia estiver no broker novo: `.env` com
    `MQTT_BROKER=tcp://mosquitto:1883`, `MQTT_TELEGRAF_USER=svc/telegraf`, `MQTT_TELEGRAF_PASS`
    e `sudo /usr/local/sbin/stack-deploy.sh none` (passo 3 de "Primeiro deploy com o broker").
    Conferir pontos novos no InfluxDB.
11. **Frontend:** trocar o secret `VITE_MQTT_BROKER_URL` do GitHub para
    `wss://mqtt.arthlabs.dev/mqtt` e **só então** fazer merge na `main` dos dois commits de
    frontend (`dev` inteiro) e aprovar o deploy do site (o painel passa a ler anônimo e a mandar
    OTA pela Edge Function). Teste: OTA com versão
    descartável numa placa de bancada.
12. **Apagar** os secrets `VITE_MQTT_USER` e `VITE_MQTT_PASS` do GitHub (a credencial HiveMQ
    estava no bundle público).
13. **Uma semana estável** → apagar o cluster HiveMQ (antes de 2026-12-31) e a credencial dele.

**Rollback (até o passo 12):** voltar `VITE_MQTT_BROKER_URL` para o HiveMQ e reverter os dois
commits de frontend na `main` (`git revert` dos dois, nova ordem: o `fix` primeiro); voltar `MQTT_BROKER`/credencial do Telegraf no `.env` e `stack-deploy.sh none`;
boia: gravar por USB o backup 5.0.4 (fala com o HiveMQ). O broker pode ficar parado no compose
sem afetar o resto; a coluna `arquivo_path` e a função podem ficar (função sem chamador). Depois
do passo 13 não há volta ao HiveMQ.

### Primeiro deploy com o broker (ordem obrigatória; só no primeiro deploy)

Vale **uma vez**, no passo 4 do Rollout; depois que o Telegraf está no broker novo, os deploys
seguem o fluxo normal (CI) e o rollback automático funciona.

O primeiro deploy do mosquitto **não tem rollback automático**: o `rollback()` reprepara o último
release bom, e um release anterior ao broker não tem `mosquitto/mosquitto.conf` nem `mosquitto/acl`,
então a validação falha ("last-known-good no longer passes validation; NOT starting it") e nada é
reiniciado. Além disso o `passwd` nasce vazio, então um telegraf apontado para o broker novo é
recusado e o `wait_healthy` falha. Por isso, nesta ordem:

1. Deploy com o `.env` **ainda no HiveMQ** (`MQTT_BROKER` antigo): sobe o mosquitto sem que o telegraf dependa dele para autenticar.
2. Provisionar `svc/telegraf` (e `svc/ota`) no `passwd` (próxima seção) e conferir `docker logs` do broker.
3. **Só depois que a boia estiver no broker novo** (passo 9 do Rollout: OTA 5.1.0 via HiveMQ):
   trocar o `.env` para `MQTT_BROKER=tcp://mosquitto:1883`, `MQTT_TELEGRAF_USER=svc/telegraf`,
   `MQTT_TELEGRAF_PASS` e rodar `sudo /usr/local/sbin/stack-deploy.sh none` (recria só o telegraf;
   daqui em diante o rollback automático funciona). Trocar antes deixa o InfluxDB sem dados: a
   boia em 5.0.x ainda publica só no HiveMQ.

Recuperação manual se o passo 1 falhar: o `current` já aponta para o release novo (o deploy troca o
link antes do `up`) e o release anterior ao broker não passa mais pela validação (o `deploy` exige
os quatro arquivos), então o caminho é **corrigir para frente**, não voltar: `sudo docker compose -p
sentinela-stack stop mosquitto` se ele estiver em loop, conferir o motivo em `sudo cat
/var/log/sentinela-stack-deploy.log` e `docker logs`, manter o `.env` no HiveMQ, corrigir a causa no
repositório e reenviar os quatro arquivos (CI ou deploy manual). Os containers `influxdb` e `telegraf`
do release anterior seguem rodando enquanto o `up` não os recria; o `.previous` guarda o release
antigo para consulta.

### Credenciais (volume `sentinela-mosquitto-data`)

Os usuários vivem em `/mosquitto/data/passwd`, dentro do volume `sentinela-mosquitto-data`. Na
primeira partida o serviço cria o arquivo vazio (dono `mosquitto`, modo 600); depois nunca o
sobrescreve. Contas de serviço: `svc/telegraf` (subscribe) e `svc/ota` (publica `+/ota/command`);
cada boia usa o próprio device id como usuário.

Provisionamento com `infra/bin/mqtt-user.sh`, na VM, como operador com acesso ao Docker (`sudo`).
Só precisa de bash e docker. O container é achado pelos labels do compose
(`project=sentinela-stack`, `service=mosquitto`); `MQTT_CONTAINER` sobrescreve.

```bash
sudo infra/bin/mqtt-user.sh add <usuario>   # imprime a senha UMA vez (40 caracteres aleatórios)
sudo infra/bin/mqtt-user.sh del <usuario>
sudo infra/bin/mqtt-user.sh list            # só nomes, nunca hashes
```

- `<usuario>`: device id (`[A-Za-z0-9_-]{1,40}`) ou exatamente `svc/telegraf` / `svc/ota`; qualquer
  outro valor sai com exit 2.
- `add` num usuário existente **rotaciona** a senha. Nunca duplica linha; ids que parecem número
  (`100`, `1e2`, `0100`) são comparados como texto e não se atropelam.
- A senha não aparece em argv de nenhum processo (host nem container): vai por stdin do `docker exec -i`
  e o hash é gerado dentro do container. O texto puro só existe em `/dev/shm` (tmpfs); no volume só
  entra o hash. O `passwd` é reescrito em arquivo temporário no mesmo diretório, sob `flock`, conferido
  (número de linhas) e trocado por `mv`; dono 1883 e modo 600 depois de cada operação. Em seguida o
  script manda `SIGHUP` (recarrega `passwd` e ACL). Se o HUP falhar, o hash já vale: o script ainda
  imprime a senha, avisa no stderr e sai com 1; rodar `sudo docker kill -s HUP <container>`.
- Não deixar a senha em arquivo nem no histórico: copie do terminal direto para o destino (`.env`,
  secret, `secrets.h`). Se usar um arquivo intermediário, apague-o (`shred -u`) logo depois.
- Teste: `infra/tests/mqtt-user.test.sh` (broker descartável com a config real).

**Bootstrap (só no primeiro deploy, depois do deploy do broker):**

1. `add svc/telegraf` → senha no cofre; ela entra no `.env` da stack (`MQTT_TELEGRAF_PASS`,
   `MQTT_BROKER=tcp://mosquitto:1883`, `MQTT_TELEGRAF_USER=svc/telegraf`) só no passo 10 do
   Rollout, depois que a boia estiver no broker novo.
2. `add svc/ota` → segredo da Edge Function OTA (`MQTT_OTA_URL` aponta para `wss://mqtt.arthlabs.dev/mqtt`).
3. `add <device_id>` para cada boia → `secrets.h` da placa (usuário = device id).

**Rotação e vazamento:** o `SIGHUP` recarrega `passwd` e ACL, mas vale para **novas** conexões; uma
sessão já aberta com a senha antiga não é derrubada pelo HUP (não verificado se o broker a
reavalia; tratar como mantida). Em suspeita de vazamento: `add <usuario>` e depois
`sudo docker restart <container do mosquitto>` para derrubar as sessões abertas (as boias
reconectam sozinhas; as retidas persistem em `/mosquitto/data`). Para o `svc/telegraf`, atualizar
o `.env` e rodar `stack-deploy.sh none` antes ou logo depois, senão o Telegraf é recusado.

**Decisão de projeto:** as credenciais das boias e do `svc/ota` autenticam necessariamente pelo
`wss://mqtt.arthlabs.dev/mqtt` público (a abordagem C não tem outro caminho; o 1883 não sai da rede
do compose). Mitigações: senhas aleatórias de 32+ caracteres, Cloudflare na frente, `max_connections`
no broker e rotação com `mqtt-user.sh add` (rotação) se houver suspeita de vazamento.

**Backup:** o volume é o único lugar das credenciais. Perder o volume = reprovisionar todas as
credenciais (boias incluídas). Incluir `sentinela-mosquitto-data` no backup da VM (o timer do
passo 15 cobre só o InfluxDB). O `passwd` guarda só hashes, mas é segredo: mesmo cuidado de um `.env`.

### Exposição: túnel Cloudflare e DNS

O WebSocket chega ao navegador por `wss://mqtt.arthlabs.dev/mqtt`. No `config.yml` do cloudflared
da VM, adicionar a regra **acima** do catch-all (`service: http_status:404`):

```yaml
ingress:
  - hostname: mqtt.arthlabs.dev
    service: http://127.0.0.1:9001
  # ...demais regras existentes...
  - service: http_status:404
```

Depois `sudo systemctl restart cloudflared` e conferir `sudo journalctl -u cloudflared -n 30`.
O CNAME `mqtt` para `<id-do-túnel>.cfargotunnel.com` (proxied) é criado pelo Arthur no painel da
Cloudflare: a VM não tem `cert.pem`, então `cloudflared tunnel route dns` não funciona lá.

- **Sem Cloudflare Access** nesse hostname: navegador e boia não passam por login de Access; o
  controle é a ACL do próprio broker (anônimo só lê a telemetria que o painel já mostra).
- O túnel só leva o WebSocket; o TCP 1883 nunca é exposto à internet.

### Edge Function `ota-command` (deploy)

O navegador é cliente MQTT anônimo e só lê; quem publica `<id>/ota/command` é a função
`supabase/functions/ota-command`, com a credencial `svc/ota` (ACL: escrita só em `+/ota/command`).
Só admin chama; o deploy precisa estar `pendente`, com `arquivo_path` (nome simples `.bin`),
SHA-256 válido e a bóia com `deviceId` no registro (`app_settings.map_buoys`).

1. Migration `supabase/migrations/20261119_firmware_deploys_path.sql` (coluna `arquivo_path`, idempotente;
   RLS inalterada) no banco do Supabase, antes de publicar a função.
2. Copiar a função para a VM (sem `.test.ts`):

   ```bash
   scp supabase/functions/ota-command/{index.ts,command.ts} <usuario>@<vm>:/tmp/
   ssh <usuario>@<vm> 'sudo install -d /srv/sentinela/supabase/volumes/functions/ota-command &&
     sudo install -m 0644 /tmp/index.ts /tmp/command.ts /srv/sentinela/supabase/volumes/functions/ota-command/'
   ```

3. No `.env` do compose do Supabase (`/srv/sentinela/supabase/.env`) adicionar as quatro variáveis e
   repassá-las ao serviço `functions` (`environment:` do compose do Supabase). A senha vem do cofre
   (a mesma gravada no `passwd` do broker para `svc/ota`); nunca em argv, log ou repositório:

   ```text
   MQTT_OTA_URL=wss://mqtt.arthlabs.dev/mqtt
   MQTT_OTA_USER=svc/ota
   MQTT_OTA_PASS=<senha de svc/ota>
   OTA_PUBLIC_BASE_URL=https://supabase.arthlabs.dev
   ```

   `OTA_PUBLIC_BASE_URL` precisa gerar URLs que começam com o `OTA_URL_PREFIX` do firmware
   (`https://supabase.arthlabs.dev/storage/v1/object/public/firmware/`).
4. Recriar só o runtime de functions: `docker compose up -d --no-deps functions` (no diretório do compose
   do Supabase). `functions` é o nome do **serviço** (`supabase-edge-functions` é só o `container_name`;
   confirmar com `docker compose config --services`). `restart` não serve: não recria o container e as
   variáveis novas do `.env` não chegam ao runtime (a função responderia 500 `not_configured`).
5. Smoke test (nada é publicado em nenhum dos casos):
   - sem `Authorization` -> 401; JWT de operador/visualizador -> 403 (`forbidden`);
   - admin com `deploy_id` inexistente -> 404; deploy já `sucesso`/`falha` -> 422 `not_pending`;
   - admin com deploy `pendente` de bóia de teste -> 200 `{"ok":true}` e a mensagem aparece em
     `mosquitto_sub` autenticado (bancada, sem placa gravada pelo agente).
6. Rollback: remover `/srv/sentinela/supabase/volumes/functions/ota-command/` e recriar o runtime (`docker compose up -d --no-deps functions`);
   a coluna `arquivo_path` pode ficar (nullable, inofensiva).

Falha do broker retorna 502 e marca o deploy como `falha`. Atenção: um timeout depois do PUBLISH e
antes do PUBACK (ou um erro de rede entre o navegador e a função) também vira `falha`, embora o
dispositivo ainda possa executar o OTA. A linha **não** é reescrita depois (a OtaPage para de
acompanhar o deploy no erro); o `ota/status` retido e a versão no card da frota mostram o que de
fato aconteceu. Sucesso não altera a linha: a OtaPage e o `ota/status` do dispositivo fecham o ciclo.

Comando acima de 512 bytes (limite `MQTT_RX_MAX_PAYLOAD` do firmware, que descarta sem responder)
ou versão com mais de 32 caracteres: 422 `too_large`, nada é publicado.

Dependência: `MQTT_OTA_URL` é o WSS público, então o envio de OTA depende do túnel cloudflared e do DNS
(além da VM e do broker); com o túnel fora, a função responde 502.

### Modo limitado

O broker agora roda na mesma VM da stack. Com a VM fora do ar (ou o broker parado), o painel perde
também o **monitoramento em tempo real** (antes o HiveMQ Cloud seguia no ar) e as boias não
conseguem publicar nem receber OTA até a VM voltar. A queda de 2026-11-17 (fsfreeze, ~24 h) é a
referência do impacto.
