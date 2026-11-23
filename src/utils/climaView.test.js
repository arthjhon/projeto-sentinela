import { describe, it, expect } from 'vitest';
import {
  JOB_PREVISAO, formatMm, formatNum, rotuloDia, quandoLocal, estadoBusca, modeloClima,
} from './climaView';

const H = 3600000;
const utc = (s) => Date.parse(s);
// 2026-11-22 12:00 local (15:00 UTC)
const AGORA = utc('2026-11-22T15:00:00Z');

const ok = (dados) => ({ dados, erro: null, carregando: false });
const horas = (inicioIso, n, f) => Array.from({ length: n }, (_, i) => f(utc(inicioIso) + i * H, i));

describe('formatação', () => {
  it('mm com uma casa (pt-BR); ausente = "sem dado"', () => {
    expect(formatMm(12.34)).toBe('12,3 mm');
    expect(formatMm(0)).toBe('0,0 mm');
    expect(formatMm(null)).toBe('sem dado');
    expect(formatMm(undefined)).toBe('sem dado');
  });
  it('número com unidade; ausente = "sem dado"', () => {
    expect(formatNum(27.25, 1, '°C')).toBe('27,3 °C');
    expect(formatNum(1234.5, 0, 'm³/s')).toBe('1.235 m³/s');
    expect(formatNum(null, 1, '°C')).toBe('sem dado');
  });
  it('rótulo do dia: hoje, amanhã, depois dia da semana + data', () => {
    expect(rotuloDia('2026-11-22', '2026-11-22')).toBe('Hoje');
    expect(rotuloDia('2026-11-23', '2026-11-22')).toBe('Amanhã');
    expect(rotuloDia('2026-11-25', '2026-11-22')).toBe('qua 25/11');
    expect(rotuloDia('2026-12-01', '2026-11-30')).toBe('Amanhã');
  });
  it('quando: hora local, com data se não for hoje', () => {
    expect(quandoLocal(utc('2026-11-22T14:10:00Z'), AGORA)).toBe('hoje às 11:10');
    expect(quandoLocal(utc('2026-11-22T01:00:00Z'), AGORA)).toBe('21/11 às 22:00');
    expect(quandoLocal(null, AGORA)).toBeNull();
  });
});

describe('estadoBusca', () => {
  it('carregando, erro, vazio e ok', () => {
    expect(estadoBusca(undefined)).toBe('carregando');
    expect(estadoBusca({ dados: null, erro: null, carregando: true })).toBe('carregando');
    expect(estadoBusca({ dados: null, erro: 'Influx 502', carregando: false })).toBe('erro');
    expect(estadoBusca(ok([]))).toBe('vazio');
    expect(estadoBusca(ok([{ time: 1 }]))).toBe('ok');
  });
  it('dado antigo continua valendo enquanto recarrega ou se a nova busca falhar', () => {
    expect(estadoBusca({ dados: [{ time: 1 }], erro: 'Influx 502', carregando: false })).toBe('ok');
    expect(estadoBusca({ dados: [{ time: 1 }], erro: null, carregando: true })).toBe('ok');
  });
});

describe('modeloClima — lagoa', () => {
  // 24 h passadas da coleta até +7 d, 1 mm/h na lagoa
  const serieLagoa = horas('2026-11-21T15:00:00Z', 24 + 7 * 24, (time) => ({
    time, precipitation: 0.5, precipitation_probability: 40, temperature_2m: 26, wind_speed_10m: 12, cloud_cover: 50,
  }));

  it('dias de hoje em diante (até 8), com rótulo e dia parcial marcado', () => {
    const m = modeloClima({ lagoa: ok(serieLagoa), bacia: ok([]), ana: ok({ chuva: [], vazao: [] }), jobs: [], agoraMs: AGORA });
    expect(m.hoje).toBe('2026-11-22');
    expect(m.lagoa.estado).toBe('ok');
    expect(m.lagoa.dias[0]).toMatchObject({ dia: '2026-11-22', rotulo: 'Hoje', horas: 24, parcial: false, chuva_mm: 12 });
    expect(m.lagoa.dias[1].rotulo).toBe('Amanhã');
    expect(m.lagoa.dias.length).toBe(8);
    const ultimo = m.lagoa.dias[m.lagoa.dias.length - 1];
    expect(ultimo.parcial).toBe(true);
    expect(ultimo.horas).toBeLessThan(24);
  });

  it('hoje hora a hora: só as horas do dia local, em hora de Maceió', () => {
    const m = modeloClima({ lagoa: ok(serieLagoa), bacia: ok([]), ana: ok({ chuva: [], vazao: [] }), jobs: [], agoraMs: AGORA });
    expect(m.lagoa.horas.length).toBe(24);
    expect(m.lagoa.horas[0]).toMatchObject({ hora: '00:00', chuva: 0.5, temp: 26, vento: 12, prob: 40 });
    expect(m.lagoa.horas[23].hora).toBe('23:00');
  });

  it('série vazia = vazio, sem dias nem horas', () => {
    const m = modeloClima({ lagoa: ok([]), bacia: ok([]), ana: ok({ chuva: [], vazao: [] }), jobs: [], agoraMs: AGORA });
    expect(m.lagoa.estado).toBe('vazio');
    expect(m.lagoa.dias).toEqual([]);
    expect(m.lagoa.horas).toEqual([]);
  });

  it('busca falhou sem dado anterior = erro com a mensagem', () => {
    const m = modeloClima({ lagoa: { dados: null, erro: 'Influx 502', carregando: false }, bacia: undefined, ana: undefined, jobs: undefined, agoraMs: AGORA });
    expect(m.lagoa).toMatchObject({ estado: 'erro', erro: 'Influx 502', dias: [], horas: [] });
    expect(m.bacia.previsto.estado).toBe('carregando');
    expect(m.rio.estado).toBe('carregando');
  });
});

