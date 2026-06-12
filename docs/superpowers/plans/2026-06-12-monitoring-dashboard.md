# Dashboard de Monitoramento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a página de Monitoramento numa dashboard pública e didática com várias visualizações (índice de qualidade, semáforo, linhas, saúde do dispositivo, histograma, barras), focada na bóia única SM-01, usando os dados MQTT já existentes.

**Architecture:** Lógica pura isolada em `src/config/waterQuality.js` (testada com Vitest). Cada visualização é um componente focado em `src/components/monitoring/`, recebendo dados por props. `MonitoringPage.jsx` orquestra: conecta MQTT, mantém histórico (~120 pontos), distribui dados.

**Tech Stack:** React 19, Vite, Recharts ^2.15.3, mqtt.js (já em uso). Testes: Vitest (a adicionar).

**Branch:** `dev`. Deploy em prod (push main) só após aprovação do usuário.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/config/waterQuality.js` (criar) | Faixas, cores, e funções puras: classify, WQI, stats, histograma |
| `src/config/waterQuality.test.js` (criar) | Testes unitários das funções puras |
| `src/components/monitoring/WaterQualityIndex.jsx` (criar) | Velocímetro do índice |
| `src/components/monitoring/SemaphoreCards.jsx` (criar) | Cartões semáforo |
| `src/components/monitoring/ThresholdLineChart.jsx` (criar) | Linha temporal c/ faixa saudável |
| `src/components/monitoring/InteractiveChart.jsx` (criar) | Linha multiparâmetro interativa |
| `src/components/monitoring/DeviceHealth.jsx` (criar) | Saúde do dispositivo |
| `src/components/monitoring/MinMaxAvgBars.jsx` (criar) | Barras mín/máx/média |
| `src/components/monitoring/Histogram.jsx` (criar) | Distribuição |
| `src/components/monitoring/monitoring.css` (criar) | Estilos compartilhados dos widgets |
| `src/pages/public/MonitoringPage.jsx` (modificar) | Orquestrador, bóia única, layout |
| `package.json` (modificar) | Script de teste + devDeps vitest |

---

## Task 1: Setup Vitest

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Instalar vitest**

Run: `npm install -D vitest@^2`
Expected: adiciona `vitest` em devDependencies, sem erros.

- [ ] **Step 2: Adicionar script de teste**

Em `package.json`, no objeto `"scripts"`, adicionar a linha `"test": "vitest run"` (e opcional `"test:watch": "vitest"`). Resultado:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "lint": "eslint .",
  "preview": "vite preview",
  "test": "vitest run"
}
```

- [ ] **Step 3: Verificar runner**

Run: `npx vitest run`
Expected: "No test files found" (ainda sem testes) — confirma que o vitest roda.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: adiciona Vitest para testes unitários"
```

---

## Task 2: Config e funções puras de qualidade da água (TDD)

**Files:**
- Create: `src/config/waterQuality.js`
- Test: `src/config/waterQuality.test.js`

- [ ] **Step 1: Escrever os testes (falhando)**

Criar `src/config/waterQuality.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { classifyParam, computeWQI, sessionStats, histogramBins, WATER_PARAMS } from './waterQuality';

describe('classifyParam', () => {
  it('classifica pH dentro do ideal como good', () => {
    expect(classifyParam('ph', 7.5).level).toBe('good');
  });
  it('classifica pH em atenção', () => {
    expect(classifyParam('ph', 8.7).level).toBe('warning');
  });
  it('classifica pH crítico', () => {
    expect(classifyParam('ph', 9.5).level).toBe('critical');
  });
  it('classifica turbidez alta como crítica', () => {
    expect(classifyParam('turbidez', 150).level).toBe('critical');
  });
  it('retorna null para valor ausente', () => {
    expect(classifyParam('ph', null)).toBeNull();
  });
});

