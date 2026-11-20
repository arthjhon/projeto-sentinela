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

### 10b. Fonte ANA (HidroWebService) e rollback

O job `ana` lê o HidroWebService (`ANA_SOURCE=hidrowebservice`, padrão), uma requisição para as 5
estações a cada 15 min. O serviço legado (`telemetriaws1.ana.gov.br`) fica como fallback
(`ANA_SOURCE=legado`).

- **Credencial**: `ANA_HIDRO_USER` e `ANA_HIDRO_PASS` no `.env` da VM (`/srv/sentinela/stack/.env`,
  root 600; passo 10). É a conta pessoal (CPF) do Arthur, uso autorizado em 2026-11-20. Nunca em
  repositório, log ou argv. Sem a credencial, o job `ana` falha com
  `credencial ANA ausente (ANA_HIDRO_USER/ANA_HIDRO_PASS)` e os outros jobs seguem. Valor de
  `ANA_SOURCE` inválido derruba o worker na partida (o deploy faz rollback automático).
- **Rollback para o legado**: `ANA_SOURCE=legado` no `.env` e
  `sudo /usr/local/sbin/stack-deploy.sh none` (recria o worker com a mesma imagem). O legado vinha
  dando timeout em 2026-11-20; confirmar que responde antes de depender dele.
- **Backfill**: `backfill-ana` usa a mesma fonte. O container avulso do passo 13 precisa de
  `ANA_SOURCE`, `ANA_HIDRO_USER` e `ANA_HIDRO_PASS` no env-file (mesmo cuidado: tmpfs, root 600,
  nunca por argv). Janelas de até 29 dias, uma requisição por janela.
- **Comparação única entre fontes** (validar unidades e cobertura antes de desligar o legado):
  mesma janela de 24 h nas duas fontes (`ANA_SOURCE=legado` e `hidrowebservice`, container avulso
  com sink de contagem, sem escrever no Influx) e comparar `vazao`, `nivel` e `chuva` por estação
  e horário. Conferir em especial a unidade de `Cota_Adotada` (HidroWeb, gravada como `nivel`)
  contra `Nivel` do legado. Divergência de unidade bloqueia a troca de fonte.
