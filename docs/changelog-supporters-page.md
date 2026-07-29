# Changelog — SupportersPage

**Branch:** `dev`
**Commit:** `4640658`
**Data:** 2026-05-01

---

## Arquivos alterados

| Arquivo | Tipo |
|---|---|
| `src/pages/public/SupportersPage.jsx` | Modificado |
| `src/pages/public/SupportersPage.css` | Modificado |
| `public/kodelab-white.png` | Adicionado |
| `public/kodelab-text-white.png` | Adicionado |

---

## Alterações realizadas

### 1. Adição do KodeLab UMJ como apoiador

- Novo card no padrão `umj-card` posicionado após Teranex
- Logo composta: ícone (`kodelab-white.png`) empilhado sobre o texto (`kodelab-text-white.png`)
- Estilizado com `.kodelab-logo-wrap`, `.kodelab-icon-img` e `.kodelab-text-img`
- Largura do bloco fixada em 96×96px para alinhar com os demais logos

### 2. Substituição da seção "Fomentadores em Tecnologia e Infraestrutura"

A seção antiga (3 cards genéricos: Fabricantes IoT, Redes e Conectividade, Órgãos Ambientais Locais) foi removida e substituída por três novas seções:

#### Impacto dos Apoiadores
Grid de 4 cards com métricas do projeto:
- **3** Bóias Ativas
- **+500** Leituras por Dia
- **6+** Meses de Monitoramento
- **1** Ecossistema Protegido

#### Áreas de Atuação
Grid 2×2 com ícones Lucide, descrevendo as frentes sustentadas pelos apoiadores:
- Pesquisa Acadêmica
- Hardware & Sensoriamento
- Conectividade & Cloud
- Monitoramento Ambiental

#### Como Apoiar
Grid 2×2 com formas de parceria para novos apoiadores:
- Parceria Tecnológica
- Patrocínio Financeiro
- Apoio Institucional
- Mentoria Técnica

### 3. Largura da página aumentada

- `max-width` alterado de `900px` para `1100px`, alinhando com `MonitoringPage`

### 4. CSS reorganizado

- Removidas classes obsoletas (`.supporters-grid`, `.supporter-card`)
- Adicionadas: `.sp-section`, `.sp-section-title`, `.impact-grid`, `.impact-card`, `.impact-number`, `.impact-label`, `.areas-grid`, `.area-card`
- Breakpoints responsivos mantidos em `@media (max-width: 600px)`
