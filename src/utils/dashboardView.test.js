import { describe, it, expect } from 'vitest';
import {
  formatIdade, ultimaLeituraMs, conexaoDaBoia, rotuloConexao, rotuloGravada,
  formatValor, minMax, serieGrafico, resumoColeta, resumoBoia, formatTick,
} from './dashboardView';

describe('formatIdade', () => {
  it('segundos, minutos, horas e dias', () => {
    expect(formatIdade(4000)).toBe('há 4 s');
    expect(formatIdade(59_400)).toBe('há 59 s');
    expect(formatIdade(3 * 60e3 + 10e3)).toBe('há 3 min');
    expect(formatIdade(2 * 3600e3 + 5)).toBe('há 2 h');
    expect(formatIdade(47 * 3600e3)).toBe('há 47 h');
    expect(formatIdade(3 * 86400e3 + 3600e3)).toBe('há 3 d');
  });
  it('relógio adiantado = agora; sem valor = null', () => {
    expect(formatIdade(-500)).toBe('agora');
    expect(formatIdade(null)).toBeNull();
    expect(formatIdade(NaN)).toBeNull();
  });
});

describe('ultimaLeituraMs', () => {
  it('MQTT da sessão vence a gravada', () => {
    expect(ultimaLeituraMs({ sensores: { ph: 7, _recebidoEm: 500 }, ultimas: [{ time: new Date(900) }] })).toBe(500);
  });
  it('sem MQTT usa a gravada mais recente (Date ou ms)', () => {
    expect(ultimaLeituraMs({ sensores: null, ultimas: [{ time: new Date(900) }, { time: new Date(100) }] })).toBe(900);
    expect(ultimaLeituraMs({ ultimas: [{ time: 42 }] })).toBe(42);
  });
  it('nada = null', () => {
    expect(ultimaLeituraMs({ sensores: null, ultimas: [] })).toBeNull();
    expect(ultimaLeituraMs({})).toBeNull();
  });
});

describe('conexaoDaBoia', () => {
  const agoraMs = 1_000_000;
  it('sem deviceId = sem-hardware, mesmo com LWT', () => {
    expect(conexaoDaBoia({ deviceId: null, lwt: 'online', ultimaMs: agoraMs, agoraMs })).toBe('sem-hardware');
    expect(conexaoDaBoia({ deviceId: '', agoraMs })).toBe('sem-hardware');
  });
  it('com deviceId segue estadoConexao', () => {
    expect(conexaoDaBoia({ deviceId: 'snt-0001', lwt: 'online', ultimaMs: agoraMs - 5000, agoraMs })).toBe('online');
    expect(conexaoDaBoia({ deviceId: 'snt-0001', lwt: 'online', ultimaMs: agoraMs - 61000, agoraMs })).toBe('sem-leitura');
    expect(conexaoDaBoia({ deviceId: 'snt-0001', lwt: 'offline', ultimaMs: agoraMs, agoraMs })).toBe('offline');
    expect(conexaoDaBoia({ deviceId: 'snt-0001', ultimaMs: null, agoraMs })).toBe('desconhecido');
  });
});

describe('rotuloConexao', () => {
  it('rótulo e tom por estado', () => {
    expect(rotuloConexao('online', 'há 4 s')).toEqual({ texto: 'online', tom: 'ok' });
    expect(rotuloConexao('offline', 'há 2 h')).toEqual({ texto: 'offline', tom: 'bad' });
    expect(rotuloConexao('sem-leitura', 'há 5 min')).toEqual({ texto: 'online, sem leitura há 5 min', tom: 'warn' });
    expect(rotuloConexao('desconhecido', null)).toEqual({ texto: 'sem sinal', tom: 'neutral' });
    expect(rotuloConexao('sem-hardware', null)).toEqual({ texto: 'sem hardware', tom: 'neutral' });
  });
  it('online sem nenhuma leitura não inventa idade', () => {
    expect(rotuloConexao('sem-leitura', null)).toEqual({ texto: 'online, sem leitura', tom: 'warn' });
  });
});