describe('computeWQI', () => {
  it('dá 100/BOA quando tudo está no ideal', () => {
    const r = computeWQI({ temperatura: 26, ph: 7.5, turbidez: 10 });
    expect(r.score).toBe(100);
    expect(r.level).toBe('BOA');
  });
  it('cai para RUIM quando há parâmetro crítico', () => {
    const r = computeWQI({ temperatura: 40, ph: 9.8, turbidez: 200 });
    expect(r.score).toBeLessThan(50);
    expect(r.level).toBe('RUIM');
  });
  it('retorna null sem leitura', () => {
    expect(computeWQI(null)).toBeNull();
  });
});

describe('sessionStats', () => {
  it('calcula min/max/avg por parâmetro', () => {
    const h = [
      { temperatura: 20, ph: 7, turbidez: 10 },
      { temperatura: 30, ph: 8, turbidez: 20 },
    ];
    const s = sessionStats(h);
    expect(s.temperatura).toEqual({ min: 20, max: 30, avg: 25 });
    expect(s.ph.avg).toBe(7.5);
  });
  it('ignora nulos', () => {
    const s = sessionStats([{ temperatura: null, ph: 7, turbidez: 10 }]);
    expect(s.temperatura).toBeNull();
    expect(s.ph.avg).toBe(7);
  });
});

describe('histogramBins', () => {
  it('agrupa leituras em bins', () => {
    const h = [{ ph: 6 }, { ph: 7 }, { ph: 7 }, { ph: 8 }];
    const bins = histogramBins(h, 'ph', 4);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(4);
    expect(bins.length).toBe(4);
  });
  it('retorna [] sem dados', () => {
    expect(histogramBins([], 'ph', 4)).toEqual([]);
  });
});

