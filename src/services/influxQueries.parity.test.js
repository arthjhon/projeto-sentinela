// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildNamedQuery, QUERY_NAMES } from './influxQueries';

// Paridade nginx <-> JS: lê os modelos reais do nginx (proxy_pass de cada
// `location = /influx/q/<nome>`) e os `map` de validação, preenche com cada
// conjunto de parâmetros válido e exige o mesmo InfluxQL de buildNamedQuery.
// Falha se um modelo ou um map mudar só de um lado.

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const conf = read('../../infra/nginx/sentinela-influx-proxy.conf');
const http = read('../../infra/nginx/sentinela-http.conf');

// map $arg_<param> $<var> { chave valor; ... }
const maps = {};
for (const m of http.matchAll(/map \$arg_(\w+) \$(\w+) \{([\s\S]*?)\n\}/g)) {
  const entries = [];
  for (const line of m[3].split('\n')) {
    const t = line.replace(/#.*/, '').trim();
    if (!t) continue;
    const mm = t.match(/^("[^"]*"|\S+)\s+("[^"]*"|\S+);$/);
    if (!mm) continue;
    entries.push([mm[1].replace(/^"|"$/g, ''), mm[2].replace(/^"|"$/g, '')]);
  }
  maps[m[2]] = { arg: m[1], entries };
}

function mapValue(variable, args) {
  const { arg, entries } = maps[variable];
  const v = args[arg] ?? '';
  let fallback = '';
  for (const [key, val] of entries) {
    if (key === 'default') { fallback = val; continue; }
    if (key.startsWith('~')) {
      const r = v.match(new RegExp(key.slice(1)));
      if (r) return val.replace('${d}', r.groups.d);
    } else if (key.toLowerCase() === v.toLowerCase()) {
      return val;
    }
  }
  return fallback;
}

const templates = {};
for (const m of conf.matchAll(/location = \/influx\/q\/([\w-]+) \{[\s\S]*?proxy_pass (\S+);/g)) {
  templates[m[1]] = m[2];
}

function nginxQuery(name, args) {
  const url = templates[name].replace(/\$(influx_\w+)/g, (_, v) => mapValue(v, args));
  return new URL(url).searchParams.get('q');
}

const cases = [];
for (const campo of ['ph', 'turbidez', 'temperatura']) {
  for (const periodo of ['1h', '24h', '7d', '30d']) {
    cases.push(['history', { campo, periodo }]);
    cases.push(['history', { campo, periodo, device: 'esp_x' }]);
  }
}
for (const periodo of ['24h', '30d']) cases.push(['ultimas', { device: 'esp_sururu', periodo }]);
for (const periodo of ['1h', '24h', '7d', '30d']) cases.push(['export', { device: 'A-z_9', periodo }]);
cases.push(['leituras-24h', {}], ['primeira', {}]);

describe('paridade nginx <-> buildNamedQuery', () => {
  it('cobre exatamente os endpoints nomeados do nginx', () => {
    expect(Object.keys(templates).sort()).toEqual([...QUERY_NAMES].sort());
  });

  it.each(cases)('%s %j', (name, args) => {
    expect(nginxQuery(name, args)).toBe(buildNamedQuery(name, args));
  });
});
