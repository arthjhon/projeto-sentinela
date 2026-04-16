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

O projeto tem foco especial no *Mytella charruana* (sururu) — molusco bivalve essencial para o equilíbrio ecológico do CEMM, para a economia regional e para a subsistência de milhares de famílias riberinhas. A plataforma também é projetada para suportar ambientes de **aquicultura** (tanques de tilápia, camarão e outros organismos aquáticos cujo manejo exige monitoramento frequente da água).

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
5. **Esquema de dados:** No *SQL Editor* do Supabase, execute o arquivo `supabase_schema.sql` da raiz do projeto.
6. **Primeiro acesso:** Crie seu usuário administrador em *Authentication → Add User*. O trigger do schema assinará automaticamente o papel `admin`.

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

### Próximos passos
- [ ] Módulo 4G/LTE (SIM7600) — conectividade direta em campo, sem dependência de Wi-Fi
- [ ] Sensores EZO-DO (oxigênio dissolvido) e EZO-EC (salinidade/condutividade)
- [ ] Modelagem e impressão 3D da case IP67 das bóias
- [ ] Suporte completo a ambientes de aquicultura (tanques de tilápia, camarão, etc.)
- [ ] Alertas automáticos por parâmetros fora do padrão
- [ ] Módulo de coletas de campo assistidas por GPS

<br/>

## Contribuindo

Contribuições são bem-vindas! Para propor melhorias:

1. Faça um *fork* do projeto
2. Crie uma branch: `git checkout -b feature/minha-melhoria`
3. Commit: `git commit -m "feat: minha melhoria"`
4. Push: `git push origin feature/minha-melhoria`
5. Abra um *Pull Request*

<br/>

## Autor

Desenvolvido por **Arthur Jhonathas** — Engenharia da Computação, Centro Universitário Mário Pontes Jucá (UMJ).

> *"A tecnologia como termômetro vital em prol do meio ambiente e do desenvolvimento sustentável."*

<br/>

## Licença

Este projeto está licenciado sob a [MIT License](LICENSE).
