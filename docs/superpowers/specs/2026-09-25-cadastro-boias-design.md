# Cadastro Dinâmico de Bóias — Design

## Objetivo

Hoje, tanto a posição de cada bóia no mapa (`/monitoramento`) quanto o `deviceId` que
determina quais tópicos MQTT o site escuta vêm de arrays fixos no código
(`InteractiveMap.jsx`'s `BUOYS_CONFIG` e `src/config/fleet.js`'s `FLEET`). Trocar de
hardware (como já aconteceu: ESP32 → LoRa32 V3, com novo `deviceId`) exige editar
código e fazer deploy — e enquanto isso não acontece, o site simplesmente para de
receber dado da bóia, sem aviso.

Este design adiciona um cadastro de bóias editável pelo painel admin (posição no mapa
+ nome + lagoa + `deviceId`), com `FLEET` preservado como semente/fallback (nunca é
preciso migrar tudo de uma vez), e corrige o indicador "AO VIVO" — hoje ele mostra se
o **navegador** está conectado ao broker, não se a bóia em si está viva.

## Contexto — o que já existe e fica preservado

- `FLEET` (`src/config/fleet.js`) continua existindo, sem mudanças na sua própria
  estrutura. É consultado por 8 arquivos (Sensors, OTA, Dashboard, CSV, InfluxDB,
  `useDiasMonitorados`, MonitoringPage, InteractiveMap) — nenhum desses usos diretos
  de `FLEET` para metadado (bateria, instalação, manutenção) muda.
- O padrão `getSetting(key, fallback)` / `saveSetting(key, value)` em
  `src/services/settings.js` já existe (usado pela meta de financiamento e pela data
  oficial do changelog) — RLS: leitura pública, escrita só admin/operador, toda
  escrita já cai em auditoria (`logAcao`). Este design reusa o mesmo mecanismo, sem
  nenhuma migration SQL nova.
- `useMqtt` (`src/hooks/useMqtt.js`) já expõe `addTopics(topics)` — inscreve tópicos
  extras depois da montagem, pensado exatamente para bóia cadastrada dinamicamente
  (comentário já existente no código). Este design é o primeiro a de fato usar essa
  função.
- O firmware (`firmware/v5/sentinela/wifi_mqtt.cpp`) já publica um LWT correto:
  conecta com `will = (deviceId + "/availability", qos=1, retain=true, "offline")` e
  publica `"online"` (retido) ao conectar — o broker publica `"offline"`
  automaticamente se a placa cair sem querer. O site nunca consumiu esse tópico.

## Modelo de dados

Nova chave em `app_settings`: `map_buoys` (constante `MAP_BUOYS_KEY`, ao lado de
`FUNDING_GOAL_KEY` em `src/services/settings.js`). Valor: array JSON, um objeto por
bóia:

```json
[
  {
    "codigo": "SM-01",
    "nome": "Bóia Mundaú Centro",
    "lagoa": "mundau",
    "lat": -9.6559,
    "lng": -35.7701,
    "deviceId": "esp_sururu"
  }
]
```

Campos:
- `codigo` — identificador curto exibido no mapa e nas listas (ex: "SM-01"). Único
  dentro do array; formulário de cadastro valida isso antes de salvar (compara contra
  os outros códigos já na lista).
- `nome` — nome de exibição.
- `lagoa` — `"mundau"` ou `"manguaba"` (as duas únicas usadas hoje no filtro do
  mapa). Dropdown fechado no formulário, não texto livre.
- `lat` / `lng` — decimais (não GMS). Dois campos numéricos no formulário.
- `deviceId` — texto livre, opcional. Vazio/nulo = bóia "planejada" (sem hardware),
  mesmo conceito que já existe hoje pro SM-02/MG-01. **Não é mais um dropdown restrito
  ao `FLEET`** (essa era a ideia original antes de descobrir o caso real de troca de
  hardware) — o admin digita o `deviceId` real da placa, que pode não existir em
  `FLEET` ainda.