describe('rotuloGravada', () => {
  const agora = new Date(2026, 10, 22, 15, 0).getTime();
  it('mesmo dia: só a hora', () => {
    expect(rotuloGravada(new Date(2026, 10, 22, 9, 5).getTime(), agora)).toBe('gravada às 09:05');
  });
  it('outro dia: data e hora', () => {
    expect(rotuloGravada(new Date(2026, 9, 3, 14, 32).getTime(), agora)).toBe('gravada em 03/10 às 14:32');
  });
  it('sem hora = null', () => {
    expect(rotuloGravada(null, agora)).toBeNull();
  });
});

describe('formatValor', () => {
  it('casas do parâmetro, vírgula decimal e unidade', () => {
    expect(formatValor(7.126, 'ph')).toBe('7,13');
    expect(formatValor(24.04, 'temperatura')).toBe('24,0 °C');
    expect(formatValor(12, 'turbidez')).toBe('12,0 NTU');
  });
  it('zero é valor; null é "sem leitura"', () => {
    expect(formatValor(0, 'turbidez')).toBe('0,0 NTU');
    expect(formatValor(null, 'ph')).toBe('sem leitura');
    expect(formatValor(undefined, 'ph')).toBe('sem leitura');
  });
});

describe('minMax', () => {
  it('ignora ausentes e mantém zero', () => {
    expect(minMax([3, null, 0, undefined, 7, NaN])).toEqual({ min: 0, max: 7 });
  });
  it('sem valor = null', () => {
    expect(minMax([])).toBeNull();
    expect(minMax([null, undefined])).toBeNull();
    expect(minMax(undefined)).toBeNull();
  });
});

describe('serieGrafico', () => {
  const history = [{ time: new Date(1000), value: 7 }, { time: new Date(2000), value: 7.2 }];
  it('histórico + leituras ao vivo posteriores ao último ponto, só com o campo', () => {
    const buffer = [
      { ts: 1500, ph: 9 },          // anterior ao último ponto gravado: fora
      { ts: 2500, ph: 7.4 },
      { ts: 3000, temperatura: 25 }, // sem pH: fora
      { ts: 3500, ph: 0 },          // zero é leitura
    ];
    expect(serieGrafico(history, buffer, 'ph')).toEqual([
      { t: 1000, value: 7 }, { t: 2000, value: 7.2 }, { t: 2500, value: 7.4 }, { t: 3500, value: 0 },
    ]);
  });
  it('sem histórico usa só o buffer', () => {
    expect(serieGrafico([], [{ ts: 5, ph: 6 }], 'ph')).toEqual([{ t: 5, value: 6 }]);
    expect(serieGrafico(undefined, undefined, 'ph')).toEqual([]);
  });
});

describe('resumoColeta', () => {
  const agora = new Date('2026-11-22T12:00:00Z');
  it('ok, atrasado e falha; ignora o job status; guarda o último sucesso', () => {
    const jobs = [
      { job: 'detector', ok: true, ultimo_sucesso: '2026-11-22T11:58:00Z' },
      { job: 'ana', ok: true, ultimo_sucesso: '2026-11-22T09:00:00Z' },
      { job: 'openmeteo', ok: false, erro: 'timeout', ultimo_sucesso: '2026-11-22T11:30:00Z' },
      { job: 'status', ok: true, ultimo_sucesso: '2026-11-22T11:59:00Z' },
    ];
    expect(resumoColeta(jobs, agora)).toEqual([
      { job: 'detector', rotulo: 'Detector', estado: 'ok', title: undefined, ultimoSucessoMs: Date.parse('2026-11-22T11:58:00Z') },
      { job: 'ana', rotulo: 'ANA', estado: 'atrasado', title: 'Sem execução bem-sucedida recente', ultimoSucessoMs: Date.parse('2026-11-22T09:00:00Z') },
      { job: 'openmeteo', rotulo: 'Open-Meteo', estado: 'falha', title: 'timeout', ultimoSucessoMs: Date.parse('2026-11-22T11:30:00Z') },
    ]);
  });
  it('job desconhecido usa o nome; sem sucesso = null', () => {
    expect(resumoColeta([{ job: 'novo', ok: null, ultimo_sucesso: null }], agora)[0])
      .toMatchObject({ rotulo: 'novo', estado: 'atrasado', ultimoSucessoMs: null });
    expect(resumoColeta(undefined, agora)).toEqual([]);
  });
});