describe('WATER_PARAMS', () => {
  it('tem os 3 parâmetros', () => {
    expect(WATER_PARAMS.map(p => p.key)).toEqual(['temperatura', 'ph', 'turbidez']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/config/waterQuality.test.js`
Expected: FAIL — "Failed to resolve import './waterQuality'".

- [ ] **Step 3: Implementar `waterQuality.js`**

Criar `src/config/waterQuality.js`:

```js
import { Thermometer, Droplet, Activity } from 'lucide-react';

// Faixas saudáveis (CONAMA 357 — águas estuarinas, ajustáveis aqui).
// ideal: [min, max] verde. warningLow/warningHigh limites amarelos. fora = crítico.
export const WATER_PARAMS = [
  { key: 'temperatura', label: 'Temperatura', unit: '°C', decimals: 1, icon: Thermometer, color: '#ff7043',
    thresholds: { ideal: [22, 30], warning: [18, 32], abs: [10, 45] } },
  { key: 'ph', label: 'pH', unit: '', decimals: 2, icon: Droplet, color: '#00f0ff',
    thresholds: { ideal: [6.5, 8.5], warning: [6.0, 9.0], abs: [0, 14] } },
  { key: 'turbidez', label: 'Turbidez', unit: 'NTU', decimals: 1, icon: Activity, color: '#b388ff',
    thresholds: { ideal: [0, 40], warning: [0, 100], abs: [0, 400] } },
];

const byKey = Object.fromEntries(WATER_PARAMS.map(p => [p.key, p]));

const TEXT = {
  good:     'Saudável',
  warning:  'Atenção',
  critical: 'Crítico',
};
const COLOR = { good: '#22c55e', warning: '#eab308', critical: '#ef4444' };

// Classifica um valor em good | warning | critical para um parâmetro.
export function classifyParam(key, value) {
  const p = byKey[key];
  if (p == null || value == null || Number.isNaN(value)) return null;
  const { ideal, warning } = p.thresholds;
  let level;
  if (value >= ideal[0] && value <= ideal[1]) level = 'good';
  else if (value >= warning[0] && value <= warning[1]) level = 'warning';
  else level = 'critical';
  return { level, text: TEXT[level], color: COLOR[level] };
}

// Sub-score 0..100 conforme proximidade do ideal.
function subScore(key, value) {
  const p = byKey[key];
  const { ideal, warning, abs } = p.thresholds;
  if (value >= ideal[0] && value <= ideal[1]) return 100;
  // distância normalizada na faixa de atenção -> 100..50; no crítico -> 50..0
  const side = value < ideal[0] ? 'low' : 'high';
  if (side === 'high') {
    if (value <= warning[1]) return 100 - 50 * (value - ideal[1]) / (warning[1] - ideal[1]);
    return Math.max(0, 50 - 50 * (value - warning[1]) / Math.max(1, abs[1] - warning[1]));
  } else {
    if (value >= warning[0]) return 100 - 50 * (ideal[0] - value) / (ideal[0] - warning[0]);
    return Math.max(0, 50 - 50 * (warning[0] - value) / Math.max(1, warning[0] - abs[0]));
  }
}

// Índice de Qualidade da Água: média dos sub-scores + classificação.
export function computeWQI(reading) {
  if (!reading) return null;
  const valid = WATER_PARAMS.filter(p => reading[p.key] != null && !Number.isNaN(reading[p.key]));
  if (valid.length === 0) return null;
  const total = valid.reduce((s, p) => s + subScore(p.key, reading[p.key]), 0);
  const score = Math.round(total / valid.length);
  const level = score >= 75 ? 'BOA' : score >= 50 ? 'REGULAR' : 'RUIM';
  const color = level === 'BOA' ? '#22c55e' : level === 'REGULAR' ? '#eab308' : '#ef4444';
  return { score, level, color };
}

// min/max/avg por parâmetro a partir do histórico.
export function sessionStats(history) {
  const out = {};
  for (const p of WATER_PARAMS) {
    const vals = history.map(h => h[p.key]).filter(v => v != null && !Number.isNaN(v));
    out[p.key] = vals.length
      ? { min: Math.min(...vals), max: Math.max(...vals), avg: vals.reduce((a, b) => a + b, 0) / vals.length }
      : null;
  }
  return out;
}

// Bins para histograma de um parâmetro.
export function histogramBins(history, key, nBins = 8) {
  const vals = history.map(h => h[key]).filter(v => v != null && !Number.isNaN(v));
  if (vals.length === 0) return [];
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max - min) || 1;
  const step = span / nBins;
  const bins = Array.from({ length: nBins }, (_, i) => ({
    label: (min + i * step).toFixed(1),
    count: 0,
  }));
  for (const v of vals) {
    let idx = Math.floor((v - min) / step);
    if (idx >= nBins) idx = nBins - 1;
    bins[idx].count++;
  }
  return bins;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/config/waterQuality.test.js`
Expected: PASS (todos os testes verdes).

- [ ] **Step 5: Commit**

```bash
git add src/config/waterQuality.js src/config/waterQuality.test.js
git commit -m "feat(monitoring): config e funções puras de qualidade da água (WQI, classify, stats, histograma)"
```

---

## Task 3: WaterQualityIndex (velocímetro)

**Files:**
- Create: `src/components/monitoring/WaterQualityIndex.jsx`
- Create: `src/components/monitoring/monitoring.css`

- [ ] **Step 1: Criar `monitoring.css` (base compartilhada)**

```css
.mon-widget { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px; padding: 16px; }
.mon-widget-title { font-size: 12px; letter-spacing: .06em; text-transform: uppercase;
  color: #8aa0b6; margin-bottom: 12px; display:flex; align-items:center; gap:8px; }
.mon-grid { display: grid; gap: 14px; }
.mon-empty { color:#64748b; font-size:13px; text-align:center; padding:24px 0; }
@media (max-width: 720px){ .mon-grid { grid-template-columns: 1fr !important; } }
```

- [ ] **Step 2: Implementar o componente**

```jsx
import React from 'react';
import { RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts';
import { computeWQI } from '../../config/waterQuality';
import './monitoring.css';

export default function WaterQualityIndex({ reading }) {
  const wqi = computeWQI(reading);
  return (
    <div className="mon-widget" style={{ textAlign: 'center' }}>
      <div className="mon-widget-title">Índice de Qualidade da Água</div>
      {!wqi ? (
        <div className="mon-empty">Aguardando leitura…</div>
      ) : (
        <>
          <RadialBarChart width={180} height={120} cx={90} cy={100} innerRadius={62} outerRadius={86}
            startAngle={180} endAngle={0} data={[{ value: wqi.score, fill: wqi.color }]}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar background={{ fill: 'rgba(255,255,255,0.06)' }} dataKey="value" cornerRadius={8} />
          </RadialBarChart>
          <div style={{ marginTop: -34 }}>
            <div style={{ fontSize: 30, fontWeight: 800, color: wqi.color }}>{wqi.score}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: wqi.color, letterSpacing: '.05em' }}>{wqi.level}</div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build OK (sem erro de import/sintaxe).

- [ ] **Step 4: Commit**

```bash
git add src/components/monitoring/WaterQualityIndex.jsx src/components/monitoring/monitoring.css
git commit -m "feat(monitoring): widget velocímetro do índice de qualidade"
```

---

## Task 4: SemaphoreCards

**Files:**
- Create: `src/components/monitoring/SemaphoreCards.jsx`

- [ ] **Step 1: Implementar**

```jsx
import React from 'react';
import { WATER_PARAMS, classifyParam } from '../../config/waterQuality';
import './monitoring.css';

export default function SemaphoreCards({ reading }) {
  return (
    <div className="mon-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
      {WATER_PARAMS.map(p => {
        const val = reading?.[p.key];
        const c = classifyParam(p.key, val);
        const color = c?.color ?? '#64748b';
        return (
          <div key={p.key} className="mon-widget" style={{ borderColor: color, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 14, height: 14, borderRadius: '50%', background: color, boxShadow: `0 0 10px ${color}` }} />
            <div>
              <div style={{ fontSize: 12, color: '#8aa0b6' }}>{p.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color }}>
                {val != null ? val.toFixed(p.decimals) : '--'} {p.unit}
              </div>
              <div style={{ fontSize: 12, color }}>{c?.text ?? 'sem dados'}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Build + Commit**

```bash
npm run build && git add src/components/monitoring/SemaphoreCards.jsx && git commit -m "feat(monitoring): cartões semáforo por parâmetro"
```
Expected: build OK.

---

## Task 5: ThresholdLineChart (linha c/ faixa saudável)

**Files:**
- Create: `src/components/monitoring/ThresholdLineChart.jsx`

- [ ] **Step 1: Implementar**

```jsx
import React, { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea, ResponsiveContainer } from 'recharts';
import { WATER_PARAMS } from '../../config/waterQuality';
import './monitoring.css';

export default function ThresholdLineChart({ history }) {
  const [key, setKey] = useState('temperatura');
  const p = WATER_PARAMS.find(x => x.key === key);
  const [lo, hi] = p.thresholds.ideal;

  return (
    <div className="mon-widget">
      <div className="mon-widget-title" style={{ justifyContent: 'space-between' }}>
        <span>Série temporal com faixa saudável</span>
        <span style={{ display: 'flex', gap: 6 }}>
          {WATER_PARAMS.map(x => (
            <button key={x.key} onClick={() => setKey(x.key)}
              style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${key === x.key ? x.color : 'rgba(255,255,255,.15)'}`,
                background: key === x.key ? x.color + '22' : 'transparent', color: key === x.key ? x.color : '#8aa0b6' }}>
              {x.label}
            </button>
          ))}
        </span>
      </div>
      {history.length === 0 ? (
        <div className="mon-empty">Aguardando os primeiros dados…</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="time" tick={{ fill: '#555', fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#555', fontSize: 11 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
            <ReferenceArea y1={lo} y2={hi} fill="#22c55e" fillOpacity={0.10} stroke="#22c55e" strokeOpacity={0.25} strokeDasharray="3 3" />
            <Tooltip contentStyle={{ background: '#0D141F', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 13 }}
              formatter={v => [`${v?.toFixed(p.decimals)} ${p.unit}`, p.label]} />
            <Area type="monotone" dataKey={key} stroke={p.color} strokeWidth={2} fill={p.color} fillOpacity={0.12} dot={false} connectNulls />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build + Commit**

```bash
npm run build && git add src/components/monitoring/ThresholdLineChart.jsx && git commit -m "feat(monitoring): linha temporal com faixa saudável"
```
Expected: build OK.

---

## Task 6: InteractiveChart (multiparâmetro interativo)

**Files:**
- Create: `src/components/monitoring/InteractiveChart.jsx`

- [ ] **Step 1: Implementar**

Interações: toggle de séries (chips), crosshair/tooltip rico (Tooltip padrão com todas as séries), zoom por intervalo (`<Brush>`), pausar (botão controla prop `paused` no pai — aqui só o botão e callback).

```jsx
import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Brush, ResponsiveContainer } from 'recharts';
import { Pause, Play } from 'lucide-react';
import { WATER_PARAMS } from '../../config/waterQuality';
import './monitoring.css';

export default function InteractiveChart({ history, paused, onTogglePause }) {
  const [visible, setVisible] = useState(() => Object.fromEntries(WATER_PARAMS.map(p => [p.key, true])));
  const toggle = k => setVisible(v => ({ ...v, [k]: !v[k] }));

  return (
    <div className="mon-widget">
      <div className="mon-widget-title" style={{ justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {WATER_PARAMS.map(p => (
            <button key={p.key} onClick={() => toggle(p.key)}
              style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                border: `1px solid ${p.color}55`, background: 'transparent', color: visible[p.key] ? p.color : '#475569',
                textDecoration: visible[p.key] ? 'none' : 'line-through' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: visible[p.key] ? p.color : '#475569' }} />
              {p.label}
            </button>
          ))}
        </span>
        <button onClick={onTogglePause} title={paused ? 'Retomar' : 'Pausar'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid rgba(255,255,255,.15)', background: paused ? '#eab30822' : 'transparent', color: paused ? '#eab308' : '#8aa0b6' }}>
          {paused ? <Play size={13} /> : <Pause size={13} />}{paused ? 'Pausado' : 'Ao vivo'}
        </button>
      </div>
      {history.length === 0 ? (
        <div className="mon-empty">Aguardando os primeiros dados…</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="time" tick={{ fill: '#555', fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#555', fontSize: 11 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
            <Tooltip contentStyle={{ background: '#0D141F', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#888' }} />
            {WATER_PARAMS.filter(p => visible[p.key]).map(p => (
              <Line key={p.key} type="monotone" dataKey={p.key} name={p.label} stroke={p.color}
                strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            ))}
            <Brush dataKey="time" height={22} stroke="#00f0ff" fill="rgba(0,240,255,0.06)" travellerWidth={8} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build + Commit**

```bash
npm run build && git add src/components/monitoring/InteractiveChart.jsx && git commit -m "feat(monitoring): gráfico interativo (toggle, crosshair, zoom, pausar)"
```
Expected: build OK.

---

## Task 7: DeviceHealth

**Files:**
- Create: `src/components/monitoring/DeviceHealth.jsx`

- [ ] **Step 1: Implementar**

Recebe `status` (payload `/status`) e `battery` (do fleet.js). Mostra bateria em rosca + stats. `uptime` em segundos → formatar.

```jsx
import React from 'react';
import { RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts';
import { Wifi, Clock, Cpu, Timer, BatteryCharging } from 'lucide-react';
import './monitoring.css';

function fmtUptime(s) {
  if (s == null) return '--';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function DeviceHealth({ status, battery }) {
  const stats = [
    { icon: Wifi, label: 'Sinal RSSI', value: status?.rssi != null ? `${status.rssi.toFixed(0)} dBm` : '--' },
    { icon: Cpu, label: 'Memória livre', value: status?.free_heap != null ? `${(status.free_heap / 1024).toFixed(0)} KB` : '--' },
    { icon: Clock, label: 'Uptime', value: fmtUptime(status?.uptime) },
    { icon: Timer, label: 'Latência MQTT', value: status?.mqtt_latency != null ? `${status.mqtt_latency} ms` : '--' },
    { icon: BatteryCharging, label: 'Firmware', value: status?.firmware ?? '--' },
  ];
  const bat = battery ?? 0;
  const batColor = bat > 50 ? '#22c55e' : bat > 20 ? '#eab308' : '#ef4444';

  return (
    <div className="mon-widget">
      <div className="mon-widget-title">Saúde do dispositivo</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ textAlign: 'center' }}>
          <RadialBarChart width={120} height={120} cx={60} cy={60} innerRadius={42} outerRadius={56}
            startAngle={90} endAngle={-270} data={[{ value: bat, fill: batColor }]}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar background={{ fill: 'rgba(255,255,255,0.06)' }} dataKey="value" cornerRadius={8} />
          </RadialBarChart>
          <div style={{ marginTop: -74, fontSize: 20, fontWeight: 800, color: batColor }}>{bat}%</div>
          <div style={{ marginTop: 40, fontSize: 11, color: '#8aa0b6' }}>Bateria</div>
        </div>
        <div className="mon-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(120px,1fr))', flex: 1 }}>
          {stats.map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <s.icon size={16} color="#00f0ff" />
              <div>
                <div style={{ fontSize: 11, color: '#8aa0b6' }}>{s.label}</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#dce7f2' }}>{s.value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build + Commit**

```bash
npm run build && git add src/components/monitoring/DeviceHealth.jsx && git commit -m "feat(monitoring): painel de saúde do dispositivo (status MQTT + bateria)"
```
Expected: build OK.

---

## Task 8: MinMaxAvgBars

**Files:**
- Create: `src/components/monitoring/MinMaxAvgBars.jsx`

- [ ] **Step 1: Implementar**

```jsx
import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { WATER_PARAMS, sessionStats } from '../../config/waterQuality';
import './monitoring.css';

export default function MinMaxAvgBars({ history }) {
  const [key, setKey] = useState('temperatura');
  const p = WATER_PARAMS.find(x => x.key === key);
  const stats = sessionStats(history)[key];
  const data = stats ? [
    { label: 'Mín', value: +stats.min.toFixed(p.decimals) },
    { label: 'Média', value: +stats.avg.toFixed(p.decimals) },
    { label: 'Máx', value: +stats.max.toFixed(p.decimals) },
  ] : [];

  return (
    <div className="mon-widget">
      <div className="mon-widget-title" style={{ justifyContent: 'space-between' }}>
        <span>Mín / Média / Máx</span>
        <span style={{ display: 'flex', gap: 6 }}>
          {WATER_PARAMS.map(x => (
            <button key={x.key} onClick={() => setKey(x.key)}
              style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${key === x.key ? x.color : 'rgba(255,255,255,.15)'}`,
                background: key === x.key ? x.color + '22' : 'transparent', color: key === x.key ? x.color : '#8aa0b6' }}>
              {x.label}
            </button>
          ))}
        </span>
      </div>
      {!stats ? <div className="mon-empty">Sem leituras ainda…</div> : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="label" tick={{ fill: '#8aa0b6', fontSize: 12 }} tickLine={false} />
            <YAxis tick={{ fill: '#555', fontSize: 11 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
            <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              contentStyle={{ background: '#0D141F', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }}
              formatter={v => [`${v} ${p.unit}`, p.label]} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]}>
              {data.map((_, i) => <Cell key={i} fill={p.color} fillOpacity={i === 1 ? 1 : 0.5} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build + Commit**

```bash
npm run build && git add src/components/monitoring/MinMaxAvgBars.jsx && git commit -m "feat(monitoring): barras mín/média/máx por parâmetro"
```
Expected: build OK.

---

## Task 9: Histogram

**Files:**
- Create: `src/components/monitoring/Histogram.jsx`

- [ ] **Step 1: Implementar**

```jsx
import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { WATER_PARAMS, histogramBins } from '../../config/waterQuality';
import './monitoring.css';

export default function Histogram({ history }) {
  const [key, setKey] = useState('temperatura');
  const p = WATER_PARAMS.find(x => x.key === key);
  const bins = histogramBins(history, key, 8);

  return (
    <div className="mon-widget">
      <div className="mon-widget-title" style={{ justifyContent: 'space-between' }}>
        <span>Distribuição das leituras</span>
        <span style={{ display: 'flex', gap: 6 }}>
          {WATER_PARAMS.map(x => (
            <button key={x.key} onClick={() => setKey(x.key)}
              style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${key === x.key ? x.color : 'rgba(255,255,255,.15)'}`,
                background: key === x.key ? x.color + '22' : 'transparent', color: key === x.key ? x.color : '#8aa0b6' }}>
              {x.label}
            </button>
          ))}
        </span>
      </div>
      {bins.length === 0 ? <div className="mon-empty">Sem leituras ainda…</div> : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={bins} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="label" tick={{ fill: '#555', fontSize: 10 }} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: '#555', fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              contentStyle={{ background: '#0D141F', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }}
              formatter={v => [`${v} leituras`, `≈ ${p.label}`]} />
            <Bar dataKey="count" fill={p.color} fillOpacity={0.7} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build + Commit**

```bash
npm run build && git add src/components/monitoring/Histogram.jsx && git commit -m "feat(monitoring): histograma de distribuição das leituras"
```
Expected: build OK.

---

## Task 10: Refatorar MonitoringPage (orquestrador, bóia única, layout)

**Files:**
- Modify: `src/pages/public/MonitoringPage.jsx` (substituir conteúdo)

- [ ] **Step 1: Reescrever a página**

Substituir `src/pages/public/MonitoringPage.jsx` inteiro por:

```jsx
import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, Thermometer, Droplet, Activity, MapPin } from 'lucide-react';
import { useMqtt } from '../../hooks/useMqtt';
import { FLEET, getMqttTopics } from '../../config/fleet';
import { WATER_PARAMS, classifyParam } from '../../config/waterQuality';
import InteractiveMap from '../../components/public/InteractiveMap';
import WaterQualityIndex from '../../components/monitoring/WaterQualityIndex';
import SemaphoreCards from '../../components/monitoring/SemaphoreCards';
import ThresholdLineChart from '../../components/monitoring/ThresholdLineChart';
import InteractiveChart from '../../components/monitoring/InteractiveChart';
import DeviceHealth from '../../components/monitoring/DeviceHealth';
import MinMaxAvgBars from '../../components/monitoring/MinMaxAvgBars';
import Histogram from '../../components/monitoring/Histogram';
import './MonitoringPage.css';

const ICONS = { temperatura: Thermometer, ph: Droplet, turbidez: Activity };
const MAX_HISTORY = 120;
const BUOY = FLEET.find(b => b.deviceId) || FLEET[0];

const MonitoringPage = () => {
  const [history, setHistory] = useState([]);
  const [paused, setPaused] = useState(false);

  const { messages, connected } = useMqtt(getMqttTopics(['sensores', 'status']));
  const sensorTopic = BUOY.deviceId ? `${BUOY.deviceId}/sensores` : null;
  const statusTopic = BUOY.deviceId ? `${BUOY.deviceId}/status` : null;
  const latestData  = sensorTopic ? messages[sensorTopic] : null;
  const latestStatus = statusTopic ? messages[statusTopic] : null;

  useEffect(() => {
    if (!latestData || paused) return;
    const point = {
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      temperatura: latestData.temperatura ?? null,
      ph: latestData.ph ?? null,
      turbidez: latestData.turbidez ?? null,
    };
    setHistory(prev => [...prev, point].slice(-MAX_HISTORY));
  }, [latestData, paused]);

  const isLive = connected && !!BUOY.deviceId;
  const activeArea = BUOY.location.includes('Mundaú') ? 'mundau' : 'manguaba';

  return (
    <div className="monitoring-page">
      {/* Header */}
      <div className="mon-header">
        <div className="mon-title-group">
          <div className={`live-badge ${isLive ? 'live' : 'offline'}`}>
            <span className="live-dot" />
            {isLive ? 'AO VIVO' : BUOY.deviceId ? 'SEM SINAL' : 'SEM HARDWARE'}
          </div>
          <h1 className="mon-title">Monitoramento Estuarino</h1>
          <p className="mon-subtitle">{BUOY.id} · {BUOY.name} — {BUOY.location}</p>
        </div>
        <div className={`mqtt-status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
          MQTT {connected ? 'Online' : 'Offline'}
        </div>
      </div>

      {/* KPIs + Velocímetro */}
      <div className="mon-top-grid">
        <div className="metric-grid">
          {WATER_PARAMS.map(param => {
            const Icon = ICONS[param.key];
            const val = latestData?.[param.key];
            const c = classifyParam(param.key, val);
            return (
              <div key={param.key} className="metric-card glass" style={{ '--c': param.color }}>
                <div className="metric-card-top">
                  <Icon size={18} style={{ color: param.color }} />
                  <span className="metric-label">{param.label}</span>
                </div>
                <div className="metric-value" style={{ color: param.color }}>
                  {val != null ? val.toFixed(param.decimals) : '--'}
                  {param.unit && <span className="metric-unit">{param.unit}</span>}
                </div>
                <span className="metric-hint">{c ? c.text : (!BUOY.deviceId ? 'sem hardware' : !connected ? 'sem sinal' : 'aguardando…')}</span>
              </div>
            );
          })}
        </div>
        <WaterQualityIndex reading={latestData} />
      </div>

      <SemaphoreCards reading={latestData} />
      <InteractiveChart history={history} paused={paused} onTogglePause={() => setPaused(p => !p)} />
      <ThresholdLineChart history={history} />
      <div className="mon-two-col">
        <MinMaxAvgBars history={history} />
        <Histogram history={history} />
      </div>
      <DeviceHealth status={latestStatus} battery={BUOY.battery} />

      {/* Mapa */}
      <div className="mon-map-section glass">
        <div className="mon-map-header">
          <MapPin size={18} color="var(--primary)" />
          <h3>Digital Twin — Mapa de Telemetria</h3>
        </div>
        <p className="mon-map-desc">Bóia {BUOY.id} plotada em coordenadas reais do CEMM.</p>
        <InteractiveMap activeArea={activeArea} />
      </div>
    </div>
  );
};

export default MonitoringPage;
```

- [ ] **Step 2: Adicionar layout CSS em `MonitoringPage.css`**

Anexar ao final de `src/pages/public/MonitoringPage.css`:

```css
.monitoring-page > * { margin-bottom: 18px; }
.mon-top-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 18px; align-items: start; }
.mon-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
@media (max-width: 860px) {
  .mon-top-grid, .mon-two-col { grid-template-columns: 1fr; }
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build OK, sem warnings de import.

- [ ] **Step 4: Verificação manual (dev server)**

Run: `npm run dev` e abrir `http://localhost:5173/monitoramento` (ou a rota da página).
Expected: dashboard renderiza com header, KPIs, velocímetro, semáforo, gráfico interativo, linha c/ faixa, barras, histograma, saúde do device e mapa. Sem erros no console. (Com MQTT ao vivo os widgets populam; sem dados, mostram estados vazios elegantes.)

- [ ] **Step 5: Commit**

```bash
git add src/pages/public/MonitoringPage.jsx src/pages/public/MonitoringPage.css
git commit -m "feat(monitoring): dashboard completa — orquestra widgets, bóia única, layout responsivo"
```

---

## Task 11: Rodar testes e lint final

- [ ] **Step 1: Testes**

Run: `npm run test`
Expected: todos os testes de `waterQuality.test.js` passam.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: sem erros (corrigir imports não usados se houver).

- [ ] **Step 3: Push da dev (sem prod)**

```bash
git push origin dev
```
Expected: push OK. **NÃO** mexer na main/prod — aguardar aprovação do usuário.

---

## Notas de execução

- **Não fazer deploy em prod** (push main) nesta execução. Após o usuário validar a dashboard na `dev`, levar os commits relevantes para a `main` (cherry-pick), como no fluxo do projeto.
- Preservar o WIP existente da `dev` (`.gitignore`, `Hero.css`, `SupportersPage.*` modificados; `Dockerfile`/`nginx.conf`/`docs/` soltos) — commitar apenas os arquivos de cada task.
- A bateria vem de `fleet.js` (estática) até o firmware publicá-la no `/status`.
