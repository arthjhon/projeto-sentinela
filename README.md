# 🛡️ Projeto Sentinela

> **Monitoramento contínuo da qualidade da água e preservação do ecossistema estuarino.**
> Plataforma tecnológica dedicada à conservação ambiental das lagoas Mundaú e Manguaba — Complexo Estuarino Mundaú-Manguaba (CEMM), Alagoas, Brasil.

![Status](https://img.shields.io/badge/Status-Ativo-success)
![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-B73BFE?style=flat&logo=vite&logoColor=FFD62E)
![License](https://img.shields.io/badge/Licença-MIT-blue)

<br/>

## 📌 Sobre o Projeto

O **Projeto Sentinela** é uma iniciativa de monitoramento ambiental voltada à análise e telemetria da qualidade da água nos estuários alagoanos. Por meio de sensores remotos instalados em bóias flutuantes, o sistema coleta dados em campo e os apresenta em uma plataforma web interativa — protegendo e assegurando a saúde do ecossistema aquático local.

O projeto tem foco especial no *Mytella charruana* (sururu) — molusco bivalve essencial para o equilíbrio ecológico do CEMM, para a economia regional e para a subsistência de milhares de famílias riberinhas de Maceió e região.

Além do monitoramento estuarino, a plataforma é projetada para suportar também ambientes de **aquicultura** (tanques de tilápia, camarão, entre outros) e **coletas de campo** assistidas por dados.

<br/>

## ✨ Funcionalidades

### 🌊 Portal Público — Landing Page

- **Interface Imersiva (Dark Mode):** Design premium com estética *Glassmorphism*, inspirado pelo ecossistema aquático das lagoas.
- **Painel Analítico Interativo:** Visualizações gráficas dos parâmetros de qualidade da água, com suporte à comparação de dados entre as duas lagoas em tempo real.
- **Seção Educacional:** Conteúdo sobre o ciclo de vida do sururu, a importância biológica do estuário e o impacto ambiental monitorado pelo projeto.

### ⚙️ Painel de Operações — Admin Dashboard

- **Autenticação Integrada:** Sistema de login protegendo rotas e recursos administrativos sensíveis.
- **Monitor Técnico:** Visão panorâmica com métricas gerais do sistema e integridade dos dispositivos de campo.
- **Gerenciador de Bóias (CRUD Completo):**
  - Adicionar, editar e remover bóias de sensoriamento da rede.
  - Consultar histórico bruto de coletas e geolocalização exata de cada leitura.
- **Modo de Manutenção:** Interface dedicada para disparo manual de testes (*ping*) nas sondas (temperatura, turbidez, pH) e registro formal de ocorrências como defeitos e trocas de bateria.

<br/>

## 🚀 Stack Tecnológica

| Tecnologia | Uso |
|---|---|
| **React.js** | Frontend e gerenciamento de estados (`useState`, `useEffect`, `Context API`, `Portals`) |
| **Vite.js** | Build e ambiente de desenvolvimento com compilação ultrarrápida |
| **React Router DOM** | Roteamento de páginas e navegação SPA |
| **Lucide React** | Biblioteca de ícones leves e consistentes |
| **CSS Vanilla (Design System próprio)** | Sistema de design autoral com Flexbox, CSS Grid, variáveis CSS (`:root`) e animações via `@keyframes` — sem frameworks externos |

### 🖧 Arquitetura de Dados (Cloud & IoT)

| Tecnologia | Componente |
|---|---|
| **Supabase (PostgreSQL)** | Banco de dados relacional em nuvem encarregado da segurança. Protege as rotas, detém o sistema nativo de Autenticação Edge e tabela de perfis (RBAC). Substituiu o armazenamento local. |
| **Microcontrolador ESP32** | Cérebro embarcado nas bóias responsável pela coleta via sensores. |
| **Broker MQTT (HiveMQ)** | Estrutura de mensageria leve para tráfego contínuo e pub/sub de telemetria estuarina. |
| **InfluxDB** | Banco de dados Time-Series (alta capacidade temporal) para abrigar o volume massivo histórico da água. |

<br/>

## 🛠️ Rodando Localmente

Pré-requisitos: **Node.js v18+** e **npm**.

```bash
# 1. Clone o repositório
git clone https://github.com/arthjhon/projeto-sentinela.git

# 2. Entre no diretório
cd projeto-sentinela

# 3. Instale as dependências
npm install

# 4. Inicie o servidor de desenvolvimento
npm run dev
```

O app estará disponível em `http://localhost:5173`.

> **⚠️ Acesso ao painel administrativo**
> A rota `/admin` está disponível para desenvolvedores locais, mas está totalmente protegida via API.
> As credenciais de acesso para desenvolvimento estão atreladas aos Cofres do Supabase listados abaixo.

<br/>

## ☁️ Configurando o Backend (Supabase)

O painel administrativo do Projeto Sentinela requer um projeto Cloud no Supabase para rodar a Gestão de Usuários com segurança.

1. Crie uma conta e um projeto gratuito no [Supabase Platform](https://supabase.com/).
2. Copie suas credenciais secretas em *Project Settings -> API*.
3. Na raiz do projeto, crie o arquivo `.env.local` e injete o motor:
   ```env
   VITE_SUPABASE_URL="https://[sua-referencia].supabase.co"
   VITE_SUPABASE_ANON_KEY="sua_chave_publica_jwt..."
   ```
4. **Desabilite E-mails de Confirmação:** Vá em *Authentication* -> *Providers* -> Selecione *Email* e DESLIGUE as travas `Confirm email` e `Secure email change`. (Isso é obrigatório pois o painel utiliza domínios virtuais como `@sentinela.app` para forjar Operadores).
5. **Esquema de Dados:** Abra a aba *SQL Editor* no painel esquerdo do Supabase, cole o código contido no arquivo `supabase_schema.sql` (na raiz do projeto) e clique em RUN.
6. **Primeiro Acesso (Bootstrap):** Crie o seu usuário Mestre (*Admin*) manualmente ali mesmo no Supabase indo no botão lateral *Authentication -> Add User*. Coloque seu e-mail verdadeiro e crie uma senha. O Trigger que você ativou no passo cinco assinará sua carteira de administrador no mesmo instante para você entrar na aplicação!

<br/>

## 📡 Sensores Suportados

| Parâmetro | Unidade | Aplicação |
|---|---|---|
| Temperatura | °C | Lagoas e aquicultura |
| Turbidez | NTU | Lagoas e coletas de campo |
| pH | — | Lagoas, aquicultura e coletas |

> Novos parâmetros (oxigênio dissolvido, salinidade etc.) serão integrados em versões futuras.

<br/>

## 🗺️ Roadmap

- [x] Landing Page com painel analítico
- [x] Admin Dashboard com CRUD de bóias
- [x] Modo de manutenção e log de ocorrências
- [ ] Integração real do Frontend com a API do banco **InfluxDB** e broker MQTT.
- [ ] Suporte a ambientes de aquicultura (tanques)
- [ ] Módulo de coletas de campo assistidas
- [ ] Alertas automáticos por parâmetros fora do padrão

<br/>

## 🤝 Contribuindo

Contribuições são bem-vindas! Para propor melhorias:

1. Faça um *fork* do projeto
2. Crie uma branch: `git checkout -b feature/minha-melhoria`
3. Faça o commit: `git commit -m "feat: minha melhoria"`
4. Faça o push: `git push origin feature/minha-melhoria`
5. Abra um *Pull Request*

<br/>

## 👨‍💻 Autor

Desenvolvido por **Arthur Jhonathas**.

> *"A tecnologia como termômetro vital em prol do meio ambiente e do desenvolvimento sustentável."*

<br/>

## 📄 Licença

Este projeto está licenciado sob a [MIT License](LICENSE).