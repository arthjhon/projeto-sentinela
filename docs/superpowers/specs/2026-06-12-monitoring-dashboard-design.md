# Dashboard de Monitoramento — Design

**Data:** 2026-06-12
**Página alvo:** `src/pages/public/MonitoringPage.jsx` (portal público)

## Contexto e objetivo

A página de Monitoramento hoje mostra: cards de KPI (temperatura, pH, turbidez), **um** gráfico de área (1 parâmetro por vez, via abas), um seletor de bóias e o mapa. Os dados chegam em tempo real por MQTT.

Objetivo: transformá-la numa **dashboard pública e didática** — qualquer pessoa que acessa entende a saúde da lagoa de relance — com **vários tipos de gráfico**. Foco numa **bóia única** (a principal com hardware, SM-01), já que ainda não há uma segunda bóia implantada.

## Fontes de dados (reais, já trafegando por MQTT)

O ESP32 (firmware v2) publica em dois tópicos:
- **`<deviceId>/sensores`**: `{ "turbidez": float, "ph": float, "temperatura": float }`
- **`<deviceId>/status`**: `{ "rssi": float, "free_heap": float, "total_heap": float, "uptime": float, "mqtt_latency": ulong, "firmware": string }`

O hook `useMqtt` (`src/hooks/useMqtt.js`) já assina ambos via `getMqttTopics(['sensores','status'])`. **Nada de firmware novo** — tudo é derivado desses payloads + cálculos no front. Bateria vem do `fleet.js` (estático, por enquanto).

## Escopo

### Incluído (visualizações)
1. **KPIs** (já existe) — temperatura, pH, turbidez (cards).
2. **Velocímetro — Índice de Qualidade da Água (WQI)** — score 0–100 + rótulo BOA/REGULAR/RUIM.
3. **Semáforo por parâmetro** — cartão colorido (verde/amarelo/vermelho) + linguagem simples ("saudável"/"atenção"/"crítico").
4. **Linha temporal com faixa saudável** — série histórica com zona verde sombreada (vê na hora se saiu do ideal).
5. **Linha interativa** — multiparâmetro com: alternar séries (legenda clicável), crosshair/tooltip rico, zoom por intervalo (brush) e pausar/retomar tempo real.
6. **Saúde do dispositivo** — bateria (rosca), RSSI, memória livre, uptime, latência MQTT, firmware (do tópico `/status`).
7. **Barras mín/máx/média** — por parâmetro, na janela da sessão.
8. **Histograma** — distribuição das leituras (parâmetro selecionável).
9. **Mapa / Digital Twin** (já existe) — apenas SM-01.

### Fora de escopo
- Seletor de múltiplas bóias e faixa de frota (removidos — bóia única).
- Radar e medidores radiais (anéis) — não selecionados.
- Histórico persistido/long-term (InfluxDB) — a dashboard usa a janela da sessão ao vivo.
- Oxigênio dissolvido / salinidade — não estão no payload atual (futuro).
- Faixas de tempo (1m/5m/30m) e exportar CSV/PNG — não selecionados.

## Arquitetura

Decompor a página em **componentes focados** (responsabilidade única, dados por props) em `src/components/monitoring/`. A `MonitoringPage` vira orquestradora: conecta MQTT, mantém o histórico e distribui os dados.

### Componentes novos (`src/components/monitoring/`)
| Componente | Responsabilidade | Base |
|---|---|---|
| `WaterQualityIndex.jsx` | Velocímetro 0–100 + rótulo BOA/REGULAR/RUIM | Recharts RadialBarChart (semicírculo) |
| `SemaphoreCards.jsx` | Status colorido + texto simples por parâmetro | CSS |
| `ThresholdLineChart.jsx` | Linha temporal com faixa verde sombreada | Recharts AreaChart + ReferenceArea |
| `InteractiveChart.jsx` | Multiparâmetro: toggle de séries, crosshair, brush/zoom, pausar | Recharts LineChart + Brush + Legend custom |
| `DeviceHealth.jsx` | Bateria (rosca) + RSSI/uptime/latência/memória/firmware | Recharts RadialBarChart + stats |
| `MinMaxAvgBars.jsx` | Barras mín/máx/média por parâmetro | Recharts BarChart |
| `Histogram.jsx` | Distribuição das leituras (parâmetro selecionável) | Recharts BarChart |

Mantidos/extraídos: header, cards de KPI (podem ser extraídos para `MetricCards.jsx`), `InteractiveMap` (já existe).

