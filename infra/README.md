# Infra — Sentinela

## MQTT ACL (pré-requisito)

Antes de subir a stack de dados, o broker HiveMQ Cloud precisa separar as permissões por
credencial (spec §7.3). A configuração é manual, no Access Management do cluster; o script
abaixo apenas verifica o resultado.

### O que o painel publica hoje

Levantado com `rg -n "\.publish\(" src` (o único ponto de publicação é o wrapper
`publish` do hook; a única página que o chama é a de OTA):

- `src/hooks/useMqtt.js:126` — `clientRef.current.publish(topic, msg)` (wrapper genérico)
- `src/pages/admin/OtaPage.jsx:219` — `publish(cmdTopic, cmd)`, com
  `cmdTopic = <deviceId>/ota/command` (`OtaPage.jsx:215`)

Não há publicação de ping no código atual.

### Credenciais

- **Credencial do browser (existente):** perde publish em `+/sensores`, `+/status` e
  `+/availability`. Mantém publish em `+/ota/command` (e subscribe como hoje).
- **Credencial do Telegraf (nova):** somente subscribe em `+/sensores` e `+/status`,
  sem nenhum publish.

As credenciais ficam fora do git (cofre/variáveis de ambiente).

### Verificação

```bash
read -rs MQTT_PASS; export MQTT_PASS   # fora do histórico do shell e do argv
infra/bin/mqtt-acl-check.sh <broker_host> <user> <device_id>
```

A senha é lida da variável de ambiente obrigatória `MQTT_PASS` (sem ela, exit 2).

Publica `{"ph":0}` em `<device_id>/sensores` com MQTT v5 / QoS 1 (porta 8883, TLS) e
interpreta a resposta do broker:

| Saída | Exit | Significado |
| --- | --- | --- |
| `ACL OK: publish rejected` | 0 | o broker negou o publish (esperado para a credencial do browser) |
| `ACL FAIL: publish accepted` | 1 | o broker aceitou o publish |
| `error: ...` | 2 | uso incorreto ou falha de conexão/autenticação (resultado inconclusivo) |

Sanidade: rodar com a credencial do device deve imprimir `ACL FAIL`. Atenção: o teste com a
credencial do device publica de fato uma leitura `{"ph":0}` no tópico do device informado;
use um `device_id` de teste.

Usa `mosquitto_pub` do PATH ou, se ausente, a imagem `eclipse-mosquitto:2.0.22` via docker.
O `mosquitto_pub` não recebe a senha na linha de comando: ela vai num arquivo de
configuração temporário com modo 600, removido ao sair; no fallback docker o arquivo é
montado somente leitura no container. O script em si também não recebe a senha por
argumento. Limitação: o arquivo existe brevemente em disco.

Teste local do script (broker mosquitto descartável, sem tocar em broker real):

```bash
infra/tests/mqtt-acl-check.test.sh
```

## Stack de dados na VM — runbook

Fluxo do deploy (spec §7.7):

```text
CI (main) --rsync, chave 1 (rrsync -wo)--> /srv/sentinela/stack-incoming/   (dono: sentinela-deploy)
CI (main) --ssh, chave 2 (forced command)--> sudo /usr/local/sbin/stack-deploy.sh <sha|none>   (root)
stack-deploy.sh: confere o incoming -> copia para staging root -> checagem textual do compose
  -> render único (docker compose config) -> política do deploy + validate-compose.sh
  -> pull -> releases/<id> -> current aponta para ele -> up -> healthchecks
  -> DEPLOYED, .previous <- .current antigo, .current <- release nova
  (falhou -> current volta ao .current, revalidado, e sobe de novo)
```

Layout em `/srv/sentinela/stack/` (root 750; só o root escreve):

```text
.env                          root 600; nunca tocado pelo script
releases/<UTC>-<pid>/         uma por tentativa: compose.yml, telegraf/telegraf.conf,
                              rendered.json (JSON validado, 600), DEPLOYED (só se ficou saudável)
current  -> releases/<id>     o que foi iniciado por último
.current -> releases/<id>     último bom conhecido: só muda depois do healthcheck
.previous -> releases/<id>    o último bom antes desse
compose.yml -> current/compose.yml   telegraf -> current/telegraf   DEPLOYED -> .current/DEPLOYED
```

Toda troca é o `rename` de um symlink (atômico): `compose.yml` e `telegraf.conf` mudam juntos, e uma
queda em qualquer ponto deixa `.current`/`DEPLOYED` numa release que estava saudável. O deploy
seguinte avisa (`an earlier deploy did not finish`) e segue normalmente. Releases sem ponteiro são
apagadas. O script ignora SIGPIPE/SIGHUP e erros de escrita no stdout: a queda da sessão SSH do CI
não interrompe o deploy no meio.

