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
- **Painel de Monitoramento** com gráficos em tempo real via MQTT (temperatura, pH, turbidez, oxigênio dissolvido)
- **Seção "Vida Marinha"** com ilustração SVG animada do ecossistema da lagoa (bóia SM-01, peixes, leito de sururu, badges de dados)
- **Página de Equipe**, **Apoiadores** (com logo UMJ) e **Apoie o Projeto**
- Design totalmente responsivo (desktop → tablet → mobile)

### Painel Administrativo

- **Autenticação** com controle de acesso por papel (admin / operador) via Supabase
- **Dashboard** com métricas gerais do sistema e integridade dos dispositivos
- **Histórico persistido** — gráfico por janela de tempo (1h / 24h / 7d / 30d) lido do
  InfluxDB, somado às leituras que continuam chegando por MQTT em tempo real
- **Exportação CSV** das leituras do período selecionado, pronta para abrir no Excel
- **Gerenciador de Bóias** — CRUD completo: cadastro, edição, remoção e histórico de leituras
- **Gestão de Operadores** — criação e remoção de usuários (exclusivo para admins)
- **OTA Firmware** — envio de atualização de firmware para o ESP32 via MQTT, sem acesso físico ao hardware

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
| **ESP32** | Microcontrolador embarcado nas bóias — coleta sensorial e transmissão MQTT |
| **HiveMQ (Broker MQTT)** | Mensageria pub/sub para telemetria contínua e comandos OTA |
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
| Oxigênio Dissolvido | mg/L | Lagoas e aquicultura *(em integração)* |
| Salinidade / Condutividade | ppt / µS | Aquicultura *(planejado)* |

<br/>

## Fluxo OTA (Over-the-Air Firmware Update)

```
Admin faz upload do .bin → Supabase Storage
     ↓
Admin aciona "Enviar OTA" no painel
     ↓
Backend publica via MQTT: sentinela/buoy/{id}/ota/command
     ↓
ESP32 recebe a URL do firmware, faz download e se reflasha via HTTPUpdate
     ↓
ESP32 reinicia com o novo firmware e confirma via MQTT
```

<br/>

## Deploy & Alta Disponibilidade

### Produção
O site roda em **`sentinela.arthlabs.dev`**, servido a partir da VM por trás de um **Cloudflare Tunnel** (sem expor portas). O deploy é automático: todo push na branch `main` dispara o GitHub Actions (`deploy.yml`), que builda no servidor e publica o `dist/`.

### Failover (GitHub Pages + Cloudflare Worker)
Para resiliência, uma cópia estática do site é publicada no **GitHub Pages** a cada push na `main` (workflow `pages.yml`). Um **Cloudflare Worker** fica na frente do domínio e faz o roteamento:

```
Visitante → sentinela.arthlabs.dev (Cloudflare Worker)
   ├─ VM no ar  → origem real (tunnel → VM)            → site completo
   └─ VM caída  → GitHub Pages (estático) + banner     → modo limitado
```

O Worker testa a origem real (`origin-sentinela.arthlabs.dev`); se a VM estiver indisponível (timeout ou erro 5xx/52x), serve o build do GitHub Pages e injeta um banner de aviso.

> **Modo limitado:** como o backend (Supabase self-hosted) roda na mesma VM, durante uma queda permanecem ativos apenas as **páginas públicas** e o **monitoramento em tempo real** (MQTT/HiveMQ, externo). **Login e painel administrativo** ficam indisponíveis até a VM voltar — o banner sinaliza isso ao visitante.

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
   # Identificadores públicos: o cliente precisa deles para montar a query Flux
   VITE_INFLUX_ORG="sentinela"
   VITE_INFLUX_BUCKET="iot"

   # SEM prefixo VITE_ de propósito — ver aviso abaixo
   INFLUXDB_URL="http://<host-do-influx>:8086"
   INFLUXDB_READ_TOKEN="token_somente_leitura"
   ```

> **Por que `INFLUXDB_READ_TOKEN` não tem prefixo `VITE_`**
> O Vite injeta *apenas* variáveis `VITE_*` no bundle — e esse bundle é servido
> a qualquer visitante, inclusive no site público. Um token com prefixo `VITE_`
> viraria credencial pública.
> O navegador chama `/influx/...` e quem anexa o token é o proxy, no servidor:
> `server.proxy` do `vite.config.js` em desenvolvimento, `location /influx/` do
> `nginx.conf` em produção (preenchido por `envsubst` no boot do container).
> **Renomear essa variável para `VITE_INFLUX_READ_TOKEN` vaza o token.**

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
- [x] Versionamento de firmware (v0 original → v1 bugfix → v2 OTA)
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

**Orientador:** Prof. Pedro Henrique de Meneses Bittencourt Lopes — Engenharia Mecatrônica & Matemática

> *"A tecnologia como termômetro vital em prol do meio ambiente e do desenvolvimento sustentável."*

<br/>

## Licença

Este projeto está licenciado sob a [MIT License](LICENSE).
