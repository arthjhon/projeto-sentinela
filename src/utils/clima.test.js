import { describe, it, expect } from 'vitest';
import {
  LIMITE_CHUVA_FORTE_MM, diasLocais, acumuladoProximas, acumuladoUltimas,
  classificarVazao, avisoChuvaForte, frescor, hojeLocal, horaLocal,
} from './clima';

const H = 3600000;
const utc = (s) => Date.parse(s);

describe('diasLocais', () => {
  it('hora 02:30 UTC conta no dia local anterior (UTC-3)', () => {
    const serie = [
      { time: utc('2026-11-22T02:30:00Z'), precipitation: 4 },
      { time: utc('2026-11-22T03:00:00Z'), precipitation: 1 },
    ];
    const dias = diasLocais(serie);
    expect(dias.map((d) => d.dia)).toEqual(['2026-11-21', '2026-11-22']);
    expect(dias[0].chuva_mm).toBe(4);
    expect(dias[1].chuva_mm).toBe(1);
  });
  it('agrega soma, máximos, mínimos e média', () => {
    const base = utc('2026-11-22T12:00:00Z');
    const serie = [
      { time: base, precipitation: 1.5, precipitation_probability: 30, temperature_2m: 25, wind_speed_10m: 10, cloud_cover: 40 },
      { time: base + H, precipitation: 2, precipitation_probability: 80, temperature_2m: 29, wind_speed_10m: 18, cloud_cover: 60 },
    ];
    expect(diasLocais(serie)).toEqual([{
      dia: '2026-11-22', chuva_mm: 3.5, prob_max: 80, temp_min: 25, temp_max: 29, vento_max: 18, nuvens_media: 50,
    }]);
  });
  it('série vazia ou inválida dá []', () => {
    expect(diasLocais([])).toEqual([]);
    expect(diasLocais(null)).toEqual([]);
  });
  it('campo ausente vira null, nunca 0', () => {
    const d = diasLocais([{ time: utc('2026-11-22T12:00:00Z'), precipitation: null, temperature_2m: 27 }])[0];
    expect(d.chuva_mm).toBeNull();
    expect(d.prob_max).toBeNull();
    expect(d.temp_min).toBe(27);
    expect(d.nuvens_media).toBeNull();
  });
  it('ordena por dia', () => {
    const dias = diasLocais([
      { time: utc('2026-11-23T12:00:00Z'), precipitation: 1 },
      { time: utc('2026-11-22T12:00:00Z'), precipitation: 1 },
    ]);
    expect(dias.map((d) => d.dia)).toEqual(['2026-11-22', '2026-11-23']);
  });
});

describe('acumulados', () => {
  const agora = utc('2026-11-22T12:00:00Z');
  const futura = Array.from({ length: 80 }, (_, i) => ({ time: agora + (i + 1) * H, precipitation: 1 }));
  it('próximas 24/48/72 h com borda exata (agora, agora+h]', () => {
    expect(acumuladoProximas(futura, agora, 24)).toBe(24);
    expect(acumuladoProximas(futura, agora, 48)).toBe(48);
    expect(acumuladoProximas(futura, agora, 72)).toBe(72);
  });
  it('exclui o instante agora e inclui agora+h', () => {
    const s = [{ time: agora, precipitation: 9 }, { time: agora + 24 * H, precipitation: 2 }, { time: agora + 24 * H + 1, precipitation: 5 }];
    expect(acumuladoProximas(s, agora, 24)).toBe(2);
  });
  it('sem dado no intervalo = null', () => {
    expect(acumuladoProximas([], agora, 24)).toBeNull();
    expect(acumuladoProximas([{ time: agora + H, precipitation: null }], agora, 24)).toBeNull();
    expect(acumuladoProximas(null, agora, 24)).toBeNull();
  });
  it('últimas 24 h medidas, borda (agora-h, agora]', () => {
    const chuva = Array.from({ length: 80 }, (_, i) => ({ time: agora - i * H, chuva: 0.5 }));
    expect(acumuladoUltimas(chuva, agora, 24)).toBe(12);
    expect(acumuladoUltimas(chuva, agora, 72)).toBe(36);
    expect(acumuladoUltimas([{ time: agora - 24 * H, chuva: 3 }], agora, 24)).toBeNull();
    expect(acumuladoUltimas([], agora, 24)).toBeNull();
  });
  it('ignora valores nulos mas soma os válidos', () => {
    const chuva = [{ time: agora, chuva: 1 }, { time: agora - H, chuva: null }, { time: agora - 2 * H, chuva: 2 }];
    expect(acumuladoUltimas(chuva, agora, 24)).toBe(3);
  });
});