describe('modeloClima — aviso de chuva forte', () => {
  const base = { ana: ok({ chuva: [], vazao: [] }), jobs: [], agoraMs: AGORA };
  it('liga com >= 20 mm previstos num dia (hoje..depois de amanhã) e diz onde', () => {
    // 25 mm amanhã à tarde na bacia (15:00–19:00 UTC de 23/11 = 12:00–16:00 local)
    const bacia = horas('2026-11-23T15:00:00Z', 5, (time) => ({ time, precipitation: 5 }));
    const m = modeloClima({ ...base, lagoa: ok([]), bacia: ok(bacia) });
    expect(m.aviso).toMatchObject({ ponto: 'bacia_mundau', rotuloPonto: 'bacia do Mundaú', dia: '2026-11-23', rotuloDia: 'Amanhã', mm: 25 });
  });
  it('chuva das 21:00–23:59 local conta no dia local certo', () => {
    // 21:00–23:00 local de hoje = 00:00–02:00 UTC de 23/11: 3 × 7 mm = 21 mm em HOJE
    const lagoa = horas('2026-11-23T00:00:00Z', 3, (time) => ({ time, precipitation: 7 }));
    const m = modeloClima({ ...base, lagoa: ok(lagoa), bacia: ok([]) });
    expect(m.aviso).toMatchObject({ ponto: 'celmm', dia: '2026-11-22', rotuloDia: 'Hoje', mm: 21 });
  });
  it('abaixo do limite = sem aviso', () => {
    const lagoa = horas('2026-11-22T15:00:00Z', 3, (time) => ({ time, precipitation: 6 }));
    expect(modeloClima({ ...base, lagoa: ok(lagoa), bacia: ok([]) }).aviso).toBeNull();
  });
  it('lista os pontos sem previsão (o aviso só considera os outros)', () => {
    const m = modeloClima({ ...base, lagoa: ok([{ time: AGORA + H, precipitation: 1 }]), bacia: { dados: null, erro: 'x', carregando: false } });
    expect(m.avisoSemPonto).toEqual(['bacia do Mundaú']);
    const m2 = modeloClima({ ...base, lagoa: ok([{ time: AGORA + H, precipitation: 1 }]), bacia: ok([{ time: AGORA + H, precipitation: 1 }]) });
    expect(m2.avisoSemPonto).toEqual([]);
  });
});