O CI envia **exatamente** dois arquivos: `compose.yml` e `telegraf/telegraf.conf`. Qualquer outro
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
docker volume ls | grep sentinela-influxdb                  # ver nota do passo 8
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
- `from="100.64.0.0/10"`: só endereços Tailscale (CGNAT).
- Verificado em container Debian 12 (OpenSSH 9.2, sudo 1.9.13p3; sem o `from=`, por ser local): a
  chave 1 só escreve no incoming (leitura e shell recusados pelo rrsync); a chave 2 só executa o
  script, com `none`/40-hex; `none none`, `*`, `none;id` e `$(id)` são negados pelo sudo.
- O CI deve enviar com `rsync -r --delete` um diretório contendo só os dois arquivos.

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

### 6b. Environment `production` no GitHub (segredos do deploy)

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
- Os workflows (Task 5) referenciam `environment: production` no job de deploy. Ao migrar o
  `deploy.yml`, mover também `TAILSCALE_AUTHKEY` e `SSH_KEY_UMJ_RSYNC` para o environment e apagar
  as versões de repositório.

### 7. `.env` da stack

```bash
sudo install -o root -g root -m 600 /dev/null /srv/sentinela/stack/.env
sudoedit /srv/sentinela/stack/.env      # nomes em infra/stack/.env.example
```

- Segredos novos: `openssl rand -hex 32`.
- Valor com `$`: entre aspas simples (`KEY='a$b'`), senão o compose interpola.
- Proibido: linhas `COMPOSE_*` e `DOCKER_*` (o script recusa).
- `INFLUX_TELEGRAF_TOKEN`: placeholder (ex. `pendente-bootstrap`) até o passo 9.
- `INFLUX_WORKER_TOKEN`, `PG_WORKER_DSN`: placeholder até existir o worker. `SUPABASE_NETWORK`
  vazio até o worker (vazio = nenhuma rede externa permitida).
- O stdout do script (que o CI vê) não traz nada derivado do compose renderizado nem das
  mensagens do validador/política: só rótulos fixos, contagens (`validator: denied (N
  violation(s))`, `policy: denied (N violation(s))`), nomes de serviço da lista fixa (`influxdb`,
  `telegraf`, `worker`) e nomes de arquivo do incoming. As mensagens completas (que podem conter
  valores do `.env`) e a saída do compose vão só para o log do host
  (`/var/log/sentinela-stack-deploy.log`, root 600), sem máscara. O validador escapa caracteres de
  controle (`\n` vira o texto `\n`), então cada violação ocupa uma linha só no log.

### 8. Primeiro deploy

Nota: se `sentinela-influxdb-data` já existir na VM (dados antigos), o InfluxDB ignora os
`DOCKER_INFLUXDB_INIT_*` e o `INFLUX_ADMIN_TOKEN` do `.env` tem de ser o token admin já existente.

Primeiro deploy à mão (o CI faz o mesmo depois):

```bash
cat infra/stack/compose.yml | sudo -u sentinela-deploy tee /srv/sentinela/stack-incoming/compose.yml >/dev/null
sudo -u sentinela-deploy install -d -m 755 /srv/sentinela/stack-incoming/telegraf
cat infra/stack/telegraf/telegraf.conf | sudo -u sentinela-deploy tee /srv/sentinela/stack-incoming/telegraf/telegraf.conf >/dev/null
sudo /usr/local/sbin/stack-deploy.sh none
sudo cat /srv/sentinela/stack/DEPLOYED
sudo tail -n 50 /var/log/sentinela-stack-deploy.log
```

Saída 0 = implantado; 1 = negado (nada mudou) ou falhou (rollback tentado); 2 = argumento inválido.
O log (`/var/log/sentinela-stack-deploy.log`, root 600) guarda a saída do compose e as mensagens
completas do validador; o stdout (que o CI vê) só traz passos e a contagem de violações. Para
ver o motivo de um `denied`: `sudo grep -E 'validate\||policy DENY' /var/log/sentinela-stack-deploy.log | tail`.

### 9. Buckets e tokens (`influx-bootstrap.sh`)

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
| `nginx-publico` | read `iot` | `/etc/nginx/sentinela-influx-token.conf` (só se o proxy for ativado, passo 10b) |
| `backup` | operator (exigido por `influx backup`) | `/usr/local/etc/sentinela/influx-backup.token` |

```bash
sudoedit /srv/sentinela/stack/.env                     # telegraf e worker
sudo /usr/local/sbin/stack-deploy.sh none              # recria o telegraf com o token novo
sudo docker logs --since 2m sentinela-stack-telegraf-1 2>&1 | grep -iE 'error|401' || echo ok
```

O token `backup` é de operador (mesmo poder do admin) e existe só para poder ser revogado sem
mexer no admin; fica apenas no arquivo do timer.

### 10. nginx

O vhost versionado sai com o proxy `/influx/` **desligado**: todo `/influx/` responde 404 até o
Arthur decidir a mitigação do SSRF (passo 10b). Os blocos do proxy ficam em
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

### 10a. Proxy `/influx/` — risco de SSRF

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

### 10b. Ativar o proxy (só depois da decisão acima)

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

### 11. Backup (timer systemd)

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

### 12. Proteção de branch na `main`

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

### 13. Worker (tarefa futura): restrições que o deploy exige