### Config central — `src/config/waterQuality.js`
Fonte única de verdade das faixas e da lógica. Exporta:
- `WATER_PARAMS`: por parâmetro (`temperatura`, `ph`, `turbidez`) — `label`, `unit`, `decimals`, `color`, `icon`, e `thresholds` (faixas ideal/atenção/crítico, ver abaixo).
- `classifyParam(key, value)` → `'good' | 'warning' | 'critical'` (+ texto amigável).
- `computeWQI(reading)` → `{ score: 0..100, level: 'BOA'|'REGULAR'|'RUIM', color }`.
- `sessionStats(history)` → `{ [key]: { min, max, avg } }`.
- `histogramBins(history, key, nBins)` → array de bins para o BarChart.

Todas **funções puras** (sem React) → testáveis isoladamente.

### Faixas saudáveis (CONAMA 357 — águas estuarinas, ajustáveis)
| Parâmetro | 🟢 Ideal | 🟡 Atenção | 🔴 Crítico |
|---|---|---|---|
| pH | 6.5 – 8.5 | 6.0–6.5 ou 8.5–9.0 | < 6.0 ou > 9.0 |
| Temperatura | 22 – 30 °C | 30–32 ou 18–22 | > 32 ou < 18 |
| Turbidez | ≤ 40 NTU | 40 – 100 NTU | > 100 NTU |

### Algoritmo do WQI
Para cada parâmetro, calcular um sub-score 0–100 conforme a proximidade do ideal:
- Dentro do **ideal** → 100.
- Na faixa de **atenção** → interpola linearmente entre 100 (borda do ideal) e 50 (borda do crítico).
- No **crítico** → interpola de 50 (borda) decaindo até 0 conforme se afasta.

WQI = média dos sub-scores. Classificação: **BOA** ≥ 75 (verde) · **REGULAR** 50–74 (amarelo) · **RUIM** < 50 (vermelho).

## Fluxo de dados

- `MonitoringPage` resolve a bóia: `const buoy = FLEET.find(b => b.deviceId)` (SM-01). Sem seletor/faixa de frota.
- `useMqtt(getMqttTopics(['sensores','status']))` → `messages`, `connected`.
- `latestData = messages['<deviceId>/sensores']`; `latestStatus = messages['<deviceId>/status']`.
- Estado `history`: últimas **~120** leituras de sensores (sobe de 30 → 120 p/ alimentar histograma/zoom). Cada ponto: `{ time, temperatura, ph, turbidez }`.
- Estado `paused`: quando `true`, congela a entrada de novos pontos no `history` (não derruba o MQTT).
- Deriva e passa por props: `latestData`, `latestStatus`, `history`, e WQI/stats via `waterQuality.js`.
- `InteractiveChart` mantém estado local de séries visíveis (toggle) e a janela do brush.

## Layout (responsivo, mobile-first)

Ordem vertical (grid que colapsa p/ 1 coluna no mobile):
1. Contexto da bóia (SM-01 · status ao vivo · coordenadas)
2. KPIs + Velocímetro (WQI)
3. Semáforo por parâmetro
4. Gráfico interativo (largura cheia)
5. Linha temporal com faixa saudável
6. Barras mín/máx/média + Histograma (lado a lado em desktop)
7. Saúde do dispositivo
8. Mapa

Estilo: segue o design system existente (`MonitoringPage.css`, glass/dark mode). Cada componente novo traz seu CSS próprio (`<Componente>.css`) ou seções em `MonitoringPage.css`.

## Testes

- **Unitários** (`waterQuality.js`): `computeWQI`, `classifyParam`, `sessionStats`, `histogramBins` — funções puras, fáceis de cobrir. Se não houver runner configurado, adicionar **Vitest** (leve, integra com Vite) só para esses utilitários.
- **Visual/manual**: rodar `npm run dev` contra a homolog; observar a dashboard com dados ao vivo ou simulados (publicar payloads de teste no tópico). Conferir: cores do semáforo/velocímetro mudando com os limites, faixa verde da linha, pausar congelando, zoom/toggle do gráfico interativo, saúde do device populando do `/status`.

## Riscos / observações

- **Sem dados** (bóia sem sinal): todos os widgets precisam de estado vazio elegante (já há padrão de "aguardando leitura"). Histograma/barras só aparecem com N mínimo de leituras.
- **Volume do `history`**: 120 pontos é leve; o brush do Recharts lida bem.
- **Bateria** é estática (`fleet.js`) até o firmware publicar — exibir como "configurada" e deixar pronto p/ vir do `/status` futuramente.
