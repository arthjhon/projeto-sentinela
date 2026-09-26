# Cadastro Dinâmico de Bóias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar posição no mapa e `deviceId` de cada bóia editáveis pelo painel admin (sem deploy de código), e corrigir o indicador "AO VIVO" para refletir a bóia de verdade, não a conexão do navegador ao broker.

**Architecture:** Novo registro de bóias em `app_settings` (chave `map_buoys`), com `FLEET` (`src/config/fleet.js`) preservado como semente/fallback e nunca removido. Os 5 pontos que já montam `useMqtt(getMqttTopics(...))` continuam montando com `FLEET` (síncrono, sem regressão), e passam a chamar o `addTopics()` que o hook já expõe assim que o registro carrega (assíncrono) — sem duplicar lógica de merge. Status "ao vivo" passa a vir do LWT que o firmware já publica (`<deviceId>/availability`), não da conexão do navegador ao broker.

**Tech Stack:** React 19, Vite, Supabase (Postgres + `app_settings` já existente), MQTT.js (`useMqtt.js` já existente), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-25-cadastro-boias-design.md`

## Global Constraints

- `FLEET` (`src/config/fleet.js`) não muda de estrutura e nenhum dos 8 arquivos que o consultam para metadado (bateria, instalação, manutenção, CSV, InfluxDB, `useDiasMonitorados`) é tocado por este plano — só os que também chamam `useMqtt`/`getMqttTopics` diretamente.
- Sem migration SQL nova. `map_buoys` reusa a tabela `app_settings` e as policies de RLS que ela já tem (leitura pública, escrita admin/operador via `saveSetting`, que já audita com `logAcao`).
- Sem `removeTopics`/`unsubscribe` novo em `useMqtt.js` — dupla inscrição temporária após troca de `deviceId` é aceitável (ver spec).
- `lagoa` no registro é sempre `"mundau"` ou `"manguaba"` — nunca texto livre, nunca um terceiro valor.
- `lat`/`lng` no registro são decimais. Nunca reconverter `FLEET.coordinates` (string GMS) — onde uma semente é necessária, usar os decimais que já existem hoje em `InteractiveMap.jsx`.
- Nenhum teste automatizado de componente/hook React neste projeto (só Vitest puro, sem `@testing-library/react` instalado) — funções puras extraídas ganham teste real; mudanças em componentes são verificadas em navegador real, com evidência concreta (não previsão lida no código).

## Review Focus

- **`map_buoys` nunca foi salvo (instalação nova/primeira vez rodando este código):** todo componente que lê o registro precisa continuar funcionando com a semente (3 bóias atuais), não travar nem mostrar tela vazia.
- **Bóia sem `deviceId` (bóia "planejada") aparece nos seletores/contagens:** não pode virar opção selecionável no seletor do Dashboard nem no destino de OTA, e não pode contar como "online" em lugar nenhum.
- **`deviceId` trocado enquanto a página já está aberta (o caso real que motivou isto):** depois do `addTopics()` disparar, o dado do dispositivo novo precisa aparecer sem F5 — não só no próximo carregamento.
- **Registro fica vazio (admin apagou todas as bóias pelo painel):** média da frota no Dashboard e status da frota não podem virar `NaN`/`Infinity`/exception — precisam cair no mesmo tratamento "sem dado" que já existe.
- **Payload de `<deviceId>/availability` chega antes de qualquer payload de `/sensores`:** o badge "ao vivo" precisa refletir isso imediatamente (não esperar a primeira leitura de sensor pra saber que a bóia está online).

---

### Task 1: Serviço de registro de bóias (`buoyRegistry.js`)

**Files:**
- Create: `src/services/buoyRegistry.js`
- Test: `src/services/buoyRegistry.test.js`

**Interfaces:**
- Consumes: `getSetting`, `saveSetting` de `src/services/settings.js` (já existem); `FLEET` de `src/config/fleet.js` (já existe).
- Produces: `MAP_BUOYS_KEY` (string), `getBuoyRegistry(): Promise<Buoy[]>`, `saveBuoyRegistry(buoys: Buoy[]): Promise<void>`, `topicsForRegistry(buoys: Buoy[], suffixes?: string[]): string[]`. `Buoy = { codigo: string, nome: string, lagoa: 'mundau'|'manguaba', lat: number, lng: number, deviceId: string|null }`.

- [ ] **Step 1: Escrever o teste de `topicsForRegistry`**

```js
// src/services/buoyRegistry.test.js
import { describe, it, expect } from 'vitest';
import { topicsForRegistry } from './buoyRegistry';