describe('resumoBoia', () => {
  const agoraMs = Date.parse('2026-11-22T12:00:00Z');
  const buoy = { codigo: 'SM-01', deviceId: 'snt-0001', modo: 'campo' };
  const healthRows = [
    { device_id: 'snt-0001', sensor: 'ph', estado: 'ok' },
    { device_id: 'snt-0001', sensor: 'turbidez', estado: 'suspeito' },
    { device_id: 'outra', sensor: 'ph', estado: 'falha' },
  ];

  it('ao vivo: valores do MQTT, conexão e pior saúde só do serial atual', () => {
    const r = resumoBoia({
      buoy,
      mqtt: { lwt: 'online', sensores: { ph: 7.1, temperatura: 25, turbidez: 3, _recebidoEm: agoraMs - 4000 } },
      ultimas: [],
      healthRows,
      agoraMs,
    });
    expect(r.conexao).toBe('online');
    expect(r.ultimaMs).toBe(agoraMs - 4000);
    expect(r.valores.ph).toEqual({ valor: 7.1, fonte: 'ao-vivo', em: agoraMs - 4000 });
    expect(r.saude).toBe('suspeito');
  });

  it('sem MQTT nem Influx: tudo "sem leitura" (null), nunca 0', () => {
    const r = resumoBoia({ buoy, mqtt: {}, ultimas: [], healthRows: [], agoraMs });
    expect(r.conexao).toBe('desconhecido');
    expect(r.ultimaMs).toBeNull();
    for (const c of ['temperatura', 'ph', 'turbidez']) expect(r.valores[c].valor).toBeNull();
    expect(r.saude).toBeNull();
  });

  it('gravada: cai para ultimas e a idade vem do _time', () => {
    const r = resumoBoia({
      buoy, mqtt: { lwt: 'online' }, ultimas: [{ time: new Date(agoraMs - 3600e3), ph: 6.8 }], healthRows, agoraMs,
    });
    expect(r.conexao).toBe('sem-leitura');
    expect(r.ultimaMs).toBe(agoraMs - 3600e3);
    expect(r.valores.ph.fonte).toBe('gravada');
    expect(r.valores.temperatura.valor).toBeNull();
  });

  it('bancada neutraliza a saúde (precedência do cadastro)', () => {
    const r = resumoBoia({ buoy: { ...buoy, modo: 'bancada' }, mqtt: {}, ultimas: [], healthRows, agoraMs });
    expect(r.saude).toBe('bancada');
    expect(r.modo).toBe('bancada');
  });

  it('sem deviceId: sem hardware e sem saúde de outra bóia', () => {
    const r = resumoBoia({
      buoy: { codigo: 'MG-01', deviceId: null }, mqtt: {}, ultimas: [],
      healthRows: [{ device_id: null, sensor: 'ph', estado: 'falha' }], agoraMs,
    });
    expect(r.conexao).toBe('sem-hardware');
    expect(r.saude).toBeNull();
    expect(r.modo).toBe('bancada');
  });
});

describe('formatTick', () => {
  const t = new Date(2026, 10, 22, 9, 5).getTime();
  it('janelas curtas só com a hora; longas com a data', () => {
    expect(formatTick(t, '1h')).toBe('09:05');
    expect(formatTick(t, '24h')).toBe('09:05');
    expect(formatTick(t, '7d')).toBe('22/11 09:05');
    expect(formatTick(t, '30d')).toBe('22/11 09:05');
  });
});