**Semente inicial (fallback do `getSetting`):** se `map_buoys` nunca foi salvo, a
leitura cai num array hardcoded no código — as 3 bóias de hoje, com as mesmas
coordenadas decimais que já estão em `InteractiveMap.jsx`'s `BUOYS_CONFIG` atual (não
convertidas de `FLEET.coordinates`, que é uma string GMS — reconverter isso introduz
risco de erro de sinal/parsing sem necessidade, já que o dado decimal correto já
existe e está em produção hoje). Esse array semente é definido uma única vez, em
`src/services/buoyRegistry.js` (novo arquivo), e usado só como valor de fallback —
não é recalculado a partir do `FLEET` a cada leitura.

Depois do primeiro `saveSetting`, a lista salva no Supabase passa a ser a única
fonte — não há merge por-campo com `FLEET` em toda leitura. Isso é deliberadamente
mais simples que um merge ao vivo: editar/adicionar/remover bóia é sempre "carrega a
lista inteira atual (Supabase se existir, senão a semente), edita, salva a lista
inteira de volta" — mesmo padrão já usado pela meta de financiamento.

## `src/services/buoyRegistry.js` (novo arquivo)

```js
import { getSetting, saveSetting } from './settings';
import { FLEET } from '../config/fleet';

export const MAP_BUOYS_KEY = 'map_buoys';

// Semente usada só se `map_buoys` nunca foi salvo. Coordenadas decimais — não
// convertidas de FLEET.coordinates (string GMS), pra não arriscar erro de
// parsing/sinal num dado que já existe correto em produção.
const SEED_BUOYS = [
  { codigo: 'SM-01', nome: 'Bóia Mundaú Centro',  lagoa: 'mundau',    lat: -9.6559, lng: -35.7701, deviceId: FLEET.find(f => f.id === 'SM-01')?.deviceId ?? null },
  { codigo: 'SM-02', nome: 'Bóia Mundaú Sul',      lagoa: 'mundau',    lat: -9.6862, lng: -35.7847, deviceId: FLEET.find(f => f.id === 'SM-02')?.deviceId ?? null },
  { codigo: 'MG-01', nome: 'Bóia Manguaba Norte',  lagoa: 'manguaba',  lat: -9.5873, lng: -35.8394, deviceId: FLEET.find(f => f.id === 'MG-01')?.deviceId ?? null },
];

export async function getBuoyRegistry() {
  return getSetting(MAP_BUOYS_KEY, SEED_BUOYS);
}

export async function saveBuoyRegistry(buoys) {
  return saveSetting(MAP_BUOYS_KEY, buoys);
}

// Tópicos MQTT das bóias com deviceId, no mesmo formato de getMqttTopics (fleet.js).
// Default de suffixes igual ao novo default de getMqttTopics (ver seção de status
// abaixo) — os dois ficam sempre em sincronia nos call sites que usam o default.
export function topicsForRegistry(buoys, suffixes = ['sensores', 'status', 'availability']) {
  return buoys
    .filter(b => b.deviceId)
    .flatMap(b => suffixes.map(s => `${b.deviceId}/${s}`));
}
```

## Hook `useBuoyRegistry()` (novo, `src/hooks/useBuoyRegistry.js`)

Busca o registro uma vez por montagem (mesmo padrão de `useEffect` + `ativo` já usado
em `SettingsPage.jsx`), devolve `{ buoys, loading, reload }`. `reload` refaz a busca —
usado depois de salvar uma edição no painel, pra refletir na hora sem precisar de F5.

```js
export function useBuoyRegistry() {
  const [buoys, setBuoys] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBuoys(await getBuoyRegistry());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { buoys, loading, reload: load };
}
```

## Sincronizando tópicos MQTT já inscritos

Os 5 arquivos que chamam `useMqtt(getMqttTopics(...))` diretamente (`SensorsPage.jsx`,
`MonitoringPage.jsx`, `AdminDashboard.jsx`, `OtaPage.jsx`, `InteractiveMap.jsx`)
continuam montando com `getMqttTopics()` (baseado em `FLEET`, síncrono, sem esperar
rede) — isso não muda, garante que hardware já em `FLEET` funciona no primeiro
paint. Cada um desses arquivos ganha:

```js
const { buoys } = useBuoyRegistry();
useEffect(() => {
  if (buoys.length) addTopics(topicsForRegistry(buoys, /* mesmos suffixes que já usa */));
}, [buoys]); // eslint-disable-line react-hooks/exhaustive-deps -- addTopics é estável (useRef interno)
```

Efeito colateral aceitável e temporário: se um `deviceId` mudou (troca de hardware),
por alguns segundos — até essa busca no Supabase terminar — o app fica inscrito no
tópico antigo *e* no novo ao mesmo tempo. Inofensivo (o antigo fica ocioso, ninguém
publica nele) e não se repete depois do primeiro carregamento da sessão. `useMqtt`
não precisa de um `removeTopics`/`unsubscribe` novo para este design.

`MonitoringPage.jsx` tem uma particularidade: `const BUOY = FLEET.find(b =>
b.deviceId) || FLEET[0]` escolhe qual bóia é "a" featured nesta página pública. Isso
passa a ser recalculado a partir de `buoys` (registro) quando `useBuoyRegistry()`
carrega, com o mesmo critério (primeira com `deviceId`, senão a primeira da lista) —
inicia com o equivalente vindo de `FLEET` e atualiza quando o registro chega, mesmo
padrão de "estado que começa com o fallback síncrono e é substituído pelo dado
assíncrono quando chega" usado em todo o resto deste design.

## Indicador de status real (LWT / `availability`)

**`useMqtt.js`** — no handler de `message`, quando `JSON.parse` falha, guardar o
payload cru (string) em vez de descartar com warning:

```js
client.on('message', (topic, payload) => {
  const raw = payload.toString();
  try {
    setMessages(prev => ({ ...prev, [topic]: JSON.parse(raw) }));
  } catch {
    setMessages(prev => ({ ...prev, [topic]: raw }));
  }
});
```

**Todo consumidor que hoje mostra "AO VIVO"/"MQTT Online" baseado no `connected` do
hook** (badge do `AdminDashboard.jsx`, badge do `SensorsPage.jsx`, badge do
`InteractiveMap.jsx`, e o `isLive` de cada bóia no mapa) passa a calcular, por bóia:

```js
const isOnline = buoy.deviceId && messages[`${buoy.deviceId}/availability`] === 'online';
```

`connected` (do hook) continua existindo e sendo mostrado separadamente onde fizer
sentido (ex: "Broker: conectado/desconectado" no `AdminDashboard.jsx`, que já é uma
métrica distinta de "MQTT Broker" hoje) — a mudança é que nenhum indicador de
"bóia ao vivo" específica volta a se basear só nisso.

Também é preciso inscrever o tópico `${deviceId}/availability` para cada bóia — isso
entra na lista de suffixes: `getMqttTopics()`/`topicsForRegistry()` recebem
`['sensores', 'status', 'availability']` como default nos pontos que mostram status
de bóia (o default atual de `getMqttTopics` é `['sensores', 'status']` — vira
`['sensores', 'status', 'availability']`; `OtaPage.jsx`, que já customiza pra
`['status', 'ota/status']`, ganha `'availability'` a mais no lugar certo).

## Painel — Cadastro de Bóias (`SensorsPage.jsx`)

**Fonte dos dados exibidos na tabela:** passa a ser `useBuoyRegistry()` em vez de só
`getInitialBuoys()`/`localStorage`. O restante do estado hoje persistido em
`localStorage` (sensores mock, manutenção, calibração — tudo que não é
posição/deviceId/nome/lagoa) **continua exatamente como está** — fora de escopo
deste design.

**Modal "Nova Bóia" / "Editar":** ganha os campos:
- Código (mapeia pro `codigo` do registro — hoje já existe como campo `id` no
  formulário, mesmo campo, só passa a também ser a chave do registro no Supabase).