describe('classificarVazao', () => {
  const dias = (n, valor) => Array.from({ length: n }, (_, i) => ({ time: utc('2026-11-01T12:00:00Z') + i * 24 * H, vazao: valor }));
  it('menos de 7 dias de dado: classe null, mediana null', () => {
    const r = classificarVazao(dias(6, 10));
    expect(r.classe).toBeNull();
    expect(r.mediana).toBeNull();
    expect(r.atual).toBe(10);
  });
  it('vazio: tudo null', () => {
    expect(classificarVazao([])).toEqual({ atual: null, hora: null, mediana: null, classe: null });
    expect(classificarVazao(null)).toEqual({ atual: null, hora: null, mediana: null, classe: null });
  });
  it('mediana ímpar e par', () => {
    const imp = dias(7, 10).map((p, i) => ({ ...p, vazao: i + 1 }));
    expect(classificarVazao(imp).mediana).toBe(4);
    const par = dias(8, 10).map((p, i) => ({ ...p, vazao: i + 1 }));
    expect(classificarVazao(par).mediana).toBe(4.5);
  });
  it('bordas 1.5x e 0.5x são normal; além delas, acima/abaixo', () => {
    const com = (atual) => [...dias(9, 10), { time: utc('2026-12-01T12:00:00Z'), vazao: atual }];
    expect(classificarVazao(com(15)).classe).toBe('normal');
    expect(classificarVazao(com(15.01)).classe).toBe('acima');
    expect(classificarVazao(com(5)).classe).toBe('normal');
    expect(classificarVazao(com(4.99)).classe).toBe('abaixo');
  });
  it('atual e hora vêm da última leitura válida', () => {
    const s = [...dias(8, 10), { time: utc('2026-12-02T00:00:00Z'), vazao: null }];
    const r = classificarVazao(s);
    expect(r.atual).toBe(10);
    expect(r.hora).toBe(utc('2026-11-08T12:00:00Z'));
  });
});

describe('avisoChuvaForte', () => {
  const dia = (d, mm) => ({ dia: d, chuva_mm: mm });
  it('limite é 20 mm', () => {
    expect(LIMITE_CHUVA_FORTE_MM).toBe(20);
  });
  it('19.9 não avisa; 20 avisa', () => {
    expect(avisoChuvaForte({ celmm: [dia('2026-11-22', 19.9)] }, '2026-11-22')).toBeNull();
    expect(avisoChuvaForte({ celmm: [dia('2026-11-22', 20)] }, '2026-11-22')).toEqual({ ponto: 'celmm', dia: '2026-11-22', mm: 20 });
  });
  it('só considera hoje + 2 dias', () => {
    const d = { celmm: [dia('2026-11-21', 50), dia('2026-11-24', 20), dia('2026-11-25', 90)] };
    expect(avisoChuvaForte(d, '2026-11-22')).toEqual({ ponto: 'celmm', dia: '2026-11-24', mm: 20 });
    expect(avisoChuvaForte({ celmm: [dia('2026-11-25', 90), dia('2026-11-21', 90)] }, '2026-11-22')).toBeNull();
  });
  it('escolhe o maior entre pontos e dias; virada de mês', () => {
    const d = { celmm: [dia('2026-12-01', 25)], bacia_mundau: [dia('2026-11-30', 40)] };
    expect(avisoChuvaForte(d, '2026-11-30')).toEqual({ ponto: 'bacia_mundau', dia: '2026-11-30', mm: 40 });
    expect(avisoChuvaForte({ celmm: [dia('2026-12-01', 25)] }, '2026-11-30').dia).toBe('2026-12-01');
  });
  it('sem dado / null = null', () => {
    expect(avisoChuvaForte({}, '2026-11-22')).toBeNull();
    expect(avisoChuvaForte(null, '2026-11-22')).toBeNull();
    expect(avisoChuvaForte({ celmm: [dia('2026-11-22', null)] }, '2026-11-22')).toBeNull();
  });
});

describe('frescor', () => {
  const agora = utc('2026-11-22T12:00:00Z');
  it('2h59 ok, 3h exato ok, 3h01 desatualizada', () => {
    expect(frescor(agora - (2 * 60 + 59) * 60000, agora)).toBe('ok');
    expect(frescor(agora - 3 * H, agora)).toBe('ok');
    expect(frescor(agora - (3 * 60 + 1) * 60000, agora)).toBe('desatualizada');
  });
  it('nulo/inválido = sem dado', () => {
    expect(frescor(null, agora)).toBe('sem dado');
    expect(frescor(undefined, agora)).toBe('sem dado');
    expect(frescor(NaN, agora)).toBe('sem dado');
  });
});

describe('hojeLocal', () => {
  it('21:00–23:59 local (00:00–02:59 UTC do dia seguinte) ainda é o dia local anterior', () => {
    expect(hojeLocal(utc('2026-11-23T00:00:00Z'))).toBe('2026-11-22'); // 21:00 local
    expect(hojeLocal(utc('2026-11-23T02:59:59Z'))).toBe('2026-11-22'); // 23:59:59 local
  });
  it('vira à meia-noite local (03:00 UTC)', () => {
    expect(hojeLocal(utc('2026-11-23T03:00:00Z'))).toBe('2026-11-23');
    expect(hojeLocal(utc('2026-11-22T12:00:00Z'))).toBe('2026-11-22');
  });
  it('virada de mês e de ano', () => {
    expect(hojeLocal(utc('2027-01-01T01:30:00Z'))).toBe('2026-12-31');
  });
});

describe('horaLocal', () => {
  it('HH:MM em Maceió (UTC-3)', () => {
    expect(horaLocal(utc('2026-11-23T02:30:00Z'))).toBe('23:30');
    expect(horaLocal(utc('2026-11-22T03:05:00Z'))).toBe('00:05');
    expect(horaLocal(utc('2026-11-22T15:00:00Z'))).toBe('12:00');
  });
  it('sem instante válido = null', () => {
    expect(horaLocal(null)).toBeNull();
    expect(horaLocal(NaN)).toBeNull();
  });
});
