# Projeto Sentinela

> **Monitoramento contínuo da qualidade da água e preservação do ecossistema estuarino.**
> Plataforma IoT dedicada à conservação ambiental das lagoas Mundaú e Manguaba — Complexo Estuarino Mundaú-Manguaba (CEMM), Alagoas, Brasil.

![Versão](https://img.shields.io/badge/Versão-0.2.0-blue)
![Status](https://img.shields.io/badge/Status-Ativo-success)
![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-B73BFE?style=flat&logo=vite&logoColor=FFD62E)
![License](https://img.shields.io/badge/Licença-MIT-blue)

<br/>

## Sobre o Projeto

O **Projeto Sentinela** é uma iniciativa de monitoramento ambiental voltada à telemetria em tempo real da qualidade da água nos estuários alagoanos. Bóias flutuantes equipadas com microcontroladores ESP32 coletam dados de campo continuamente e os transmitem via MQTT para uma plataforma web interativa.

O projeto tem foco especial no *Mytella charruana* (sururu) — molusco bivalve essencial para o equilíbrio ecológico do CELMM, para a economia regional e para a subsistência de milhares de famílias riberinhas. A plataforma também é projetada para suportar ambientes de **aquicultura** (tanques de tilápia, camarão e outros organismos aquáticos cujo manejo exige monitoramento frequente da água).

<br/>

## Funcionalidades

### Portal Público

- **Landing Page imersiva** com design Dark Mode e estética Glassmorphism
- **Seção "O que observamos no estuário"** — os indicadores que definem a saúde das lagoas com faixa de referência (CONAMA 357), marcando os três que a bóia já mede (temperatura, pH, turbidez) e os planejados (OD, salinidade, coliformes) — sem leituras inventadas
- **Painel de Monitoramento** com gráficos em tempo real via MQTT (temperatura, pH, turbidez)
- **Mapa interativo** (CartoDB Dark Matter) com as bóias na posição cadastrada no painel, anéis de área de coleta e status **real** de cada bóia via LWT (`<deviceId>/availability`) — "Ao vivo" só quando a placa está de fato conectada, não quando o navegador está
- **Seção "Vida Marinha"** com ilustração SVG animada do ecossistema da lagoa (bóia SM-01, peixes, leito de sururu, badges de dados)
- **Página de Equipe** (links para as redes de cada membro), **Apoiadores** (UMJ e Kode.Lab) e **Apoie o Projeto**
- Design totalmente responsivo (desktop → tablet → mobile)

### Painel Administrativo

- **Autenticação** com controle de acesso por papel (admin / operador / visualizador) via Supabase
- **Dashboard** com métricas gerais do sistema e integridade dos dispositivos, **seletor de bóia** ("Todas as Bóias" mostra a média da frota nos cards de temperatura, pH e turbidez) e contagem real da frota
- **Histórico persistido** — gráfico por janela de tempo (1h / 24h / 7d / 30d) lido do
  InfluxDB, somado às leituras que continuam chegando por MQTT em tempo real
- **Exportação CSV** das leituras do período selecionado, pronta para abrir no Excel
- **Gerenciador de Bóias** — CRUD completo: cadastro, edição e remoção. Cada bóia tem **lagoa, latitude, longitude, modo (bancada/campo) e número de série da placa** editáveis no painel. Trocar a placa de uma bóia não exige deploy: o número antigo fica em "seriais anteriores" e o histórico continua unido
- **Ficha da bóia** (`/admin/boias/<código>`) — uma página por bóia com:
  - identificação, dispositivo (conexão, firmware, sinal, memória, cada valor com a idade do dado) e saúde de cada sensor com a última calibração;
  - uma **linha do tempo única** de manutenção, calibração, firmware, saúde e cadastro, com filtro por tipo.
- **Gestão de Operadores** — criação e remoção de usuários (exclusivo para admins). A remoção revoga o acesso de verdade, pela Edge Function `admin-delete-user`
- **Auditoria** — log append-only das ações do painel, restrito a admin e operador. O nome do autor é gravado pelo servidor, então não dá para forjar
- **OTA Firmware** — atualização remota sem acesso físico: o painel envia o `.bin` e uma função de servidor publica o comando para a placa (ver "Fluxo OTA")
- **Status** — saúde da plataforma (Supabase, broker, InfluxDB, ingestão, worker) e uma tabela das bóias com link para cada ficha
- **Configurações** — dados simulados (mock), meta de financiamento e **raio de coleta** desenhado ao redor das bóias no mapa público

<br/>

## Stack Tecnológica

### Frontend

| Tecnologia | Uso |
|---|---|
| **React.js** | Interface, estados e Context API |
| **Vite.js** | Build e ambiente de desenvolvimento |
| **React Router DOM** | Roteamento SPA |
| **Recharts** | Gráficos de série temporal (telemetria em tempo real) |
| **Lucide React** | Biblioteca de ícones |
| **CSS Vanilla (Design System próprio)** | Flexbox, Grid, variáveis CSS e `@keyframes` — sem frameworks externos |

### Infraestrutura IoT & Cloud

| Tecnologia | Componente |
|---|---|
| **ESP32-S3 (Heltec WiFi LoRa 32 V3)** | Microcontrolador das bóias, firmware 5.1.x. Coleta sensorial e transmissão MQTT sobre WebSocket com TLS. Número de série e senha MQTT ficam na NVS da placa, nunca no código |
| **Mosquitto (Broker MQTT próprio)** | Mensageria pub/sub para telemetria e comandos OTA, na VM, exposto só por Cloudflare Tunnel em `mqtt.arthlabs.dev`. Duas portas públicas: `/mqtt` (navegadores, anônimo e só leitura, até 150 conexões) e `/dev` (placas e a função de OTA, só com senha, até 20 conexões), mais rate limiting por IP na Cloudflare |
| **Edge Functions (Supabase)** | `ota-command` publica o comando de OTA (só admin); `admin-create-user`, `admin-delete-user` e `admin-reset-password` gerenciam operadores |
| **Worker (Python)** | Coleta Open-Meteo e ANA (HidroWebService), detector de falha de sensor e status da plataforma |
| **Supabase (PostgreSQL)** | Autenticação, RBAC, perfis de usuário e storage de firmware (.bin) |
| **Telegraf** | Ingestão MQTT → InfluxDB: assina os tópicos e grava cada leitura, de forma declarativa (`telegraf/telegraf.conf`) |
| **InfluxDB** | Banco de dados time-series para histórico massivo de leituras |

<br/>

## Sensores Suportados

| Parâmetro | Unidade | Aplicação |
|---|---|---|
| Temperatura | °C | Lagoas e aquicultura |
| Turbidez | NTU | Lagoas e coletas de campo |
| pH | — | Lagoas, aquicultura e coletas |
| Oxigênio Dissolvido | mg/L | Lagoas e aquicultura *(planejado)* |
| Salinidade / Condutividade | ppt / µS | Aquicultura *(planejado)* |
| Coliformes termotolerantes | NMP/100 mL | Lagoas — cultivo de moluscos *(planejado)* |

As faixas de referência usadas nos selos (Saudável / Atenção / Crítico) e na página pública seguem a **Resolução CONAMA 357/2005 (águas salobras)** e ficam em `src/config/waterQuality.js`.

<br/>

## Fluxo OTA (Over-the-Air Firmware Update)

```
Admin envia o .bin no painel → Supabase Storage (SHA-256 calculado no navegador)
     ↓  registro em firmware_deploys (pendente)
Painel chama a Edge Function ota-command (confere no servidor que quem chamou é admin)
     ↓
Função publica <série>/ota/command { url, version, sha256 } com a conta svc/ota, pela porta /dev
     ↓
Placa baixa por HTTPS, confere SHA-256 e cabeçalho da imagem, grava no outro slot e reinicia
     ↓  reporta em <série>/ota/status (downloading → flashing → success | error)
Imagem nova fica pendente: só é confirmada quando o broker confirma uma publicação (PUBACK)
e a inscrição em ota/command (SUBACK). Sem isso, a placa volta sozinha à imagem anterior
no 3º boot ou com 15 min no ar
```

- **Sem credencial no navegador:** o painel não publica nada no broker. Ele lê de forma anônima e só leitura.
- **Imagem pendente:** enquanto a imagem nova não é confirmada, a placa recusa outro OTA (`unconfirmed_image`).
- **Sem resposta:** um deploy `pendente` com mais de 15 min aparece como "sem resposta".
- **Status retido:** só o `ota/status` da bóia do deploy em curso muda o estado do formulário. O último status **retido** no broker, de um OTA anterior, aparece apenas no card da frota e não trava um novo deploy.
- **Teste em produção:** o fluxo foi testado de ponta a ponta na SM-01 em 23/11/2026, com dois OTAs (`5.1.1-teste` e `5.1.2`), ambos confirmados em cerca de 1 minuto.

<br/>

## Identidade das placas e provisionamento

Cada placa tem um **número de série permanente** `snt-NNNN` (sequencial, nunca reaproveitado) e uma **senha MQTT própria**, gravados na NVS por USB pelo `infra/bin/provision-board.py`.

- O script reserva o serial pelo MAC na tabela `dispositivos`, cria o usuário no broker (`infra/bin/mqtt-user.sh`) e manda a senha direto para a placa. A senha não aparece em tela, log nem arquivo.
- O firmware 5.1.x não tem identificador nem senha no código. O `secrets.h` só leva Wi-Fi, o endereço do broker (`wss://mqtt.arthlabs.dev:443/dev`) e o prefixo de download de firmware.
- As credenciais do broker vivem só no volume `sentinela-mosquitto-data`, com backup diário (03:40 UTC, 14 cópias).

Passo a passo, rotação de senha e restauração: `infra/README.md` (seções "Broker MQTT", "Provisionar placa" e "15b").

<br/>

## Deploy & Alta Disponibilidade

### Produção
O site roda em **`sentinela.arthlabs.dev`**, servido por nginx numa VM da UMJ por trás de um **Cloudflare Tunnel** (sem expor portas). O deploy é automático: todo push na branch `main` dispara o GitHub Actions (`deploy.yml`), que **builda no próprio runner** (`npm ci` + `vite build`, com as variáveis `VITE_*` vindas dos *secrets* do repositório) e envia só o `dist/` para a VM por **rsync** — o runner entra na tailnet via `tailscale/github-action` e usa uma chave SSH presa por `rrsync` ao diretório do site (sem shell no servidor). Nada é compilado na VM.

Secrets esperados pelo workflow: `TAILSCALE_AUTHKEY`, `SSH_KEY_UMJ_RSYNC`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_MQTT_BROKER_URL` e, opcional, `VITE_CARTO_BASEMAPS_KEY`.

### Failover (GitHub Pages + Cloudflare Worker)
Para resiliência, uma cópia estática do site é publicada no **GitHub Pages** a cada push na `main` (workflow `pages.yml`). Um **Cloudflare Worker** fica na frente do domínio e faz o roteamento:

```
Visitante → sentinela.arthlabs.dev (Cloudflare Worker)
   ├─ VM no ar  → origem real (tunnel → VM)            → site completo
   └─ VM caída  → GitHub Pages (estático) + banner     → modo limitado
```

O Worker testa a origem real (`origin-sentinela.arthlabs.dev`); se a VM estiver indisponível (timeout ou erro 5xx/52x), serve o build do GitHub Pages e injeta um banner de aviso.

> **Modo limitado:** como o backend (Supabase self-hosted) roda na mesma VM, durante uma queda permanecem ativas apenas as **páginas públicas** (estáticas). O broker MQTT (Mosquitto próprio) roda na mesma VM, então o **monitoramento em tempo real** também para quando a VM cai. **Login e painel administrativo** ficam indisponíveis até a VM voltar — o banner sinaliza isso ao visitante.

<br/>

## Rodando Localmente

Pré-requisitos: **Node.js v18+** e **npm**.

```bash
# 1. Clone o repositório
git clone https://github.com/arthjhon/projeto-sentinela.git

# 2. Entre no diretório
cd projeto-sentinela

# 3. Instale as dependências
npm install

# 4. Configure as variáveis de ambiente (veja seção abaixo)

# 5. Inicie o servidor de desenvolvimento
npm run dev
```

O app estará disponível em `http://localhost:5173`.

Com Supabase e broker locais, defina `DEV_SUPABASE_PROXY` e `DEV_MQTT_PROXY` no `.env.local` (exemplo no
`.env.example`): o `npm run dev` passa a repassar o Supabase e o MQTT pela própria porta 5173 e falha em
vez de trocar de porta se ela estiver ocupada.

> **Acesso ao painel administrativo**
> A rota `/admin` está totalmente protegida via Supabase Auth.
> Crie seu usuário mestre pelo passo 6 da configuração abaixo.

<br/>

## Configurando o Backend (Supabase)

1. Crie uma conta e um projeto gratuito em [supabase.com](https://supabase.com/).
2. Copie suas credenciais em *Project Settings → API*.
3. Crie o arquivo `.env.local` na raiz do projeto:
   ```env
   VITE_SUPABASE_URL="https://[sua-referencia].supabase.co"
   VITE_SUPABASE_ANON_KEY="sua_chave_publica_jwt"
   ```
4. **Desabilite confirmação por e-mail:** *Authentication → Providers → Email* → desligue `Confirm email` e `Secure email change`.
5. **Esquema de dados:** No *SQL Editor* do Supabase, execute os arquivos abaixo, na ordem (todos são idempotentes — podem ser re-executados sem erro):
   1. `supabase_schema.sql` — esquema base (perfis, papéis, RLS inicial).
   2. `supabase_ota_schema.sql` — histórico de deploys de firmware OTA.
   3. `supabase_backlog_schema.sql` — manutenção, calibração de sensores, log de auditoria e `app_settings` (configurações genéricas usadas por outras features, incluindo a data oficial do changelog abaixo).
   4. `supabase_changelog_schema.sql` — tabela e bucket de Storage do changelog público (`/evolucao`). Depende de `app_settings` (arquivo 3) já existir para o contador de dias funcionar — ver nota no cabeçalho do próprio arquivo.
   5. `supabase_profiles_rls_fix.sql` — trava a auto-escalada de role e habilita edição de operador por um admin. Sem este arquivo, qualquer usuário autenticado pode se promover a admin via API direta.
   6. `supabase_visualizador_rls_fix.sql` — restringe escrita em `maintenance_logs`, `sensor_calibrations`, `firmware_deploys` e `audit_logs` a `role IN ('admin', 'operador')`. Sem este arquivo, qualquer usuário autenticado (inclusive `visualizador`) pode escrever nessas tabelas.
6. **Primeiro acesso:** Crie seu usuário administrador em *Authentication → Add User*, depois rode no SQL Editor: `UPDATE public.profiles SET role = 'admin' WHERE id = '<uuid-do-usuario-criado>';` (o trigger do schema sempre cria o perfil como `visualizador` por padrão — nunca confia em metadata do cliente para decidir role, por segurança).

<br/>

## Configurando o Histórico (InfluxDB)

O gráfico de histórico e a exportação CSV leem do InfluxDB. A ingestão é feita
pelo **Telegraf**, que assina os tópicos MQTT e grava cada leitura — não há
backend próprio no caminho.

1. Suba a stack de dados (na raiz do repositório, não neste diretório):
   ```bash
   docker compose up -d influxdb telegraf
   ```
2. Crie um token **somente-leitura** com escopo no bucket, e não use o token de
   admin (ele permite escrita e exclusão):
   ```bash
   docker exec <container-influx> influx auth create \
     --org "$INFLUXDB_ORG" --read-bucket "<id-do-bucket>" \
     --description "sentinela-frontend-read"
   ```
3. Acrescente ao `.env.local`:
   ```env
   # SEM prefixo VITE_ de propósito — ver aviso abaixo
   INFLUXDB_URL="http://<host-do-influx>:8086"
   INFLUXDB_READ_TOKEN="token_somente_leitura"
   ```

> **Por que `INFLUXDB_READ_TOKEN` não tem prefixo `VITE_`**
> O Vite injeta *apenas* variáveis `VITE_*` no bundle — e esse bundle é servido
> a qualquer visitante, inclusive no site público. Um token com prefixo `VITE_`
> viraria credencial pública.
> O navegador chama apenas `/influx/q/<nome>` (consultas InfluxQL nomeadas, só GET)
> e quem anexa o token é o proxy, no servidor: o middleware `/influx/q/*` do
> `vite.config.js` em desenvolvimento, o nginx do host
> (`infra/nginx/sentinela-influx-proxy.conf`) em produção. A imagem Docker do
> frontend não faz proxy do InfluxDB.
> **Renomear essa variável para `VITE_INFLUX_READ_TOKEN` vaza o token.**

### Dev local: dados da ANA (`/admin/contexto`)

A página de contexto ambiental lê chuva/vazão/nível do bucket `externos` (consulta `ana`, `db=externos`).
No InfluxDB local, com o token de admin em `INFLUX_TOKEN` (lido com `read -rs`, nunca na linha de comando):

```bash
C=<container-influx>; O="$INFLUXDB_ORG"
docker exec -e INFLUX_TOKEN "$C" influx bucket create --org "$O" --name externos --retention 0
EXT=$(docker exec -e INFLUX_TOKEN "$C" influx bucket list --org "$O" --name externos --json | jq -r '.[0].id')
IOT=$(docker exec -e INFLUX_TOKEN "$C" influx bucket list --org "$O" --name iot --json | jq -r '.[0].id')
docker exec -e INFLUX_TOKEN "$C" influx v1 dbrp create --org "$O" --db externos --rp autogen --bucket-id "$EXT"
# token temporário de escrita só para o backfill (não é impresso)
W=$(docker exec -e INFLUX_TOKEN "$C" influx auth create --org "$O" --write-bucket "$EXT" \
      --description ana-backfill-local --json | jq -r '.token')
```

O backfill roda na imagem do worker. `ANA_HIDRO_USER`/`ANA_HIDRO_PASS` vêm do **ambiente** (exportados
a partir de um arquivo 600 seu), nunca da linha de comando; o env-file é temporário (`mktemp` cria 600):

```bash
docker build -q -t sentinela-worker:dev worker
E=$(mktemp)
printf '%s\n' INFLUX_URL=http://127.0.0.1:8086 "INFLUX_ORG=$O" "INFLUX_WORKER_TOKEN=$W" ANA_SOURCE=hidrowebservice \
  "ANA_HIDRO_USER=$ANA_HIDRO_USER" "ANA_HIDRO_PASS=$ANA_HIDRO_PASS" PG_WORKER_DSN=nao-usado > "$E"
docker run --rm --network host --env-file "$E" sentinela-worker:dev python -m sentinela_worker backfill-ana --start 2026-05-01
shred -u "$E"; unset W
# depois: apagar o token temporário (influx auth list --json | jq ... "ana-backfill-local", auth delete --id)
```

Por fim, o `INFLUXDB_READ_TOKEN` do `.env.local` precisa ler **`iot` e `externos`** (o token do passo 2
só lê `iot`; sem `externos` a consulta `ana` devolve erro de autorização): crie outro com
`influx auth create --org "$O" --read-bucket "$IOT" --read-bucket "$EXT" --description sentinela-frontend-read`
e troque o valor no `.env.local` (faça cópia do arquivo antes).

<br/>

## Configurando o Mapa (CARTO Basemaps)

O mapa de `/monitoramento` usa o estilo **CartoDB Dark Matter**, que desde 2026 exige uma
chave — sem ela os tiles chegam com a marca d'água "API KEY REQUIRED". A chave é gratuita
e não pede conta: informe um e-mail em [carto.com/basemaps/apikey](https://carto.com/basemaps/apikey)
(5M requisições/mês para uso não comercial) e acrescente ao `.env.local`:

```env
VITE_CARTO_BASEMAPS_KEY="sua_chave"
```

Sem a variável o mapa cai automaticamente no **Esri World Dark Gray** (sem cadastro). A chave vai
para o bundle público — restrinja-a ao domínio do site no painel do CARTO. A atribuição
"© OpenStreetMap contributors © CARTO" (ou "© Esri") é exigida pelas licenças e fica visível no mapa.

<br/>

## Roadmap

### Concluído
- [x] Landing page com design imersivo
- [x] Painel de monitoramento com gráficos em tempo real (MQTT + Recharts)
- [x] Admin dashboard com CRUD de bóias
- [x] Autenticação e controle de acesso por papéis (admin / operador)
- [x] Gestão de operadores
- [x] OTA firmware via MQTT + Supabase Storage
- [x] Design responsivo (mobile-first)
- [x] Ilustração SVG animada do ecossistema estuarino
- [x] Mapa interativo de localização das bóias
- [x] Página de Apoiadores do projeto
- [x] Pipeline de deploy automatizado (GitHub Actions + cloudflared)
- [x] Versionamento de firmware (v0 original → v1 bugfix → v2 OTA → … → v5.1.x modular, ESP32-S3)
- [x] **Persistência histórica no InfluxDB** — toda leitura publicada no MQTT é
      gravada via Telegraf, então o histórico sobrevive a reinício da stack e
      deixa de depender do buffer em memória da sessão
- [x] **Seletor de período no histórico** (1h / 24h / 7d / 30d) — consulta o
      InfluxDB pela janela escolhida, somando as leituras que continuam
      chegando por MQTT em tempo real
- [x] **Exportação CSV do histórico** — respeita o período selecionado e sai
      com dados brutos (sem a agregação usada no gráfico), no formato pt-BR
      (`;` e decimal com vírgula) que o Excel abre com duplo clique
- [x] **Changelog público** (`/evolucao`) — timeline de marcos e novidades
      curados pelo admin, com marcos automáticos de "dias monitorando"
      calculados a partir de uma data oficial definida no painel
- [x] **Faixas de referência por parâmetro nos cards** (verde / amarelo / vermelho)
      no dashboard admin, com selo Saudável/Atenção/Crítico
- [x] **Log de auditoria das ações do painel** — aba em `/admin/operadores`,
      append-only (sem policy de update/delete, nem para admin)
- [x] **Conta demo somente leitura** (role `visualizador`) — navega o painel
      admin completo sem conseguir alterar nada, protegido por RLS
- [x] **Cadastro dinâmico de bóias** — posição no mapa, lagoa e `deviceId` de cada
      bóia editáveis no painel (`map_buoys` em `app_settings`, sem migration);
      mapa, dashboard, OTA e página pública assinam os tópicos do registro em
      tempo de execução — troca de hardware sem deploy
- [x] **Status real das bóias via LWT** — o indicador "Ao vivo" lê
      `<deviceId>/availability` publicado pelo firmware (retido), em vez da
      conexão do navegador com o broker; uma placa desligada aparece offline
      mesmo com o site conectado
- [x] **Seletor de bóia e média da frota** no Centro de Comando
- [x] **OTA robusto** — status retido de um OTA anterior não trava o formulário
      nem fecha um deploy novo; só a bóia do deploy em curso muda o estado
- [x] **Raio de coleta configurável** (Configurações) com piso visual para os
      anéis não sumirem atrás do marcador no zoom inicial
- [x] **Mapa com CartoDB Dark Matter + chave** e fallback Esri; atribuição visível
- [x] **Pipeline de deploy na VM da UMJ** — build no runner e rsync via Tailscale
      (chave SSH restrita por `rrsync`)
- [x] **Página inicial honesta** — seção de parâmetros explicativa (faixas de
      referência CONAMA 357, "Monitorado pela bóia" vs. "Planejado"), sem
      leituras simuladas de sensores que não existem
- [x] **Stack de dados em produção** (21/11/2026) — InfluxDB, Telegraf e worker
      (Open-Meteo, ANA, detector de falha de sensor, status da plataforma) na VM
- [x] **Broker MQTT próprio** (23/11/2026) — saída do HiveMQ Cloud; Mosquitto na VM
      exposto só pelo túnel, navegador anônimo e só leitura, credencial do HiveMQ
      removida do código público e dos secrets
- [x] **Número de série e provisionamento das placas** — `snt-NNNN` + senha por placa
      na NVS; a SM-01 é a `snt-0001`
- [x] **OTA pelo servidor com rollback automático** — Edge Function `ota-command`;
      testado de ponta a ponta em 23/11/2026 (firmware 5.1.2 em produção)
- [x] **Portas separadas no broker e rate limiting** — `/dev` só para dispositivos
      (vagas próprias), `/mqtt` para navegadores, limite por IP na Cloudflare
- [x] **Backup diário do volume do broker** (`mosquitto-backup.timer`)
- [x] **Painel admin revisado** — segurança (auditoria que não dá para forjar, exclusão
      de operador que revoga acesso), telas enxutas e **ficha da bóia** com linha do
      tempo única

### Próximos passos

#### Observabilidade
- [ ] Dashboard Grafana público para transparência dos dados sem necessidade de login
- [ ] Retenção e downsampling configurável no InfluxDB

#### Alertas
- [ ] Alertas automáticos por parâmetros fora do padrão (webhook + cooldown)
- [ ] Notificações por e-mail e/ou WhatsApp para a equipe em casos críticos
- [ ] Calibração remota de sensores via MQTT

#### Dados e Relatórios
- [ ] Índice de Qualidade da Água (WQI) na página pública
- [ ] Exportação de dados em PDF para relatórios acadêmicos

#### Hardware e Campo
- [ ] Módulo 4G/LTE (SIM7600) — conectividade direta em campo, sem dependência de Wi-Fi
- [ ] Sensores EZO-DO (oxigênio dissolvido) e EZO-EC (salinidade/condutividade)
- [ ] Modelagem e impressão 3D da case IP67 das bóias
- [ ] Módulo de coletas de campo assistidas por GPS

#### Aquicultura
- [ ] Suporte completo a ambientes de aquicultura (tanques de tilápia, camarão, etc.)

<br/>

## Contribuindo

Contribuições são bem-vindas! Para propor melhorias:

1. Faça um *fork* do projeto
2. Crie uma branch: `git checkout -b feature/minha-melhoria`
3. Commit: `git commit -m "feat: minha melhoria"`
4. Push: `git push origin feature/minha-melhoria`
5. Abra um *Pull Request*

<br/>

## Equipe

Desenvolvido por pesquisadores da **Engenharia da Computação — Centro Universitário Mário Pontes Jucá (UMJ)**.

| Membro | Papel |
|---|---|
| **Arthur Jhonathas** | Engenheiro de Infraestrutura & IoT |
| **Maycon Vinicius** | Desenvolvedor de Firmware |
| **Anwar Quirino** | Desenvolvedor de Firmware |
| **Luiz Henrique** | Engenheiro de Hardware |
| **Pedro Henrique** | Engenheiro de Hardware |
| **Marcos Paulo** | Analista de Documentação Técnica |

Com o apoio do **Kode.Lab UMJ**, laboratório de desenvolvimento de software da instituição.

> *"A tecnologia como termômetro vital em prol do meio ambiente e do desenvolvimento sustentável."*

<br/>

## Licença

Este projeto está licenciado sob a [MIT License](LICENSE).