- Imagem só `ghcr.io/arthjhon/sentinela-worker:${WORKER_TAG}` (40-hex; o CI passa o SHA como
  argumento, `none` mantém o implantado).
- Pull do GHCR: pacote público dispensa credencial (preferível; a imagem não deve conter segredo).
  Se for privado, `docker login ghcr.io` como root com um token **só de leitura de pacotes** e com
  validade: fine-grained PAT com permissão Packages: read, se o GHCR já aceitar fine-grained na
  data da instalação (até a redação deste runbook o registry exigia PAT clássico); senão PAT
  clássico com o escopo único `read:packages`. Entrar sem eco nem histórico:
  `read -rs T; printf '%s' "$T" | sudo docker login ghcr.io -u arthjhon --password-stdin; unset T`.
  O token fica em base64 (não cifrado) em `/root/.docker/config.json`: usar um credential helper
  (`docker-credential-pass`) ou, no mínimo, validade curta e rotação periódica (passo 14).
- Na rede do Supabase: `cap_drop: [ALL]` e anexo **vazio** (`networks: { supabase: {} }`; sem
  `aliases`, `ipv4_address`, `mac_address`, prioridades); rede top-level
  `supabase: { external: true, name: ${SUPABASE_NETWORK} }`; `SUPABASE_NETWORK` preenchido no `.env`.
- `hostname`/`container_name`, se usados, começam com `sentinela-`.
- Sem bind mount (a política do deploy só aceita bind somente leitura dos arquivos do conjunto
  esperado); config embutida na imagem. Sem `env_file`: `environment: { KEY: ${KEY} }`.
- No `compose.yml`: sem `\`, sem `!`, e sem as palavras `env_file`, `label_file`, `include`,
  `extends`, nem em comentário.
- Recomendado: `read_only: true`, `user` não-root, `security_opt: [no-new-privileges:true]`,
  `mem_limit: 384m`, healthcheck (o deploy espera `healthy`).

### 14. Rotação de segredos

- **Token Influx** (`telegraf`, `worker`, `nginx-publico`, `backup`):
  ```bash
  sudo -i
  C=$(docker ps -q --filter label=com.docker.compose.project=sentinela-stack --filter label=com.docker.compose.service=influxdb)
  read -rs INFLUX_TOKEN; export INFLUX_TOKEN          # admin
  ID=$(docker exec -e INFLUX_TOKEN "$C" influx auth list --json | jq -r '.[] | select(.description=="telegraf") | .id')
  docker exec -e INFLUX_TOKEN "$C" influx auth delete --id "$ID" >/dev/null
  /usr/local/sbin/influx-bootstrap.sh                 # recria só o que falta e imprime o novo
  ```
  Atualizar o destino (tabela do passo 9) e aplicar: `.env` → `stack-deploy.sh none`; include do
  nginx → `nginx -t && systemctl reload nginx`; arquivo do backup → nada. Entre o `delete` e a
  aplicação o consumidor recebe 401 (Telegraf reenvia o buffer; site sem histórico por instantes).
- **Senha MQTT do Telegraf**: trocar no HiveMQ, depois `.env` e `stack-deploy.sh none`.
- **`INFLUX_ADMIN_TOKEN`**: só vale no setup inicial. Para trocar, criar outro token de operador
  (`influx auth create --operator --description admin-<data>`), pôr no `.env`, testar, apagar o
  antigo. O container guarda o token antigo na config do CLI (`/etc/influxdb2/influx-configs`).
- **Chaves SSH do CI**: gerar par novo, trocar a linha em `authorized_keys` (passo 5) e o secret
  do environment `production` (passo 6b).
- **Token do GHCR** (se o pacote for privado): gerar novo antes de expirar, `docker login` de novo
  como root (passo 13), revogar o antigo no GitHub.
- **Chave de host da VM** (se regenerada): refazer o passo 6.

### 15. Rollback

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
  sudo /usr/local/sbin/stack-deploy.sh <sha-do-.previous|none>
  ```
- **Parar a stack** (nunca `down -v`: apagaria os volumes de dados):
  ```bash
  sudo docker compose -p sentinela-stack -f /srv/sentinela/stack/current/rendered.json down
  ```
- **Dados**: restaurar backup (passo 11). **nginx**: passo 10.
- Diagnóstico: `sudo tail -n 100 /var/log/sentinela-stack-deploy.log`,
  `sudo docker compose -p sentinela-stack ps -a`, `sudo ls -l /srv/sentinela/stack/`.

### Testes locais (workstation)

```bash
bash infra/tests/validate-compose.test.sh   # política do validador
bash infra/tests/stack-deploy.test.sh       # deploy ponta a ponta (projeto sentinela-stack-test)
bash infra/tests/influx-ops.test.sh         # bootstrap + backup em InfluxDB descartável
```

O teste do deploy roda como usuário comum com `SENTINELA_DEPLOY_ROOT=<tmp>` (prefixo de todos os
caminhos; ignorado como root), usa volumes `sentinela-stack-test_*` e remove só o que criou; nunca
toca nos volumes `sentinela-influxdb-*` da máquina.