describe('topicsForRegistry', () => {
  const buoys = [
    { codigo: 'SM-01', nome: 'A', lagoa: 'mundau', lat: -9.1, lng: -35.1, deviceId: 'esp_a' },
    { codigo: 'SM-02', nome: 'B', lagoa: 'mundau', lat: -9.2, lng: -35.2, deviceId: null },
    { codigo: 'MG-01', nome: 'C', lagoa: 'manguaba', lat: -9.3, lng: -35.3, deviceId: 'esp_c' },
  ];

  it('gera tópicos só para bóias com deviceId, um por suffix', () => {
    expect(topicsForRegistry(buoys)).toEqual([
      'esp_a/sensores', 'esp_a/status', 'esp_a/availability',
      'esp_c/sensores', 'esp_c/status', 'esp_c/availability',
    ]);
  });

  it('respeita suffixes customizados', () => {
    expect(topicsForRegistry(buoys, ['ota/status'])).toEqual([
      'esp_a/ota/status',
      'esp_c/ota/status',
    ]);
  });

  it('lista vazia gera lista de tópicos vazia', () => {
    expect(topicsForRegistry([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Run: `npx vitest run src/services/buoyRegistry.test.js`
Expected: FAIL — `buoyRegistry.js` ainda não existe.

- [ ] **Step 3: Criar `src/services/buoyRegistry.js`**

```js
import { getSetting, saveSetting } from './settings';
import { FLEET } from '../config/fleet';

export const MAP_BUOYS_KEY = 'map_buoys';

// Semente usada só se `map_buoys` nunca foi salvo. Coordenadas decimais — não
// convertidas de FLEET.coordinates (string GMS), pra não arriscar erro de
// parsing/sinal num dado que já existe correto em produção (mesmas
// coordenadas hoje hardcoded em InteractiveMap.jsx).
const SEED_BUOYS = [
  { codigo: 'SM-01', nome: 'Bóia Mundaú Centro', lagoa: 'mundau',   lat: -9.6559, lng: -35.7701, deviceId: FLEET.find(f => f.id === 'SM-01')?.deviceId ?? null },
  { codigo: 'SM-02', nome: 'Bóia Mundaú Sul',     lagoa: 'mundau',   lat: -9.6862, lng: -35.7847, deviceId: FLEET.find(f => f.id === 'SM-02')?.deviceId ?? null },
  { codigo: 'MG-01', nome: 'Bóia Manguaba Norte', lagoa: 'manguaba', lat: -9.5873, lng: -35.8394, deviceId: FLEET.find(f => f.id === 'MG-01')?.deviceId ?? null },
];

/** Lista completa de bóias — do Supabase se já existir, senão a semente. */
export async function getBuoyRegistry() {
  return getSetting(MAP_BUOYS_KEY, SEED_BUOYS);
}

/** Substitui a lista inteira (adicionar/editar/remover = editar o array e salvar de volta). */
export async function saveBuoyRegistry(buoys) {
  return saveSetting(MAP_BUOYS_KEY, buoys);
}

/** Tópicos MQTT das bóias com deviceId, no mesmo formato de getMqttTopics (fleet.js). */
export function topicsForRegistry(buoys, suffixes = ['sensores', 'status', 'availability']) {
  return buoys
    .filter(b => b.deviceId)
    .flatMap(b => suffixes.map(s => `${b.deviceId}/${s}`));
}
```

- [ ] **Step 4: Rodar o teste, confirmar que passa**

Run: `npx vitest run src/services/buoyRegistry.test.js`
Expected: PASS (3 testes)

- [ ] **Step 5: Rodar a suíte inteira, confirmar zero regressão**

Run: `npx vitest run`
Expected: todos os arquivos de teste já existentes continuam passando, mais os 3 novos.

- [ ] **Step 6: Commit**

```bash
git add src/services/buoyRegistry.js src/services/buoyRegistry.test.js
git commit -m "feat(boias): servico de registro dinamico (map_buoys em app_settings)"
```

---

### Task 2: `useMqtt.js` — payload não-JSON não é mais descartado

**Files:**
- Modify: `src/hooks/useMqtt.js`
- Create: `src/utils/mqttPayload.js`
- Test: `src/utils/mqttPayload.test.js`

**Interfaces:**
- Produces: `parseMqttPayload(raw: string): unknown` — devolve o objeto parseado se `raw` for JSON válido, senão a própria string crua. Extraído pra função pura testável (o handler de mensagem do MQTT.js não é, sem mockar a lib inteira).
- Consumes (Task 3+ em diante): nenhum outro arquivo depende desta função ainda — só `useMqtt.js` a usa.

- [ ] **Step 1: Escrever o teste de `parseMqttPayload`**

```js
// src/utils/mqttPayload.test.js
import { describe, it, expect } from 'vitest';
import { parseMqttPayload } from './mqttPayload';

describe('parseMqttPayload', () => {
  it('faz parse de JSON válido', () => {
    expect(parseMqttPayload('{"temperatura":27.5}')).toEqual({ temperatura: 27.5 });
  });

  it('devolve a string crua quando não é JSON (ex: LWT de availability)', () => {
    expect(parseMqttPayload('online')).toBe('online');
    expect(parseMqttPayload('offline')).toBe('offline');
  });

  it('devolve a string crua para payload vazio', () => {
    expect(parseMqttPayload('')).toBe('');
  });
});
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Run: `npx vitest run src/utils/mqttPayload.test.js`
Expected: FAIL — `src/utils/mqttPayload.js` ainda não existe.

- [ ] **Step 3: Criar `src/utils/mqttPayload.js`**

```js
/**
 * Faz parse de um payload MQTT: JSON quando possível, senão devolve a string
 * crua. Antes desta função, useMqtt descartava (com warning) qualquer payload
 * não-JSON — e o firmware publica `<deviceId>/availability` como string pura
 * ("online"/"offline"), não JSON, então esse tópico nunca era guardado.
 */
export function parseMqttPayload(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
```

- [ ] **Step 4: Rodar o teste, confirmar que passa**

Run: `npx vitest run src/utils/mqttPayload.test.js`
Expected: PASS (3 testes)

- [ ] **Step 5: Usar `parseMqttPayload` no handler de mensagem**

Em `src/hooks/useMqtt.js`, o handler atual (dentro de `useEffect`, dentro de `client.on('message', ...)`):

```js
    client.on('message', (topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());
        setMessages(prev => ({ ...prev, [topic]: data }));
      } catch {
        console.warn(`MQTT: payload não-JSON recebido no tópico "${topic}"`);
      }
    });
```

Substituir por:

```js
    client.on('message', (topic, payload) => {
      setMessages(prev => ({ ...prev, [topic]: parseMqttPayload(payload.toString()) }));
    });
```

E adicionar o import no topo do arquivo:

```js
import { parseMqttPayload } from '../utils/mqttPayload';
```

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npx vitest run`
Expected: todos os testes passam, incluindo os 3 novos de `mqttPayload.test.js`.

- [ ] **Step 7: Verificação manual em navegador real**

Com o Supabase local rodando (`172.16.200.22:8000`) e o app em dev (`npm run dev -- --host 0.0.0.0 --port <livre>`), abrir qualquer página que já use `useMqtt` (ex: `/admin/dashboard`, logado). Publicar manualmente uma string pura num tópico de teste (ex: via `mosquitto_pub`/painel do broker, ou um script Node com a lib `mqtt`, no tópico `esp_sururu/availability` com payload `online`) e confirmar, via devtools, que `messages['esp_sururu/availability']` aparece como a string `"online"` (não descartado, sem warning no console). Documentar o comando exato usado e o resultado observado no relatório da task — não presumir a partir da leitura do código.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useMqtt.js src/utils/mqttPayload.js src/utils/mqttPayload.test.js
git commit -m "fix(mqtt): payload nao-JSON (LWT de availability) nao e mais descartado"
```

---

### Task 3: Hook `useBuoyRegistry()`

**Files:**
- Create: `src/hooks/useBuoyRegistry.js`

**Interfaces:**
- Consumes: `getBuoyRegistry` de `src/services/buoyRegistry.js` (Task 1).
- Produces: `useBuoyRegistry(): { buoys: Buoy[], loading: boolean, reload: () => Promise<void> }`. `buoys` começa `[]` e `loading` começa `true` até a primeira busca terminar (que, na pior hipótese, resolve para a semente do Task 1 — nunca fica vazio por engano).

Sem teste automatizado isolado — este projeto não tem `@testing-library/react`/ambiente de DOM pra testar hooks fora de um componente, e a lógica não-trivial (`getBuoyRegistry`, semente) já foi testada no Task 1. A verificação real acontece nas Tasks 4-8, quando o hook é de fato consumido em navegador.

- [ ] **Step 1: Criar `src/hooks/useBuoyRegistry.js`**

```js
import { useState, useEffect, useCallback } from 'react';
import { getBuoyRegistry } from '../services/buoyRegistry';

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

- [ ] **Step 2: Rodar a suíte inteira (garantir que nada quebrou por engano)**

Run: `npx vitest run`
Expected: mesma contagem de testes/arquivos do Task 2, todos passando (este hook não tem teste próprio).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useBuoyRegistry.js
git commit -m "feat(boias): hook useBuoyRegistry para consumir o registro dinamico"
```

---

### Task 4: `SensorsPage.jsx` — cadastro de posição/deviceId no formulário

**Files:**
- Modify: `src/pages/admin/SensorsPage.jsx`

**Interfaces:**
- Consumes: `useBuoyRegistry` (Task 3), `saveBuoyRegistry`, `topicsForRegistry` (Task 1).
- Produces: nenhuma interface nova para outras tasks — este é o ponto de entrada de dados, consumido depois só via o próprio `map_buoys` no Supabase.

**Contexto importante:** `SensorsPage.jsx` tem hoje seu próprio estado `buoys` (rico — sensores mock, manutenção, calibração, bateria, status — tudo persistido em `localStorage`, chave `sentinela_buoys_v1`). Esse estado **continua existindo e não muda de forma** — é a fonte de tudo que não é posição/lagoa/deviceId (mock de sensores, manutenção, histórico). O registro do Task 1 é um *segundo* dado, gravado em paralelo pelo mesmo formulário: ao salvar uma bóia, o formulário atualiza o `buoys` local (como já faz hoje) **e também** grava a versão "posição + deviceId" no `map_buoys` do Supabase. Não existe migração de um pro outro — os dois convivem, cada um alimentando uma parte diferente do produto (mapa/MQTT vs. página de gerenciamento local).

- [ ] **Step 1: Importar o hook e as funções do registro**

No topo de `src/pages/admin/SensorsPage.jsx`, junto aos imports já existentes:

```js
import { useBuoyRegistry } from '../../hooks/useBuoyRegistry';
import { saveBuoyRegistry, topicsForRegistry } from '../../services/buoyRegistry';
```

- [ ] **Step 2: Instanciar o hook e sincronizar tópicos MQTT**

Logo abaixo de `const { messages, connected, addTopics } = useMqtt(getMqttTopics());` (linha ~92):

```js
  const { buoys: registryBuoys, reload: reloadRegistry } = useBuoyRegistry();

  // Bóia cadastrada só no registro (deviceId novo, ainda não em FLEET) —
  // inscreve o tópico assim que o registro carrega. Ver spec: dupla
  // inscrição temporária num deviceId trocado é aceitável.
  useEffect(() => {
    if (registryBuoys.length) addTopics(topicsForRegistry(registryBuoys));
  }, [registryBuoys]); // eslint-disable-line react-hooks/exhaustive-deps -- addTopics é estável (ref interno do hook)
```

- [ ] **Step 3: Status por bóia via `availability`, não só chegada de leitura**

O `useEffect` que atualiza status/sensores por bóia (linhas ~121-153) hoje só reage a mensagens em `/sensores` e `/status` — nunca vê `/availability`, e nunca volta a marcar uma bóia como não-online depois que ela já recebeu alguma leitura (uma bóia que cai não é detectada, ela fica "online" pra sempre na tela). Trocar o corpo do `useEffect` para também considerar `availability`:

```js
  useEffect(() => {
    const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setBuoys(prev => prev.map(b => {
      if (!b.deviceId) return b;
      const sData = messages[`${b.deviceId}/sensores`];
      const stData = messages[`${b.deviceId}/status`];
      const availability = messages[`${b.deviceId}/availability`];
      if (!sData && !stData && availability == null) return b;

      const isOnline = availability === 'online';
      const isOffline = availability === 'offline';

      return {
        ...b,
        ...(isOffline ? { status: 'offline' } : {}),
        ...(sData ? {
          status: isOffline ? 'offline' : 'online',
          lastPing: now,
          sensors: b.sensors.map(s => {
            if (s.name === 'Termômetro')
              return { ...s, value: sData.temperatura != null ? `${sData.temperatura.toFixed(1)} °C` : '-- °C', status: isOffline ? 'offline' : 'online' };
            if (s.name === 'Sensor de pH')
              return { ...s, value: sData.ph != null ? `${sData.ph.toFixed(2)}` : '--', status: isOffline ? 'offline' : 'online' };
            if (s.name === 'Turbidez')
              return { ...s, value: sData.turbidez != null ? `${sData.turbidez.toFixed(2)} NTU` : '-- NTU', status: isOffline ? 'offline' : 'online' };
            return s;
          }),
        } : {}),
        ...(isOnline && !sData ? { status: 'online' } : {}),
        ...(stData ? {
          details: {
            ...b.details,
            rssi:        `${stData.rssi} dBm`,
            uptime:      `${Math.floor(stData.uptime / 60)} min`,
            mqttLatency: `${stData.mqtt_latency} ms`,
          },
        } : {}),
      };
    }));
  }, [messages]);
```

(`isOffline` sempre vence: mesmo que uma leitura de sensor antiga ainda esteja em `messages`, uma vez que `availability` diz `"offline"`, o status da bóia e de cada sensor reflete isso.)

- [ ] **Step 4: Acrescentar campos de Lagoa/Latitude/Longitude ao `formData`**

`initialFormData` (linha ~108) ganha 3 campos novos:

```js
  const initialFormData = {
    id: '', deviceId: '', name: '', status: 'online', location: 'Lagoa Mundaú', battery: 100, coordinates: '',
    lagoa: 'mundau', lat: '', lng: ''
  };
```

- [ ] **Step 5: Pré-popular Lagoa/Lat/Lng ao abrir "Editar"**

`handleOpenEdit` (linha ~163) — buscar a entrada correspondente no registro (mesmo `codigo` == `buoy.id`) e usar seus valores se existir, senão deixar em branco (bóia ainda não tem entrada no registro — comum logo após esta task ser implantada, antes de qualquer edição):

```js
  const handleOpenEdit = (buoy) => {
    const regEntry = registryBuoys.find(r => r.codigo === buoy.id);
    setEditingBuoy(buoy);
    setFormData({
      id: buoy.id,
      deviceId: buoy.deviceId || '',
      name: buoy.name,
      status: buoy.status,
      location: buoy.location,
      battery: buoy.battery,
      coordinates: buoy.details.coordinates,
      lagoa: regEntry?.lagoa ?? 'mundau',
      lat: regEntry?.lat ?? '',
      lng: regEntry?.lng ?? '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };
```

- [ ] **Step 6: Validar Lat/Lng no submit**

Em `handleSaveForm` (linha ~194), no bloco de validação:

```js
    const errors = {};
    if (!formData.id.trim()) errors.id = true;
    if (!formData.name.trim()) errors.name = true;
    if (!formData.coordinates.trim()) errors.coordinates = true;
    if (formData.battery === '' || formData.battery === null) errors.battery = true;
    if (formData.lat === '' || Number.isNaN(Number(formData.lat))) errors.lat = true;
    if (formData.lng === '' || Number.isNaN(Number(formData.lng))) errors.lng = true;
```

- [ ] **Step 7: Gravar no registro ao salvar (criar ou editar)**

Extrair uma função auxiliar antes de `handleSaveForm`, usada nos dois ramos (criar e editar):

```js
  // Grava/atualiza a entrada desta bóia no registro dinâmico (map_buoys),
  // além do estado local `buoys` que o resto da página já mantém.
  const syncRegistryEntry = async (codigo, novoCodigo) => {
    const entry = {
      codigo: novoCodigo,
      nome: formData.name,
      lagoa: formData.lagoa,
      lat: Number(formData.lat),
      lng: Number(formData.lng),
      deviceId: formData.deviceId.trim() || null,
    };
    const semEsta = registryBuoys.filter(r => r.codigo !== codigo);
    await saveBuoyRegistry([...semEsta, entry]);
    await reloadRegistry();
  };
```

No ramo de edição (dentro do `if(editingBuoy)`, depois do `setBuoys(...)`):

```js
      syncRegistryEntry(editingBuoy.id, formData.id).catch(err =>
        addToast(`Bóia atualizada localmente, mas falhou salvar posição/deviceId: ${err.message}`, 'error')
      );
```

No ramo de criação (depois do `setBuoys([...buoys, newBuoy])`):

```js
      syncRegistryEntry(formData.id, formData.id).catch(err =>
        addToast(`Bóia criada localmente, mas falhou salvar posição/deviceId: ${err.message}`, 'error')
      );
```

(Chamada não bloqueia o fechamento do modal nem o toast de sucesso já existente — é um `catch` silencioso-com-aviso, não um `await` que trava a UI; o dado local já foi salvo de qualquer forma.)

- [ ] **Step 8: Remover a entrada do registro ao apagar a bóia**

Em `confirmDeleteAction` (linha ~183), depois do `setBuoys(...)`:

```js
    saveBuoyRegistry(registryBuoys.filter(r => r.codigo !== buoyToDelete))
      .then(reloadRegistry)
      .catch(err => addToast(`Bóia removida localmente, mas falhou remover do registro: ${err.message}`, 'error'));
```

- [ ] **Step 9: Adicionar os 3 campos no formulário (JSX do modal)**

No `form-grid` do modal (depois do campo "Coordenadas (GPS)", linha ~492):

```jsx
                <div className="form-group">
                  <label>Lagoa (mapa)</label>
                  <select value={formData.lagoa} onChange={e => setFormData({...formData, lagoa: e.target.value})}>
                    <option value="mundau">Mundaú</option>
                    <option value="manguaba">Manguaba</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Latitude (mapa)</label>
                  <input type="number" step="any" className={`w-100 ${formErrors.lat ? 'input-error' : ''}`} value={formData.lat} onChange={e => {setFormData({...formData, lat: e.target.value}); setFormErrors({...formErrors, lat: false})}} placeholder="Ex: -9.6559" />
                </div>
                <div className="form-group">
                  <label>Longitude (mapa)</label>
                  <input type="number" step="any" className={`w-100 ${formErrors.lng ? 'input-error' : ''}`} value={formData.lng} onChange={e => {setFormData({...formData, lng: e.target.value}); setFormErrors({...formErrors, lng: false})}} placeholder="Ex: -35.7701" />
                </div>
```

- [ ] **Step 10: Rodar lint e build**

Run: `npm run lint && npx vite build`
Expected: mesma baseline de problemas de lint já existente (14 problemas antes desta task — confirmar que não aumentou), build sem erro.

- [ ] **Step 11: Verificação manual em navegador real**

Antes de qualquer cadastro: confirmar via REST direto (`GET /rest/v1/app_settings?key=eq.map_buoys`) o estado atual — se a chave ainda não existe no ambiente de teste, confirmar que a página carrega mesmo assim (sem tela vazia/erro), usando a semente de 3 bóias definida no Task 1.

Login como admin real (conta de teste descartável, criada via API Admin do GoTrue — nunca signup público). Abrir `/admin/sensors`, "Nova Bóia", preencher um código novo (ex: `TEST-01`), device ID inexistente em `FLEET` (ex: `esp_teste_plano`), lat/lng quaisquer, salvar. Confirmar via REST direto (`GET /rest/v1/app_settings?key=eq.map_buoys`) que o array salvo contém a entrada nova com esses campos. Editar a mesma bóia, mudar o device ID, salvar, confirmar que o array atualizado reflete a troca. Apagar a bóia, confirmar que a entrada some do array salvo. Publicar `<deviceId>/availability` como `"offline"` manualmente pra uma bóia com hardware e confirmar que o badge de status da linha muda pra offline (mesmo sem nenhuma leitura de sensor nova chegando). Limpar a conta de teste ao final (status HTTP real de cada chamada, não presumido).

- [ ] **Step 12: Commit**

```bash
git add src/pages/admin/SensorsPage.jsx
git commit -m "feat(boias): formulario de bóia grava posicao/lagoa/deviceId no registro"
```

---

### Task 5: `MonitoringPage.jsx` — bóia featured dinâmica + status real

**Files:**
- Modify: `src/pages/public/MonitoringPage.jsx`

**Interfaces:**
- Consumes: `useBuoyRegistry`, `topicsForRegistry` (Tasks 1 e 3).

**Contexto:** `const BUOY = FLEET.find(b => b.deviceId) || FLEET[0]` hoje é uma constante de módulo (calculada uma vez, na importação do arquivo) — precisa virar estado do componente, que começa com o equivalente do `FLEET` (síncrono, sem regressão) e é substituído pelo registro assim que ele carrega.

- [ ] **Step 1: Importar o hook e as funções do registro**

```js
import { useBuoyRegistry } from '../../hooks/useBuoyRegistry';
import { topicsForRegistry } from '../../services/buoyRegistry';
```

- [ ] **Step 2: Remover a constante de módulo, adicionar estado equivalente**

Remover a linha `const BUOY = FLEET.find(b => b.deviceId) || FLEET[0];` (linha 20, fora do componente).

Dentro do componente, antes do `useMqtt`:

```js
  const { buoys: registryBuoys } = useBuoyRegistry();
  // Mesma regra de hoje (primeira com deviceId, senão a primeira da lista) —
  // começa com o equivalente vindo de FLEET (síncrono) e é substituída pelo
  // registro assim que ele carrega.
  const fleetBuoy = FLEET.find(b => b.deviceId) || FLEET[0];
  const BUOY = (registryBuoys.find(b => b.deviceId) || registryBuoys[0]) ?? {
    deviceId: fleetBuoy?.deviceId ?? null,
  };
```

- [ ] **Step 3: Sincronizar tópicos do registro após a montagem**

Logo após a linha `const { messages, connected } = useMqtt(getMqttTopics(['sensores', 'status']));` (linha ~30):

```js
  useEffect(() => {
    if (registryBuoys.length) addTopics(topicsForRegistry(registryBuoys, ['sensores', 'status', 'availability']));
  }, [registryBuoys]); // eslint-disable-line react-hooks/exhaustive-deps
```

(`useMqtt` precisa devolver `addTopics` aqui também — ajustar a desestruturação da linha ~30 para `const { messages, connected, addTopics } = useMqtt(...)`.)

- [ ] **Step 4: Status "ao vivo" via `availability`, não só `connected`**

Onde este arquivo hoje decide se a bóia está "ao vivo" (procurar o uso de `connected` combinado com `mqttStatus`/`mqttData` para essa decisão — variável tipicamente chamada algo como `isLive`/`aoVivo` mais abaixo no arquivo), trocar para considerar também:

```js
  const isOnline = BUOY.deviceId && messages[`${BUOY.deviceId}/availability`] === 'online';
```

e usar `isOnline` (em vez de só `connected`) em qualquer badge/indicador desta página que hoje afirma que a bóia está viva.

- [ ] **Step 5: Rodar lint e build**

Run: `npm run lint && npx vite build`
Expected: baseline mantida, build ok.

- [ ] **Step 6: Verificação manual em navegador real**

Abrir `/monitoramento` sem estar logado (página pública). Confirmar que carrega normalmente (sem `map_buoys` salvo ainda vs. já salvo pela Task 4 — testar as duas situações se possível). Publicar `<deviceId-da-SM-01>/availability` como `offline` manualmente e confirmar que o indicador muda mesmo com o navegador continuando conectado ao broker.

- [ ] **Step 7: Commit**

```bash
git add src/pages/public/MonitoringPage.jsx
git commit -m "feat(boias): pagina publica usa registro dinamico e status real (availability)"
```

---

### Task 6: `InteractiveMap.jsx` — posições do registro + status real

**Files:**
- Modify: `src/components/public/InteractiveMap.jsx`

**Interfaces:**
- Consumes: `useBuoyRegistry`, `topicsForRegistry` (Tasks 1 e 3).

**Contexto:** `BUOYS_CONFIG` (array hardcoded no topo do arquivo) é exatamente o que o registro do Task 1 substitui. `isPlanned = !buoy.deviceId` já existe e continua sendo o critério certo (sem mudança nesse conceito).

- [ ] **Step 1: Importar o hook e as funções do registro**

```js
import { useBuoyRegistry } from '../../hooks/useBuoyRegistry';
import { topicsForRegistry } from '../../services/buoyRegistry';
```

- [ ] **Step 2: Substituir `BUOYS_CONFIG` pelo registro**

Remover o array `BUOYS_CONFIG` hardcoded (linhas ~14-18) e o `.map(...)` que mesclava com `FLEET` — essa mesclagem some porque agora o registro já é a fonte única (a semente do Task 1 já inclui `deviceId`, herdado de `FLEET` só na primeira leitura).

Dentro do componente `InteractiveMap`, antes de `visibleBuoys`:

```js
  const { buoys: registryBuoys } = useBuoyRegistry();
  const BUOYS_CONFIG = registryBuoys.map(b => ({
    id: b.codigo, name: b.nome, coords: [b.lat, b.lng], lagoon: b.lagoa, deviceId: b.deviceId,
  }));
```

- [ ] **Step 3: Sincronizar tópicos do registro**

Logo após a linha `const { messages, connected } = useMqtt(getMqttTopics());` (linha ~98, ajustar desestruturação para incluir `addTopics`):

```js
  useEffect(() => {
    if (registryBuoys.length) addTopics(topicsForRegistry(registryBuoys));
  }, [registryBuoys]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 4: `isLive` por `availability`, não só `connected`**

No cálculo de `isLive` dentro do `.map(buoy => ...)` (linha ~232, hoje algo como `const isLive = liveMode && !!buoy.deviceId && connected;`), trocar para:

```js
            const isLive = liveMode && !!buoy.deviceId && messages[`${buoy.deviceId}/availability`] === 'online';
```

- [ ] **Step 5: Rodar lint e build**

Run: `npm run lint && npx vite build`
Expected: baseline mantida.

- [ ] **Step 6: Verificação manual em navegador real**

Abrir `/monitoramento` (mapa embutido). Confirmar que as 3 bóias da semente aparecem nas posições corretas (iguais a antes desta task). Cadastrar uma bóia de teste via `/admin/sensors` (Task 4) com lat/lng diferentes, confirmar que aparece no mapa sem precisar de deploy. Publicar `availability` "offline"/"online" pro deviceId de uma bóia com hardware e confirmar que o anel pulsante (`isLive`) reage, mesmo com o navegador continuando conectado ao broker.

- [ ] **Step 7: Commit**

```bash
git add src/components/public/InteractiveMap.jsx
git commit -m "feat(boias): mapa le posicao do registro dinamico e status real (availability)"
```

---

### Task 7: `OtaPage.jsx` — sincronia de tópicos + destino de OTA a partir do registro

**Files:**
- Modify: `src/pages/admin/OtaPage.jsx`

**Interfaces:**
- Consumes: `useBuoyRegistry`, `topicsForRegistry` (Tasks 1 e 3).

**Contexto:** `ALL_TOPICS = getMqttTopics(['status', 'ota/status'])` é uma constante de módulo hoje — igual ao caso do Task 5, precisa de sincronia via `addTopics` depois da montagem. Além disso, o dropdown de bóia-destino do OTA (`targetBuoyId`, hoje construído a partir de `FLEET`) precisa incluir bóias cadastradas só no registro — senão uma bóia com hardware trocado (o cenário real que motivou este plano) fica sem conseguir receber OTA pelo painel, o que contradiz o objetivo da mudança. Isso não estava explícito na spec original — é uma extensão pequena e diretamente ligada ao motivo da mudança, registrada aqui como decisão do plano.

- [ ] **Step 1: Importar o hook e as funções do registro**

```js
import { useBuoyRegistry } from '../../hooks/useBuoyRegistry';
import { topicsForRegistry } from '../../services/buoyRegistry';
```

- [ ] **Step 2: Sincronizar tópicos do registro**

Ajustar a desestruturação de `useMqtt` (linha ~18) para incluir `addTopics`:

```js
  const { messages, connected, publish, addTopics } = useMqtt(ALL_TOPICS);
  const { buoys: registryBuoys } = useBuoyRegistry();

  useEffect(() => {
    if (registryBuoys.length) addTopics(topicsForRegistry(registryBuoys, ['status', 'ota/status', 'availability']));
  }, [registryBuoys]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 3: Incluir bóias do registro no destino do OTA**

Encontrar onde o dropdown de `targetBuoyId` itera sobre `FLEET` (procurar `FLEET.map`/`FLEET.filter` próximo da declaração do `<select>` do formulário) e trocar a fonte para a união de `FLEET` com `registryBuoys` (por `codigo`, sem duplicar):

```js
  const otaTargets = [
    ...FLEET,
    ...registryBuoys
      .filter(r => !FLEET.some(f => f.id === r.codigo))
      .map(r => ({ id: r.codigo, name: r.nome, deviceId: r.deviceId })),
  ].filter(b => b.deviceId);
```

E trocar a fonte usada no `<option>` do dropdown de destino (hoje mapeando `FLEET.filter(b => b.deviceId)` ou similar) para `otaTargets`.

- [ ] **Step 4: Atualizar a busca do device de destino no envio do comando**

Onde o código faz `const target = FLEET.find(b => b.id === targetBuoyId);` (linha ~109), trocar por:

```js
    const target = otaTargets.find(b => b.id === targetBuoyId);
```

- [ ] **Step 5: Rodar lint e build**

Run: `npm run lint && npx vite build`
Expected: baseline mantida.

- [ ] **Step 6: Verificação manual em navegador real**

Login admin, `/admin/ota`. Confirmar que o dropdown de destino continua listando SM-01 (hardware real, via `FLEET`). Cadastrar uma bóia de teste via `/admin/sensors` (Task 4) com `deviceId` que não existe em `FLEET`, confirmar que ela aparece como opção de destino aqui também, sem precisar de deploy. Limpar a bóia de teste ao final.

- [ ] **Step 7: Commit**

```bash
git add src/pages/admin/OtaPage.jsx
git commit -m "feat(boias): OTA aceita bóia cadastrada so no registro dinamico como destino"
```

---

### Task 8: `AdminDashboard.jsx` — seletor de bóia + média da frota + status real

**Files:**
- Create: `src/utils/fleetAverage.js`
- Test: `src/utils/fleetAverage.test.js`
- Modify: `src/pages/admin/AdminDashboard.jsx`

**Interfaces:**
- Consumes: `useBuoyRegistry`, `topicsForRegistry` (Tasks 1 e 3).
- Produces: `computeFleetAverage(readings: Array<number|null|undefined>): number|null` — usado só neste Dashboard, mas extraído como função pura pra ter teste real (o resto da lógica de agregação por bóia mistura estado do React e MQTT, não é isolável sem mockar tudo isso).

**Contexto — decisão de escopo deste plano:** hoje TODO o dashboard (buffer, gráfico, InfluxDB, CSV) é hardcoded pra "SM-01" (`const SM01 = FLEET.find(...)`, usado em `useInfluxHistory`, `fetchHistoryCsv`, `buffer`). Fazer o gráfico/histórico/CSV funcionarem com "todas as bóias ao mesmo tempo" seria um recurso bem maior (overlay de séries de múltiplas bóias), não pedido. Este plano escopa o seletor+média só aos **3 cards do topo** (Temperatura/pH/Turbidez — "valor atual"): com uma bóia específica selecionada, eles mostram os dados dela (igual hoje, só que parametrizado); com "Todas as Bóias", mostram a média das últimas leituras de todas as bóias online. Gráfico/histórico/CSV continuam seguindo uma bóia concreta — a selecionada, ou a primeira com `deviceId` quando "Todas as Bóias" está ativo (mesmo default de hoje, SM-01, se ela for a primeira do registro).

- [ ] **Step 1: Escrever o teste de `computeFleetAverage`**

```js
// src/utils/fleetAverage.test.js
import { describe, it, expect } from 'vitest';
import { computeFleetAverage } from './fleetAverage';

describe('computeFleetAverage', () => {
  it('calcula a média ignorando null/undefined', () => {
    expect(computeFleetAverage([10, 20, null, 30])).toBe(20);
  });
  it('devolve null se não houver nenhum valor', () => {
    expect(computeFleetAverage([])).toBeNull();
    expect(computeFleetAverage([null, undefined])).toBeNull();
  });
  it('arredonda para 2 casas decimais', () => {
    expect(computeFleetAverage([1, 2, 2])).toBe(1.67);
  });
});
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Run: `npx vitest run src/utils/fleetAverage.test.js`
Expected: FAIL — arquivo ainda não existe.

- [ ] **Step 3: Criar `src/utils/fleetAverage.js`**

```js
/** Média de um array de leituras, ignorando null/undefined. null se nenhuma sobrar. */
export function computeFleetAverage(readings) {
  const vals = readings.filter(v => v != null);
  if (!vals.length) return null;
  return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
}
```

- [ ] **Step 4: Rodar o teste, confirmar que passa**

Run: `npx vitest run src/utils/fleetAverage.test.js`
Expected: PASS (3 testes)

- [ ] **Step 5: Importar o hook e as funções do registro no Dashboard**

```js
import { useBuoyRegistry } from '../../hooks/useBuoyRegistry';
import { topicsForRegistry } from '../../services/buoyRegistry';
import { computeFleetAverage } from '../../utils/fleetAverage';
```

- [ ] **Step 6: Sincronizar tópicos e adicionar o seletor de bóia**

Ajustar `const { messages, connected } = useMqtt(getMqttTopics());` (linha 54) para incluir `addTopics`, e adicionar:

```js
  const { buoys: registryBuoys } = useBuoyRegistry();
  const [selectedBuoy, setSelectedBuoy] = useState('todas'); // 'todas' | codigo da bóia

  useEffect(() => {
    if (registryBuoys.length) addTopics(topicsForRegistry(registryBuoys));
  }, [registryBuoys]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveBuoys = registryBuoys.filter(b => b.deviceId);
  const onlineBuoys = liveBuoys.filter(b => messages[`${b.deviceId}/availability`] === 'online');

  // Bóia "focada" pro gráfico/histórico/CSV: a selecionada, ou a primeira com
  // deviceId quando "Todas as Bóias" está ativo — ver nota de escopo do plano.
  const focusedBuoy = selectedBuoy === 'todas'
    ? liveBuoys[0]
    : liveBuoys.find(b => b.codigo === selectedBuoy);
  const focusedDeviceId = focusedBuoy?.deviceId ?? null;
  const focusedId = focusedBuoy?.codigo ?? null;
```

- [ ] **Step 7: Trocar `SM01` pela bóia focada nos pontos que hoje usam a constante fixa**

Remover `const SM01 = FLEET.find(b => b.id === 'SM-01');` (linha 42). Trocar:
- `useInfluxHistory(activeParam, period, SM01?.deviceId)` → `useInfluxHistory(activeParam, period, focusedDeviceId)`
- `const sensorMsg = SM01?.deviceId ? messages[...] : null;` → usar `focusedDeviceId` no lugar de `SM01?.deviceId`
- `fetchHistoryCsv(period, SM01?.deviceId, SM01?.id)` e o nome do arquivo (`sentinela_${SM01?.id ?? 'frota'}_...`) → `focusedDeviceId`, `focusedId`
- `sm01Online` (linha 130) → renomear para `focusedOnline`, calculado como `focusedDeviceId ? messages[`${focusedDeviceId}/availability`] === 'online' : false` (troca o critério pra `availability`, igual às outras tasks — antes usava `!!messages[.../status] && connected`)

- [ ] **Step 8: Cards do topo — valor único vira valor ou média conforme o seletor**

Nos 3 `metricCards` de Temperatura/pH/Turbidez (linhas ~168-196), o valor/título passam a depender do seletor:

```js
  const fleetValue = (param) => computeFleetAverage(
    onlineBuoys.map(b => {
      const msg = messages[`${b.deviceId}/sensores`];
      return msg?.[param] ?? null;
    })
  );

  const cardValue = (param, unit) => {
    if (selectedBuoy === 'todas') {
      const avg = fleetValue(param);
      return avg != null ? `${avg}${unit}` : '---';
    }
    return latest[param] != null ? `${latest[param]}${unit}` : '---';
  };

  const cardTitle = (base) => selectedBuoy === 'todas' ? `${base} (Média da Frota)` : `${base} (${focusedId ?? '—'})`;
```

E nos objetos de `metricCards`, trocar `title: 'Temperatura (SM-01)'` por `title: cardTitle('Temperatura')` (idem pH/Turbidez), e `value: latest.temperatura != null ? ... : '---'` por `value: cardValue('temperatura', '°C')` (idem pH sem unidade, Turbidez com `' NTU'`).

- [ ] **Step 9: "Status da Frota" a partir do registro, não mais hardcoded em 3**

Trocar:

```js
  const fleetActive = sm01Online ? 1 : 0;
  const fleetTotal  = 3;
```

por:

```js
  const fleetActive = onlineBuoys.length;
  const fleetTotal  = registryBuoys.length || 1; // evita divisão por zero se o registro estiver vazio
```

- [ ] **Step 10: Adicionar o `<select>` no cabeçalho**

No `page-header` (linha ~203), ao lado do `<h1>`:

```jsx
        <select
          className="dashboard-buoy-select"
          value={selectedBuoy}
          onChange={e => setSelectedBuoy(e.target.value)}
        >
          <option value="todas">Todas as Bóias</option>
          {liveBuoys.map(b => (
            <option key={b.codigo} value={b.codigo}>{b.nome} ({b.codigo})</option>
          ))}
        </select>
```

- [ ] **Step 11: Rodar a suíte inteira, lint e build**

Run: `npx vitest run && npm run lint && npx vite build`
Expected: todos os testes passam (incluindo os 3 novos de `fleetAverage.test.js`), lint na mesma baseline, build sem erro.

- [ ] **Step 12: Verificação manual em navegador real**

Login admin, `/admin/dashboard`. Confirmar que "Todas as Bóias" é o padrão selecionado. Com só a SM-01 tendo hardware real, confirmar que a média da frota bate com o valor dela sozinha (caso trivial). Se possível, publicar leituras de sensor manualmente em 2 `deviceId`s diferentes (um real, um de teste) e confirmar que a média muda de acordo. Trocar o seletor pra uma bóia específica e confirmar que os cards voltam a mostrar só os dados dela, e que gráfico/CSV seguem a bóia selecionada. Publicar `availability` "offline" pra uma bóia e confirmar que ela sai da média e do contador "Online/Operando" do card de frota.

- [ ] **Step 13: Commit**

```bash
git add src/utils/fleetAverage.js src/utils/fleetAverage.test.js src/pages/admin/AdminDashboard.jsx
git commit -m "feat(boias): seletor de boia e media da frota no Centro de Comando"
```