- Lagoa (dropdown Mundaú/Manguaba — novo).
- Latitude / Longitude (dois campos numéricos — novo).
- Device ID (campo que **já existe** no formulário hoje — deixa de ser só
  cosmético/local e passa a ser salvo no registro Supabase e a afetar de fato a
  inscrição MQTT via o mecanismo acima).

Salvar chama `saveBuoyRegistry(novaLista)` com a lista inteira (adicionar/editar
altera um item; apagar remove um item), depois `reload()` do hook. Validação: código
duplicado bloqueia o salvamento com mensagem de erro (mesmo padrão de erro inline já
usado no formulário hoje).

`useReadOnly()` já é respeitado por este formulário hoje (herda do padrão do resto do
painel) — sem mudança aí.

## Dashboard (Centro de Comando) — seletor + agregação

**Select novo**, no cabeçalho, ao lado do título: opções = `"Todas as Bóias"`
(padrão, selecionado) + uma entrada por bóia do registro que tem `deviceId` (bóias
"planejadas" sem `deviceId` não aparecem — nada pra mostrar delas).

- **"Todas as Bóias" (padrão):** os 3 cards (Temperatura, pH, Turbidez) mostram a
  **média** entre as bóias com `deviceId` que estão `online` agora (via
  `availability` — não entra no cálculo bóia com `deviceId` mas sem leitura de
  `availability === 'online'`, pra não arrastar pro cálculo um valor antigo de bóia
  desligada). Título de cada card muda de `"Temperatura (SM-01)"` pra
  `"Temperatura (Média da Frota)"`. Se nenhuma bóia estiver online **ou o registro
  estiver vazio** (admin apagou todas as bóias), os cards mostram `"---"` — mesmo
  tratamento "sem dado" que já existe hoje pra ausência de leitura, nunca `NaN`
  (guarda explícita: só calcula média se o array de valores tiver ao menos 1 item).
- **Uma bóia específica selecionada:** os cards mostram só os números dela — mesmo
  comportamento de hoje (que era fixo em SM-01), só que parametrizado pela seleção.

O card "Status da Frota" (donut chart, já correto hoje — "Online/Operando" vs "Sem
Hardware") passa a contar a partir do registro (`buoys.length` como total,
`buoys.filter(isOnline).length` como ativo) em vez do `fleetTotal = 3` hardcoded —
naturalmente correto conforme bóias são adicionadas/removidas pelo painel.

## Fora de escopo

- Migrar os outros consumidores de `FLEET` (CSV export, InfluxDB history,
  `useDiasMonitorados`, metadado de bateria/instalação/manutenção do
  `SensorsPage.jsx`) para o registro Supabase — continuam lendo `FLEET` diretamente,
  sem mudança.
- Seletor de bóia em `MonitoringPage.jsx` (página pública) — só a sincronia de
  tópicos MQTT e a escolha de "qual bóia é a featured" são corrigidas lá; não pedido
  nenhum seletor visível nessa página.
- `removeTopics`/`unsubscribe` em `useMqtt.js` — o efeito colateral de dupla
  inscrição temporária foi avaliado como aceitável (ver seção acima).
- RLS nova — reusa a política já existente de `app_settings` (leitura pública,
  escrita admin/operador via `saveSetting`).

## Testes

- Visual: os 5 pontos de montagem de `useMqtt` continuam funcionando com o `FLEET`
  atual (sem regressão) — testado no navegador real, com e sem `map_buoys` salvo
  ainda (garante que o fallback/semente funciona).
- Criar bóia nova só com `deviceId` (sem existir em `FLEET`) e confirmar, via MQTT
  real (publicar em `<deviceId>/sensores` manualmente), que o dado chega no
  Dashboard e no Mapa depois do `addTopics`.
- Publicar `<deviceId>/availability` como `"offline"` manualmente e confirmar que o
  badge correspondente muda, mesmo com o navegador continuando conectado ao broker
  (prova que não está mais lendo só o `connected` do hook).
- Seletor do Dashboard: com 2+ bóias "online" simultâneas (via publish manual),
  confirmar que "Todas as Bóias" mostra a média correta; trocar pra uma específica e
  confirmar que volta a mostrar só aquela.