describe('modeloClima — coleta da previsão (job do worker)', () => {
  const base = { lagoa: ok([]), bacia: ok([]), ana: ok({ chuva: [], vazao: [] }), agoraMs: AGORA };
  it('última coleta recente = ok, com hora', () => {
    const jobs = [{ job: JOB_PREVISAO, ok: true, ultimo_sucesso: '2026-11-22T14:05:00Z' }, { job: 'ana', ok: true, ultimo_sucesso: '2026-11-22T14:50:00Z' }];
    expect(modeloClima({ ...base, jobs }).coleta).toEqual({ estado: 'ok', ms: utc('2026-11-22T14:05:00Z'), quando: 'hoje às 11:05', falhou: false });
  });
  it('mais de 3 h = desatualizada; última execução com falha é sinalizada', () => {
    const jobs = [{ job: JOB_PREVISAO, ok: false, ultimo_sucesso: '2026-11-22T10:00:00Z' }];
    expect(modeloClima({ ...base, jobs }).coleta).toMatchObject({ estado: 'desatualizada', quando: 'hoje às 07:00', falhou: true });
  });
  it('sem o job, ou leitura dos jobs falhou = sem dado; carregando enquanto undefined', () => {
    expect(modeloClima({ ...base, jobs: [] }).coleta).toMatchObject({ estado: 'sem dado', ms: null, quando: null });
    expect(modeloClima({ ...base, jobs: null }).coleta).toMatchObject({ estado: 'sem dado' });
    expect(modeloClima({ ...base, jobs: undefined }).coleta.estado).toBe('carregando');
  });
});

describe('modeloClima — bacia e rio', () => {
  it('previsto 24/48/72 h na bacia × medido 24/72 h pela ANA, com hora e frescor da última leitura', () => {
    const bacia = horas('2026-11-22T16:00:00Z', 72, (time) => ({ time, precipitation: 1 }));
    const chuva = horas('2026-11-19T16:00:00Z', 71, (time) => ({ time, chuva: 0.5 })); // última 14:00 UTC; 24 h = 21T16..22T14 (23 h)
    const m = modeloClima({ lagoa: ok([]), bacia: ok(bacia), ana: ok({ chuva, vazao: [] }), jobs: [], agoraMs: AGORA });
    expect(m.bacia.previsto).toMatchObject({ estado: 'ok', h24: 24, h48: 48, h72: 72 });
    expect(m.bacia.medido).toMatchObject({ estado: 'ok', h24: 11.5, ultimaMs: utc('2026-11-22T14:00:00Z'), quando: 'hoje às 11:00', frescor: 'ok' });
    expect(m.bacia.medido.h72).toBeCloseTo(35.5);
  });
  it('ANA parada há mais de 24 h: medido 24 h sem dado e desatualizada', () => {
    const chuva = [{ time: AGORA - 30 * H, chuva: 2 }];
    const m = modeloClima({ lagoa: ok([]), bacia: ok([]), ana: ok({ chuva, vazao: [] }), jobs: [], agoraMs: AGORA });
    expect(m.bacia.medido).toMatchObject({ h24: null, h72: 2, frescor: 'desatualizada' });
    expect(m.bacia.previsto).toMatchObject({ estado: 'vazio', h24: null });
  });
  it('rio: classe com rótulo, hora e frescor; sem série = vazio', () => {
    const vazao = horas('2026-11-12T15:00:00Z', 10 * 24, (time, i) => ({ time, vazao: i === 10 * 24 - 1 ? 100 : 20 }));
    const m = modeloClima({ lagoa: ok([]), bacia: ok([]), ana: ok({ chuva: [], vazao }), jobs: [], agoraMs: AGORA });
    expect(m.rio).toMatchObject({ estado: 'ok', atual: 100, mediana: 20, classe: 'acima', rotuloClasse: 'acima do normal', frescor: 'ok' });
    const vazio = modeloClima({ lagoa: ok([]), bacia: ok([]), ana: ok({ chuva: [], vazao: [] }), jobs: [], agoraMs: AGORA });
    expect(vazio.rio).toMatchObject({ estado: 'vazio', atual: null, rotuloClasse: null });
    expect(vazio.bacia.medido.estado).toBe('vazio');
  });
  it('rio com menos de 7 dias: sem mediana e sem classe', () => {
    const vazao = horas('2026-11-20T15:00:00Z', 24, (time) => ({ time, vazao: 30 }));
    const m = modeloClima({ lagoa: ok([]), bacia: ok([]), ana: ok({ chuva: [], vazao }), jobs: [], agoraMs: AGORA });
    expect(m.rio).toMatchObject({ estado: 'ok', atual: 30, mediana: null, classe: null, rotuloClasse: null, frescor: 'desatualizada' });
  });
  it('ANA falhou: os dois blocos medidos dizem erro', () => {
    const m = modeloClima({ lagoa: ok([]), bacia: ok([]), ana: { dados: null, erro: 'Tempo esgotado', carregando: false }, jobs: [], agoraMs: AGORA });
    expect(m.bacia.medido).toMatchObject({ estado: 'erro', erro: 'Tempo esgotado' });
    expect(m.rio).toMatchObject({ estado: 'erro', erro: 'Tempo esgotado' });
  });
});