- O HidroWeb grava também `vazao_status`, `nivel_status` e `chuva_status` (inteiros, só quando a
  API informa).

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
| `nginx-publico` | read `iot` | `/etc/nginx/sentinela-influx-token.conf` (só se o proxy for ativado, passo 14b; read `iot` basta para InfluxQL) |
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
proxy InfluxQL ser ativado (passo 14b; não depende mais de decisão, o SSRF do Flux foi fechado, ver
14a). Os blocos do proxy ficam em `infra/nginx/sentinela-influx-proxy.conf`, incluídos só se
estiverem em `/etc/nginx/sentinela.d/`.

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
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" "$U/query?db=iot&q=SHOW%20MEASUREMENTS"   # 404 (desligado)
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" http://127.0.0.1:8088/                    # 200
```

- O IP do visitante vem de `CF-Connecting-IP` (`set_real_ip_from 127.0.0.1` dentro do server do
  Sentinela, não no `http{}`: os outros vhosts continuam vendo o IP do socket). Sem isso o
  `limit_req` do proxy seria global, porque todo tráfego chega do cloudflared em loopback.
- Rollback: `sudo install -m 644 /root/sentinela.conf.bak-<data> <arquivo real>`,
  `sudo rm /etc/nginx/conf.d/sentinela-http.conf`, `sudo nginx -t && sudo systemctl reload nginx`.

### 14a. Proxy `/influx/` (consultas InfluxQL nomeadas, só leitura)

O proxy **não aceita consulta livre**. Cada endpoint é um modelo InfluxQL fixo, preenchido só com
parâmetros que o nginx valida (`map` em `infra/nginx/sentinela-http.conf`); parâmetro ausente ou
inválido responde 400. Todos são `GET`; resposta = JSON do `/query` do InfluxDB (`epoch=ms`).

| Endpoint | Parâmetros | Consulta |
| --- | --- | --- |
| `/influx/q/history` | `campo` = ph\|turbidez\|temperatura; `periodo` = 1h\|24h\|7d\|30d; `device` opcional | `mean(campo)` por janela (1h/30s, 24h/10m, 7d/1h, 30d/6h), `fill(none)` |
| `/influx/q/ultimas` | `device`; `periodo` = 24h\|30d | últimas 50 leituras (`turbidez, ph, temperatura`), mais recentes primeiro |
| `/influx/q/leituras-24h` | nenhum | `count(ph)` nas últimas 24 h |
| `/influx/q/primeira` | nenhum | `first(ph)` de todo o histórico |
| `/influx/q/export` | `device`; `periodo` = 1h\|24h\|7d\|30d | leituras brutas (`temperatura, ph, turbidez`) de um device, as 600000 mais recentes (`ORDER BY time DESC LIMIT 600000`, o cliente reordena); 1 por vez |

`device` = `[A-Za-z0-9_-]{1,40}` (vira o `topic` `<device>/sensores`; sem aspas nem contrabarra,
então o modelo não precisa de escape). Todo o resto de `/influx/` (incluindo `/influx/query` e
`/influx/api/v2/*`) responde 404; método diferente de GET responde 403. `GET /influx/health` fica.
Os mesmos modelos existem em `src/services/influxQueries.js` (usado pelo proxy de desenvolvimento
do Vite); se um mudar, o outro muda junto.

**Por que não `q` livre.** Duas rodadas de revisão mostraram que consulta livre não dá para
proteger no nginx:

- Flux (`POST /api/v2/query`): `http/requests` e `sql.from` fazem o InfluxDB buscar URLs e abrir
  conexões de banco (SSRF para loopback, rede da stack, host, internet, Postgres do Supabase).
- InfluxQL livre não tem função de rede, mas **não passa** pelo controlador de consultas do Flux
  (`INFLUXD_QUERY_*` não valem). Um único GET anônimo de ~1,8 KB derruba o container (OOM com
  `mem_limit: 768m`): `SELECT * FROM sensores,sensores,...` repetido, dezenas de subqueries,
  várias instruções separadas por `;`, ou `GROUP BY time(1s)` desde `time > 0`.
  `INFLUXD_INFLUXQL_MAX_SELECT_SERIES` não pega `FROM` repetido (é a mesma série), e
  `..._MAX_SELECT_POINT` é aceito mas **não é aplicado** no 2.7.12. Uma lista de regex sobre `q`
  não é confiável (o Go aceita `%53ELECT` e outras codificações).

Com modelos fixos essas formas não podem ser expressas. O que o nginx garante (cada item tem
teste em `infra/tests/influx-proxy.test.sh`):

- A URL do upstream é montada pelo nginx; a query string do cliente nunca é repassada (`u`/`p`
  legados valem **antes** do `Authorization` no InfluxDB 2.x: repassá-los deixaria qualquer token
  vazado ser usado pela internet). `q`, `db`, `rp`, `epoch`, `chunked` e o resto são ignorados.
- O `Authorization` do cliente é sobrescrito pelo token `nginx-publico` (só leitura de `iot`).
- Corpo da requisição nunca é repassado; corpo acima de 1 KiB dá 413.
- Escrita/DDL (`INTO`, `DROP`, `CREATE`, `DELETE`) não são expressáveis; o token só-leitura é a
  segunda camada.

**Custo.** `INFLUXD_INFLUXQL_MAX_SELECT_BUCKETS=1000` e `..._SERIES=100` (efetivos, verificados),
`GOMEMLIMIT=500MiB` (`infra/stack/compose.yml`); no nginx `limit_req` 5 r/s por IP (burst 10) e
`limit_conn` (4 consultas simultâneas no total, 3 por IP, 1 `export` por vez; excesso → 429).
Leitura crua só existe em `ultimas` (LIMIT 50) e `export` (um device, no máximo 30 dias, as 600000 mais recentes).
Todas as respostas dos endpoints nomeados levam `Cache-Control: no-store`.
Medido: 30 dias de uma bóia a 5 s com 3 campos (518 mil linhas, 14 MB) pesam ~315 MB acima da base
de ~110 MB.

**Risco por volume do topic.** O custo do `export` depende do volume de **um** topic, e esse volume
pode ser inflado de fora: o Telegraf aceita `+/sensores` e a credencial MQTT dos dispositivos é
pública (o bundle a carrega) enquanto a ACL do broker não for fechada. Medido a 768m +
`GOMEMLIMIT`: 2,07 M de linhas em um topic → 200 (564 MiB); 4,67 M → OOM. Por isso o modelo tem
`LIMIT 600000` (30 dias a 5 s = 518 mil linhas, com folga; com `ORDER BY time DESC`, se truncar, perde as leituras mais antigas, não as recentes): o mesmo topic de 4,67 M linhas passa a
responder 200, 16,7 MB, 456 MiB, sem OOM (regressão em `infra/tests/influx-proxy.test.sh`, que
semeia 4,2 M de linhas). O `LIMIT` é a contenção; **a correção de raiz é fechar a ACL do MQTT**
(topo deste runbook), para que só o dispositivo certo publique no próprio topic. Os outros modelos
agregam (`history`, `leituras-24h`, `primeira`) ou têm `LIMIT 50` (`ultimas`), então a **memória**
delas é limitada pelos tetos de volume e não cresce com o número de leituras. O `limit_conn
influx_export 1` mantém um export por vez.

**Risco por cardinalidade (`MAX_SELECT_SERIES=100`).** O teto de séries é um limite de
**cardinalidade**, não de volume: ele conta todas as séries de `sensores` (uma por `topic`) nos
shards do intervalo consultado. Os modelos agregados da frota (`primeira`, sem limite de tempo e
com retenção infinita; `leituras-24h` e `history` sem `device`) falham quando o total passa de 100
séries, seja por crescimento legítimo da frota, seja por inundação de topics: com a credencial MQTT
pública, qualquer um que publique em 101 topics `X/sensores` distintos derruba essas consultas, e
`primeira` falha para sempre (a série nunca sai do intervalo). Sintoma: a consulta devolve
HTTP 200 com `{"results":[{"statement_id":0,"error":"max-select-series limit exceeded: (101/100)"}]}`
(mensagem observada no `influxdb:2.7.12`; o painel mostra a frota sem dados). O valor `100` está
**provisório**: precisa da medição de §14b antes da ativação. A correção de raiz é a ACL do HiveMQ
(só o dispositivo certo publica no próprio topic; pré-requisito no topo deste runbook).
Contenção enquanto a ACL não fecha: limpar os topics falsos (§14b, "Limpeza").

**DBRP.** A API InfluxQL precisa mapear `db`/`rp` para um bucket. No `influxdb:2.7.12` o mapeamento
`iot`/`autogen` já existe de forma virtual (somente leitura), então `db=iot` funciona sem nada
extra (verificado em container descartável). O `influx-bootstrap.sh` cria mesmo assim o mapeamento
explícito (`influx v1 dbrp create --db iot --rp autogen --bucket-id <iot> --default`, idempotente:
"exists" se já houver), para não depender desse comportamento em outras versões. Conferir:
`docker exec influxdb influx v1 dbrp list --org sentinela` (com `INFLUX_TOKEN` de admin).

Teste ao vivo (InfluxDB com `mem_limit` 768m e os limites do `compose.yml`, nginx 1.22.1, token
só-leitura real; imagens fixadas, tudo descartável): `bash infra/tests/influx-proxy.test.sh`.

### 14b. Ativar o proxy

Pré-requisito: `influx-bootstrap.sh` já rodado (cria o token `nginx-publico` e o DBRP) e os limites
InfluxQL do `compose.yml` implantados pelo pipeline: deploy do CI ou
`sudo /usr/local/sbin/stack-deploy.sh none` (recria o InfluxDB; os dados ficam no volume e o
Telegraf bufferiza as escritas). Não usar `docker compose up` direto: fora do `stack-deploy.sh` o
projeto/`.env` podem ser outros e criar um segundo `influxdb` sobre o mesmo volume. Conferir:
`sudo docker inspect <container-influxdb> | grep INFLUXQL` (id: `docker ps -q --filter
label=com.docker.compose.project=sentinela-stack --filter label=com.docker.compose.service=influxdb`).
`sentinela-http.conf` instalado (passo 14). ACL do MQTT fechada (topo deste runbook) ou, até lá, a
medição abaixo.

**Medir a cardinalidade antes de ativar** (com o token de **operador**, direto no container, nunca
pelo proxy público; o token vem de `read -rs`, não fica no histórico):

```bash
C=$(sudo docker ps -q --filter label=com.docker.compose.project=sentinela-stack --filter label=com.docker.compose.service=influxdb)
read -rs INFLUX_TOKEN; export INFLUX_TOKEN
# Flux: não passa pelo teto de séries, então responde mesmo acima de 100 (_value = nº de séries)
sudo docker exec -e INFLUX_TOKEN "$C" influx query -o sentinela \
  'import "influxdata/influxdb" influxdb.cardinality(bucket: "iot", start: -30d, predicate: (r) => r._measurement == "sensores")'
# InfluxQL (API v1): a mesma contagem; acima do teto devolve o próprio erro max-select-series
sudo docker exec "$C" curl -s -G http://localhost:8086/query -H "Authorization: Token $INFLUX_TOKEN" \
  --data-urlencode db=iot --data-urlencode 'q=SHOW SERIES EXACT CARDINALITY FROM sensores'
# quais topics existem (funciona mesmo acima do teto)
sudo docker exec "$C" curl -s -G http://localhost:8086/query -H "Authorization: Token $INFLUX_TOKEN" \
  --data-urlencode db=iot --data-urlencode 'q=SHOW TAG VALUES FROM sensores WITH KEY = "topic"'
```

Regra de decisão: se a contagem estiver perto de 100 (ou for esperado crescer além), ou subir
`INFLUXD_INFLUXQL_MAX_SELECT_SERIES` depois de medir a memória (cada série a mais custa memória em
`primeira`/`history` da frota; repetir a medição de §14a), ou limitar `primeira` no tempo. Não
ativar com o valor atual sem essa medição. Os topics que não são dispositivos reais indicam
inundação.

**Limpeza de topics falsos** (apaga dados: conferir o topic com `SHOW TAG VALUES` antes, fazer
backup, §15; repetir por topic):

```bash
sudo docker exec -e INFLUX_TOKEN "$C" influx delete --org sentinela --bucket iot \
  --start 1970-01-01T00:00:00Z --stop "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --predicate '_measurement="sensores" AND topic="X/sensores"'
unset INFLUX_TOKEN
```

(Usa o mesmo `INFLUX_TOKEN` exportado acima; sintaxe verificada no `influxdb:2.7.12`: remove a série
e a contagem volta ao normal. Enquanto a ACL do HiveMQ não fechar, o atacante pode republicar.)

```bash
sudo install -o root -g root -m 600 /dev/null /etc/nginx/sentinela-influx-token.conf
sudoedit /etc/nginx/sentinela-influx-token.conf    # set $influx_token "<token nginx-publico>";
sudo install -o root -g root -m 644 infra/nginx/sentinela-http.conf /etc/nginx/conf.d/sentinela-http.conf
sudo install -o root -g root -m 644 infra/nginx/sentinela-influx-proxy.conf /etc/nginx/sentinela.d/influx-proxy.conf
sudo nginx -t && sudo systemctl reload nginx
H='Host: sentinela.arthlabs.dev'; U=http://127.0.0.1:8088/influx
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" "$U/health"                                          # 200
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" "$U/q/history?campo=ph&periodo=1h"                   # 200
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" "$U/q/history?campo=ph&periodo=2h"                   # 400
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" "$U/q/primeira"                                      # 200
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" -G "$U/query" --data-urlencode 'q=SHOW DATABASES'    # 404
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" -X POST "$U/api/v2/query?org=sentinela"              # 404
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" "$U/api/v2/buckets"                                  # 404
```

Desativar: `sudo rm /etc/nginx/sentinela.d/influx-proxy.conf && sudo nginx -t && sudo systemctl reload nginx`.

- Só os 5 endpoints `/influx/q/*` e `GET /influx/health` chegam ao InfluxDB; o resto de `/influx/` é
  404 (ou 403/400/413/429, conforme acima).
- Validado localmente com `nginx:1.22.1` (versão do Debian 12) e `influxdb:2.7.12`
  (`infra/tests/influx-proxy.test.sh`): cada endpoint devolve os valores esperados sobre 30 dias de
  dados semeados; parâmetros inválidos (aspas, barra, `;`, período fora da lista, device longo) 400;
  `/influx/query`, Flux e `/api/v2/*` 404; `q`, `u`/`p` e `Authorization` do cliente ignorados; as
  formas de OOM da revisão passadas como `q` não têm efeito; 4 exports simultâneos de 30 dias dão
  1 x 200 e 3 x 429; o InfluxDB continua de pé.

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
- **Senha MQTT do Telegraf**: `sudo /usr/local/sbin/mqtt-user.sh add svc/telegraf` (rotaciona e imprime a nova
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
   (passo 3, "Atualizar", com revisão do diff) e **instalar `infra/bin/mqtt-user.sh` como
   `/usr/local/sbin/mqtt-user.sh`** (`sudo install -o root -g root -m 0755`, ao lado do
   `stack-deploy.sh`; a VM não tem checkout do repositório e `provision-board.py` chama esse caminho
   via `sudo -n`). As cópias antigas não conhecem o serviço
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
   que ainda não existe. Por isso **todos os commits com escopo `(frontend)` ficam no topo do `dev`**
   e vão só no passo 11. Merge de `dev~N`, com
   `N = $(git log --format=%s main..dev | grep -c '(frontend)')`. Conferir antes do merge que os
   `N` commits do topo (`git log --oneline -N dev`) são exatamente os de escopo `(frontend)` e que
   `git diff --stat dev~N dev` só lista `src/`, `Dockerfile`, `nginx.conf` (o da imagem do site),
   `vite.config.js`, `README.md`, `.env.example` e os workflows `deploy.yml`/`pages.yml`. Se aparecer commit novo depois deles, reordenar antes. O push
   dispara o `stack.yml`: aprovar o "Deploy data stack" — é o primeiro deploy do broker, com o
   Telegraf **ainda no HiveMQ** (`.env` sem mudança de `MQTT_BROKER`; seção "Primeiro deploy com o
   broker", passos 1–2). O deploy do site que o mesmo push dispara publica o painel atual
   (inalterado).
5. **Provisionar** só `svc/telegraf` e `svc/ota` com `mqtt-user.sh add` (seção "Credenciais"). A
   senha de `svc/telegraf` vai para o cofre; o `.env` **ainda não** muda. As boias **não** são
   criadas aqui: cada placa ganha o serial e a credencial pelo `provision-board.py` (passo 8).
   Antes, aplicar `supabase/migrations/20261120_dispositivos.sql` (registro de dispositivos).
6. **Prova pública** com `infra/tests/mqtt_probe.py` a partir da workstation, pelo hostname
   público (precisa de `paho-mqtt==2.1.0` num venv; senhas só por variável de ambiente, nunca em
   argv). Rodar antes do passo 10: nada consome o broker novo ainda, então o marcador publicado
   pelo probe não chega ao Telegraf nem a painel.

   A boia ainda não tem credencial neste ponto (ela só nasce no passo 8), então a prova usa um
   usuário **temporário** `probe_tmp` (casa com a regex de device id, logo a ACL `%u/...` vale
   igual), removido ao fim:

   ```bash
   U=wss://mqtt.arthlabs.dev/mqtt
   # na VM: sudo /usr/local/sbin/mqtt-user.sh add probe_tmp   (copiar a senha só para o read abaixo)
   read -rs MQTT_FEED_PASS; export MQTT_FEED_PASS; MQTT_PASS=$MQTT_FEED_PASS; export MQTT_PASS   # senha do probe_tmp
   # anônimo lê a telemetria
   python3 infra/tests/mqtt_probe.py --url $U --sub probe_tmp/status --feeder probe_tmp --feeder-url $U --expect allowed
   # anônimo não publica
   python3 infra/tests/mqtt_probe.py --url $U --pub probe_tmp/status --observer - --obs-url $U --expect denied
   # o usuário publica no próprio prefixo, e só nele
   python3 infra/tests/mqtt_probe.py --url $U --user probe_tmp --pub probe_tmp/status --observer - --expect allowed
   python3 infra/tests/mqtt_probe.py --url $U --user probe_tmp --pub outra_boia/status --observer - --expect denied
   unset MQTT_PASS MQTT_FEED_PASS
   # na VM: sudo /usr/local/sbin/mqtt-user.sh del probe_tmp
   ```

   Exit 0 em todos = ACL pública conforme. Qualquer outro resultado: parar aqui.
7. **Banco e Edge Function cedo** (os dois são compatíveis com o painel atual: a coluna
   `arquivo_path` é nullable e a função não tem chamador até o passo 11): `pg_dump` do Supabase
   antes; aplicar `supabase/migrations/20261119_firmware_deploys_path.sql`; publicar a função
   `ota-command` com as quatro variáveis (seção "Edge Function"). Assim os testes de bancada de
   OTA e rollback do firmware 5.1.0 (`BENCH.md` do firmware) já rodam contra o broker novo.
8. **Boia: gravar o 5.1.0 por USB → `provision-board.py provision` → `snt-0001` → trocar o
   `deviceId` do SM-01 em produção → fechar os eventos de saúde do `esp_sururu` → BENCH.** Existe
   **uma** placa física (a boia, hoje `esp_sururu`). O 5.1.0 não tem mais `DEVICE_ID` nem
   `MQTT_PASSWORD` no `secrets.h`: a identidade vem da NVS, gravada pelo script (seção "Provisionar
   placa"). O 5.0.x só fala com o HiveMQ e não há OTA para o 5.1.0: é USB.
   1. Gravar o 5.1.0 por USB na boia.
   2. `provision-board.py provision --port <COM>`: a primeira placa recebe `snt-0001` (o SM-01).
   3. **Logo em seguida**, trocar o `deviceId` do SM-01 de `esp_sururu` para `snt-0001` no registro
      de **produção** (`app_settings.map_buoys`). A Edge Function `ota-command` acha a placa por esse
      campo (`findDeviceId(reg, boia_id)`): sem a troca, os OTAs de bancada do item 5 iriam para
      `esp_sururu/ota/command`. Backup da setting antes (na VM; guardar o caminho impresso):

      ```bash
      umask 077; F=~/map_buoys-$(date -u +%Y%m%dT%H%M%SZ).json
      sudo -n docker exec supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At \
        -c "SELECT value FROM public.app_settings WHERE key = 'map_buoys'" > "$F" \
        && test -s "$F" && echo "backup: $F"
      ```

      Depois, no painel de produção (o atual), editar o SM-01 e trocar o campo Device ID para
      `snt-0001`. O painel atual regrava a entrada só com `codigo`, `nome`, `lagoa`, `lat`, `lng` e
      `deviceId`: se o backup mostrar outras chaves na entrada do SM-01, trocar pelo SQL abaixo, que
      só mexe no `deviceId` e mantém o resto (imprime a entrada resultante):

      ```bash
      sudo -n docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
      UPDATE public.app_settings s
         SET value = (SELECT jsonb_agg(CASE WHEN e->>'codigo' = 'SM-01'
                                            THEN e || '{"deviceId": "snt-0001"}'
                                            ELSE e END ORDER BY ord)
                        FROM jsonb_array_elements(s.value) WITH ORDINALITY AS t(e, ord)),
             updated_at = now()
       WHERE s.key = 'map_buoys' AND jsonb_typeof(s.value) = 'array'
      RETURNING (SELECT e FROM jsonb_array_elements(s.value) e WHERE e->>'codigo' = 'SM-01') AS sm01;
      SQL
      ```

      O painel atual não conhece `deviceIdsAnteriores`: **daqui até o passo 11 o painel de produção
      mostra o SM-01 com histórico vazio** (as leituras antigas seguem no InfluxDB sob `esp_sururu`;
      nada se perde) e sem dados ao vivo (ele ainda lê o HiveMQ). O `esp_sururu` volta ao histórico
      no passo 11.
   4. **Logo depois da troca**, fechar os `sensor_health_events` abertos do `esp_sururu` (só agora:
      antes disso o worker ainda lista `esp_sururu` pelo registro e reabriria os eventos).
      Preservando o motivo original, com o `SELECT` antes do `UPDATE`:

      ```bash
      sudo -n docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
      SELECT id, sensor, estado, motivo, inicio FROM public.sensor_health_events
       WHERE device_id = 'esp_sururu' AND fim IS NULL;
      UPDATE public.sensor_health_events
         SET fim = now(), motivo = concat_ws(' | ', motivo, 'encerrado: migração para snt-0001')
       WHERE device_id = 'esp_sururu' AND fim IS NULL;
      SQL
      ```
   5. `BENCH.md` do 5.1.0 com a boia no broker novo. Os itens que usam o painel exigem o
      **frontend novo rodando local** (`npm run dev` na workstation, com
      `VITE_MQTT_BROKER_URL=wss://mqtt.arthlabs.dev/mqtt` no `.env.local`, contra o Supabase de
      produção): o painel em produção ainda é o atual. Conferir com uma assinatura anônima no WSS
      (`mqtt_probe.py --url wss://mqtt.arthlabs.dev/mqtt --sub snt-0001/status --receive
      --expect allowed`): `snt-0001/availability` = `online`, `snt-0001/status` com `firmware 5.1.0`.

   Os retidos de bancada **não** são limpos: não há como publicar como `snt-0001` sem a senha da
   placa, que só existe na NVS dela (rotacionar com `mqtt-user.sh add snt-0001` para isso deixaria a
   placa sem conectar; ver "Rotação da senha de uma placa"). O `snt-0001/availability` é reescrito
   pela própria placa a cada conexão, e o OTA de teste do passo 11 sobrescreve o
   `snt-0001/ota/status` retido.
9. **Do USB ao passo 11** o painel de produção mostra o SM-01 offline e sem histórico (passo 8,
   item 3) e o InfluxDB fica sem pontos novos até o passo 10: fazer 8 → 10 → 11 em sequência.
10. **Trocar o Telegraf** só depois que a boia estiver no broker novo (passo 8): `.env` com
    `MQTT_BROKER=tcp://mosquitto:1883`, `MQTT_TELEGRAF_USER=svc/telegraf`, `MQTT_TELEGRAF_PASS`
    e `sudo /usr/local/sbin/stack-deploy.sh none` (passo 3 de "Primeiro deploy com o broker").
    Conferir pontos novos no InfluxDB.
11. **Frontend:** trocar o secret `VITE_MQTT_BROKER_URL` do GitHub para
    `wss://mqtt.arthlabs.dev/mqtt` e **só então** fazer merge na `main` dos commits de
    frontend (o `dev` inteiro) e aprovar o deploy do site (o painel passa a ler anônimo e a mandar
    OTA pela Edge Function).

    **Com o painel novo no ar**, devolver o `esp_sururu` ao histórico do SM-01: o `deviceId` já é
    `snt-0001` (passo 8), então reabrir e salvar o SM-01 no painel **não** acrescenta nada (o painel
    só guarda o id antigo quando o `deviceId` muda). Fazer pelo SQL abaixo, que só acrescenta
    `deviceIdsAnteriores: ["esp_sururu"]` à entrada do SM-01 (só se o `deviceId` dela for
    `snt-0001`; repetir não duplica). Backup antes, com o mesmo comando do passo 8, item 3:

    ```bash
    sudo -n docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
    UPDATE public.app_settings s
       SET value = (SELECT jsonb_agg(CASE
                       WHEN e->>'codigo' = 'SM-01' AND e->>'deviceId' = 'snt-0001'
                            AND NOT COALESCE(e->'deviceIdsAnteriores', '[]') ? 'esp_sururu'
                       THEN e || jsonb_build_object('deviceIdsAnteriores',
                                    COALESCE(e->'deviceIdsAnteriores', '[]') || '["esp_sururu"]')
                       ELSE e END ORDER BY ord)
                      FROM jsonb_array_elements(s.value) WITH ORDINALITY AS t(e, ord)),
           updated_at = now()
     WHERE s.key = 'map_buoys' AND jsonb_typeof(s.value) = 'array'
    RETURNING (SELECT e FROM jsonb_array_elements(s.value) e WHERE e->>'codigo' = 'SM-01') AS sm01;
    SQL
    ```

    Conferir: a entrada impressa tem `"deviceId": "snt-0001"` e `"deviceIdsAnteriores":
    ["esp_sururu"]`; no painel, o modal de edição do SM-01 mostra "Seriais anteriores: esp_sururu" e
    o "Histórico de Coletas" volta a trazer as leituras antigas. Teste: OTA com versão descartável
    na própria placa (`snt-0001`, a única); ele também sobrescreve o `snt-0001/ota/status` retido
    da bancada.
12. **Apagar** os secrets `VITE_MQTT_USER` e `VITE_MQTT_PASS` do GitHub (a credencial HiveMQ
    estava no bundle público).
13. **Uma semana estável** → apagar o cluster HiveMQ (antes de 2026-12-31) e a credencial dele.

**Rollback (até o passo 12):** voltar `VITE_MQTT_BROKER_URL` para o HiveMQ e reverter os
commits `(frontend)` na `main` (`git revert` do mais novo para o mais antigo); voltar `MQTT_BROKER`/credencial do Telegraf no `.env` e `stack-deploy.sh none`;
boia: gravar por USB o backup 5.0.4 (fala com o HiveMQ). O broker pode ficar parado no compose
sem afetar o resto; a coluna `arquivo_path` e a função podem ficar (função sem chamador). Depois
do passo 13 não há volta ao HiveMQ.

- **Depois do passo 8, item 3** (o SM-01 já aponta para `snt-0001`), voltar ao 5.0.4 exige também
  voltar o `deviceId` do SM-01 para `esp_sururu`, senão painel e OTA procuram uma placa que não
  publica mais. Backup da setting antes (comando do passo 8, item 3) e então editar o SM-01 no
  painel que estiver no ar (Device ID = `esp_sururu`) ou rodar o SQL do passo 8, item 3, com
  `'{"deviceId": "esp_sururu"}'`. Restaurar um backup inteiro (desfaz também qualquer edição do
  registro feita depois dele; `F` = caminho impresso pelo backup):

  ```bash
  printf "UPDATE public.app_settings SET value = \$bkp\$%s\$bkp\$::jsonb, updated_at = now() WHERE key = 'map_buoys';\n" \
    "$(cat "$F")" | sudo -n docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1
  ```
- A linha `snt-0001` em `dispositivos`, o usuário `snt-0001` no broker e a NVS da placa podem
  ficar: o 5.0.4 ignora o namespace `ident` e a gravação por USB não apaga a NVS. Gravar de novo o
  5.1.0 por USB traz o `snt-0001` de volta sem reprovisionar.

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
3. **Só depois que a boia estiver no broker novo** (passo 8 do Rollout: 5.1.0 por USB + `provision-board.py`):
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

### Provisionar placa

Cada placa tem um **serial permanente** `snt-NNNN` (sequencial, nunca reaproveitado, nem depois de
`baixado`), atribuído por MAC e guardado na tabela `dispositivos` do Supabase (registro apenas:
painel e OTA não dependem dela). O serial é também o usuário MQTT. O firmware lê serial e senha da
NVS (namespace `ident`); o `secrets.h` só tem os valores comuns da frota (`WIFI_*`, `MQTT_URI`,
`OTA_URL_PREFIX`).

`infra/bin/provision-board.py` roda na **workstation com a placa no USB** e fala com a VM por
`ssh umj-sentinela` (chave, sem prompt; a VM precisa de `sudo -n` e do `/usr/local/sbin/mqtt-user.sh`
do passo 1 do Rollout). A senha MQTT sai do `mqtt-user.sh` direto para a serial da placa: não vai
para argv, tela, log nem arquivo.

**Windows (PowerShell):**

```powershell
py -3 -m pip install pyserial==3.5
# achar a porta: Gerenciador de Dispositivos > Portas (COM e LPT), ex.: COM5
py -3 infra\bin\provision-board.py ident --port COM5          # só lê serial/MAC/estado
py -3 infra\bin\provision-board.py provision --port COM5      # [--hardware ...] [--host ...]
py -3 infra\bin\provision-board.py unprov --port COM5         # limpa a identidade da placa
```

Fluxo do `provision`: `IDENT?` → se a placa já está provisionada, concilia registro e broker (ver "Falha depois do `OK`") e sai →
reserva o serial pelo MAC (`dispositivo_reservar`) → cria a credencial (`mqtt-user.sh add`) →
`PROV` → a placa reinicia → o script reconecta na mesma porta (até 60 s) e confere que ela voltou
com o serial → `dispositivo_marcar('provisionado')` → imprime o serial para a **etiqueta**: escrever
no case da placa. Fechar monitores seriais (Arduino IDE etc.) antes: a porta é exclusiva.

- **DTR/RTS:** o script os mantém em nível baixo ao abrir a porta, para não resetar a placa nem
  cair no bootloader. O único reset é o do firmware (~500 ms depois do `OK`); a porta USB pode
  sumir e voltar nesse momento, e o script reconecta sozinho. Verificado só no Windows (o caminho
  suportado); no Linux o comportamento de DTR/RTS ao abrir a porta **não** foi verificado.
- **Espera:** a placa pode levar ~30 s para atender o primeiro `IDENT?` (o `setup()` espera o Wi-Fi
  até 30 s); o script espera até 45 s no primeiro `ident` e até 60 s a placa voltar depois do `OK`.
- **Falha antes de a senha poder chegar à placa** (ex.: `ERR bad_password`, `ERR busy_provisioned`,
  falha do `mqtt-user.sh add`): o script desfaz (`mqtt-user.sh del`; libera a reserva só se a linha
  foi criada nesta execução) e sai com 1.
- **Senha enviada sem veredito** (timeout, erro de porta, `ERR save_failed`, Ctrl-C): o script
  imprime `Interrompido; verificando a placa (até 60 s). Ctrl-C de novo aborta e mantém credencial e
  reserva.` (ou `Sem veredito da placa; ...`), reconecta e pergunta `IDENT?`. Só desfaz se a placa
  responder `unprovisioned`. Se ela voltar com identidade, não voltar, ou vier um segundo Ctrl-C,
  **nada é desfeito** (o aviso diz `board state unknown`), exit 1.
- **Falha depois do `OK`** (placa não volta, Ctrl-C, registro não atualizou): **nada é desfeito**,
  porque a identidade já está na NVS da placa; credencial e reserva ficam, exit 1. Rodar `provision`
  de novo: ele concilia (placa provisionada + linha `reservado` + usuário no broker → marca
  `provisionado` e imprime a etiqueta); se a placa estiver `unprovisioned`, provisiona de novo com
  o mesmo serial. Sem linha, serial diferente ou usuário do broker ausente, sai com 1 e manda usar
  `unprov`.
- **Placa trocada no meio:** depois de cada reinício o script confere que o MAC é o mesmo do
  primeiro `IDENT?`. Se mudou, sai com 1 (`MAC changed across the restart (placa trocada?)`) sem
  desfazer nada: conferir com `ident` qual placa está em qual porta antes de repetir.
- **`unprov --port COM5`:** envia `UNPROV`, espera a resposta exata `OK`, espera a placa reiniciar e
  confere `unprovisioned`. Não mexe no registro nem no broker; o `provision` seguinte reaproveita o
  serial com senha nova. Se a placa responder `ERR clear_failed`, ela reinicia do mesmo jeito; o
  script mostra o estado real e sai com 1: rodar `unprov` de novo (persistindo, apagar a flash).
- **Apagar toda a flash** (ou `UNPROV`): a placa volta sem identidade, mas o MAC continua em
  `dispositivos`. Rodar `provision` de novo **reaproveita o mesmo serial** e gera senha nova
  (rotaciona a anterior).
- **Baixar uma placa** (perdida, descartada): `py -3 infra\bin\provision-board.py retire snt-NNNN`
  remove a credencial (`mqtt-user.sh del`, só se existir: pode ser repetido após falha parcial) e
  marca `baixado`; o serial não é reaproveitado e uma
  placa baixada não é provisionada de novo (`dispositivo_baixado`; `dispositivo_marcar` também
  recusa tirar uma linha de `baixado`). O `retire` **não derruba uma sessão já aberta** (o `SIGHUP`
  do `mqtt-user.sh` só vale para conexões novas): placa perdida ou roubada → depois do `retire`,
  `sudo docker restart <container do mosquitto>` (seção "Credenciais").
- Códigos de saída: 0 ok; 1 falha — se a senha não pode ter chegado à placa, tudo foi desfeito; se
  pode (placa aceitou, sem veredito, Ctrl-C), credencial e reserva ficaram e o próximo `provision`
  concilia (ver acima); 2 uso incorreto.

#### Rotação da senha de uma placa

A senha de uma placa só existe na NVS dela e no hash do broker. `mqtt-user.sh add snt-NNNN`
sozinho **quebra a placa**: o broker passa a esperar uma senha que ela não tem (`ERRO: MQTT
recusado rc=5`). Rotação (suspeita de vazamento, placa recuperada), com a placa no USB:

1. `provision-board.py unprov --port <COM>` (limpa a NVS; registro e broker intactos).
2. `provision-board.py provision --port <COM>`: reaproveita o serial pelo MAC, `mqtt-user.sh add`
   gera a senha nova e ela vai direto para a NVS.
3. Em suspeita de vazamento, `sudo docker restart <container do mosquitto>` para derrubar sessões
   abertas com a senha antiga.

O `provision` numa placa já provisionada (conciliação) **não valida a senha da placa contra o
broker**: confere só a linha do registro e a existência do usuário. Uma placa com senha errada
(ex.: alguém rodou `add` à mão) sai como `already provisioned; nothing to do`; o sintoma é o
`recusado rc=5` no Serial, e a correção é o `unprov` + `provision` acima.
- Teste: `infra/tests/provision.test.sh` (pytest com fakes, imagem `python:3.12.8-slim`).

### Credenciais (volume `sentinela-mosquitto-data`)

Os usuários vivem em `/mosquitto/data/passwd`, dentro do volume `sentinela-mosquitto-data`. Na
primeira partida o serviço cria o arquivo vazio (dono `mosquitto`, modo 600); depois nunca o
sobrescreve. Contas de serviço: `svc/telegraf` (subscribe) e `svc/ota` (publica `+/ota/command`);
cada boia usa o próprio device id como usuário.

Provisionamento com `infra/bin/mqtt-user.sh`, na VM, como operador com acesso ao Docker (`sudo`).
Só precisa de bash e docker. O container é achado pelos labels do compose
(`project=sentinela-stack`, `service=mosquitto`); `MQTT_CONTAINER` sobrescreve.

```bash
sudo /usr/local/sbin/mqtt-user.sh add <usuario>   # imprime a senha UMA vez (40 caracteres aleatórios)
sudo /usr/local/sbin/mqtt-user.sh del <usuario>
sudo /usr/local/sbin/mqtt-user.sh list            # só nomes, nunca hashes
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
3. Boias: **não** usar `add` à mão; `provision-board.py provision` (seção "Provisionar placa") cria o
   usuário `snt-NNNN` e grava a senha direto na NVS da placa. `secrets.h` não leva mais senha.

**Rotação e vazamento:** o `SIGHUP` recarrega `passwd` e ACL, mas vale para **novas** conexões; uma
sessão já aberta com a senha antiga não é derrubada pelo HUP (não verificado se o broker a
reavalia; tratar como mantida). Em suspeita de vazamento: `add <usuario>` e depois
`sudo docker restart <container do mosquitto>` para derrubar as sessões abertas (as boias
reconectam sozinhas; as retidas persistem em `/mosquitto/data`). Para o `svc/telegraf`, atualizar
o `.env` e rodar `stack-deploy.sh none` antes ou logo depois, senão o Telegraf é recusado. Para uma
**boia** (`snt-NNNN`), `add` sozinho a deixa sem conectar: seguir "Rotação da senha de uma placa".

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
