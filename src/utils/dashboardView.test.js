import { describe, it, expect } from 'vitest';
import {
  formatIdade, ultimaLeituraMs, conexaoDaBoia, rotuloConexao, rotuloGravada,
  formatValor, minMax, serieGrafico, resumoColeta, resumoBoia, formatTick,
  mensagemDaSessao, extremos24h, avisoBroker, rotuloOrigem, estadoColeta, seloManutencao, textoSemSaude,
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

describe('mensagemDaSessao', () => {
  it('mensagem recebida nesta sessão ganha _recebidoEm', () => {
    expect(mensagemDaSessao({ ph: 7 }, { at: 500, retained: false })).toEqual({ ph: 7, _recebidoEm: 500 });
  });
  it('retida não conta (é velha)', () => {
    expect(mensagemDaSessao({ ph: 7 }, { at: 500, retained: true })).toBeNull();
  });
  it('sem hora de chegada = null', () => {
    expect(mensagemDaSessao({ ph: 7 }, undefined)).toBeNull();
  });
  it('payload que não é objeto (ou ausente) = null', () => {
    expect(mensagemDaSessao('online', { at: 500, retained: false })).toBeNull();
    expect(mensagemDaSessao(undefined, { at: 500, retained: false })).toBeNull();
  });
});

describe('extremos24h', () => {
  const agoraMs = 1_000_000_000;
  const hist24 = { ph: [{ time: new Date(1), value: 7 }, { time: new Date(2), value: 8 }], temperatura: [], turbidez: [] };
  it('carregando = undefined; falha = "erro"', () => {
    expect(extremos24h(null, [], 'ph', agoraMs)).toBeUndefined();
    expect(extremos24h({ erro: 'x' }, [], 'ph', agoraMs)).toBe('erro');
  });
  it('junta médias gravadas e leituras brutas das últimas 24 h; a borda exata conta', () => {
    const ultimas = [
      { time: new Date(agoraMs - 1000), ph: 6.5 },
      { time: new Date(agoraMs - 86400e3), ph: 9 },      // exatamente 24 h: entra
      { time: new Date(agoraMs - 86400e3 - 1), ph: 2 },  // 1 ms além: fora
    ];
    expect(extremos24h(hist24, ultimas, 'ph', agoraMs)).toEqual({ min: 6.5, max: 9 });
  });
  it('sem valor em nenhuma das fontes = null', () => {
    expect(extremos24h(hist24, [{ time: new Date(agoraMs), ph: 7 }], 'temperatura', agoraMs)).toBeNull();
  });
});

describe('conexão com o broker do painel (sem broker não se afirma estado da bóia)', () => {
  const agoraMs = 1_000_000;
  const base = { deviceId: 'snt-0001', ultimaMs: agoraMs - 120_000, agoraMs };
  it('broker conectado: segue o LWT', () => {
    expect(conexaoDaBoia({ ...base, lwt: 'online', brokerConectado: true })).toBe('sem-leitura');
    expect(conexaoDaBoia({ ...base, lwt: 'offline', brokerConectado: true })).toBe('offline');
    expect(conexaoDaBoia({ ...base, lwt: undefined, brokerConectado: true })).toBe('desconhecido');
  });
  it('broker desconectado: sem-broker para qualquer LWT', () => {
    for (const lwt of ['online', 'offline', undefined]) {
      expect(conexaoDaBoia({ ...base, lwt, brokerConectado: false })).toBe('sem-broker');
    }
  });
  it('sem o parâmetro vale conectado (compatível)', () => {
    expect(conexaoDaBoia({ ...base, lwt: 'offline' })).toBe('offline');
  });
  it('sem serial continua sem-hardware, com ou sem broker', () => {
    expect(conexaoDaBoia({ deviceId: null, agoraMs, brokerConectado: false })).toBe('sem-hardware');
  });
  it('rótulo neutro que não culpa a bóia', () => {
    expect(rotuloConexao('sem-broker', 'há 3 min')).toEqual({ texto: 'painel sem conexão com o broker', tom: 'neutral' });
  });
  it('resumoBoia repassa o estado do broker', () => {
    const r = resumoBoia({
      buoy: { codigo: 'SM-01', deviceId: 'snt-0001', modo: 'campo' },
      mqtt: { lwt: 'online' }, ultimas: [], healthRows: [], agoraMs, brokerConectado: false,
    });
    expect(r.conexao).toBe('sem-broker');
  });
});

describe('avisoBroker', () => {
  it('conectado = sem aviso', () => {
    expect(avisoBroker({ conectado: true, jaConectou: true })).toBeNull();
  });
  it('antes da primeira conexão = conectando; depois de cair = desconectado', () => {
    expect(avisoBroker({ conectado: false, jaConectou: false })).toBe('conectando');
    expect(avisoBroker({ conectado: false, jaConectou: true })).toBe('desconectado');
  });
});

describe('extremos24h com o buffer da sessão (MQTT)', () => {
  const agoraMs = 1_000_000_000;
  const hist24 = { ph: [{ time: new Date(1), value: 7 }], temperatura: [], turbidez: [] };
  it('inclui as leituras ao vivo das últimas 24 h', () => {
    const buffer = [{ ts: agoraMs - 5000, ph: 9.2 }, { ts: agoraMs - 1000, ph: 5.1 }];
    expect(extremos24h(hist24, [], 'ph', agoraMs, buffer)).toEqual({ min: 5.1, max: 9.2 });
  });
  it('ignora entrada com mais de 24 h (borda inclusa), sem o campo ou nula', () => {
    const buffer = [
      { ts: agoraMs - 86400e3, ph: 8 },
      { ts: agoraMs - 86400e3 - 1, ph: 99 },
      { ts: agoraMs - 10, ph: null },
      { ts: agoraMs - 10, temperatura: 30 },
    ];
    expect(extremos24h(hist24, [], 'ph', agoraMs, buffer)).toEqual({ min: 7, max: 8 });
  });
  it('só o buffer tem valor: usa o buffer; sem buffer segue como antes', () => {
    expect(extremos24h(hist24, [], 'temperatura', agoraMs, [{ ts: agoraMs - 1, temperatura: 28 }])).toEqual({ min: 28, max: 28 });
    expect(extremos24h(hist24, [], 'temperatura', agoraMs)).toBeNull();
  });
  it('carregando e erro valem mesmo com buffer', () => {
    const buffer = [{ ts: agoraMs - 1, ph: 7 }];
    expect(extremos24h(null, [], 'ph', agoraMs, buffer)).toBeUndefined();
    expect(extremos24h({ erro: 'x' }, [], 'ph', agoraMs, buffer)).toBe('erro');
  });
});

describe('rotuloOrigem (idade da mensagem da sessão)', () => {
  const agoraMs = 10_000_000;
  it('até 60 s: ao vivo', () => {
    expect(rotuloOrigem({ fonte: 'ao-vivo', em: agoraMs - 4000 }, agoraMs)).toBe('ao vivo, há 4 s');
    expect(rotuloOrigem({ fonte: 'ao-vivo', em: agoraMs - 60000 }, agoraMs)).toBe('ao vivo, há 1 min');
  });
  it('acima de 60 s: recebida há X, nunca "ao vivo"', () => {
    expect(rotuloOrigem({ fonte: 'ao-vivo', em: agoraMs - 60001 }, agoraMs)).toBe('recebida há 1 min');
    expect(rotuloOrigem({ fonte: 'ao-vivo', em: agoraMs - 2 * 3600e3 }, agoraMs)).toBe('recebida há 2 h');
  });
  it('sem hora de chegada: ao vivo sem inventar idade', () => {
    expect(rotuloOrigem({ fonte: 'ao-vivo', em: null }, agoraMs)).toBe('ao vivo');
  });
  it('gravada e sem dado', () => {
    expect(rotuloOrigem({ fonte: 'gravada', em: agoraMs - 3600e3 }, agoraMs)).toMatch(/^gravada (às|em)/);
    expect(rotuloOrigem({ fonte: null, em: null }, agoraMs)).toBe('nem no MQTT nem no histórico gravado');
  });
});

describe('estadoColeta (undefined = carregando, null = falhou)', () => {
  const agora = new Date('2026-11-22T12:00:00Z');
  it('carregando', () => expect(estadoColeta(undefined, agora)).toEqual({ tipo: 'carregando' }));
  it('falhou', () => expect(estadoColeta(null, agora)).toEqual({ tipo: 'falha' }));
  it('sem jobs (ou só o status)', () => {
    expect(estadoColeta([], agora)).toEqual({ tipo: 'vazio' });
    expect(estadoColeta([{ job: 'status', ok: true, ultimo_sucesso: agora.toISOString() }], agora)).toEqual({ tipo: 'vazio' });
  });
  it('com jobs: itens de resumoColeta', () => {
    const jobs = [{ job: 'ana', ok: true, ultimo_sucesso: agora.toISOString() }];
    const r = estadoColeta(jobs, agora);
    expect(r.tipo).toBe('itens');
    expect(r.itens).toEqual(resumoColeta(jobs, agora));
  });
});

describe('seloManutencao', () => {
  it('registro aberto: em manutenção, com o motivo', () => {
    expect(seloManutencao({ motivo: 'troca de sonda' })).toEqual({ tipo: 'aberta', texto: 'em manutenção', title: 'troca de sonda' });
    expect(seloManutencao({ motivo: null }).title).toBeUndefined();
  });
  it('leitura falhou: indisponível, nunca some', () => {
    expect(seloManutencao('erro')).toEqual({ tipo: 'indisponivel', texto: 'manutenção: indisponível' });
  });
  it('sem manutenção ou ainda não lida: nenhum selo', () => {
    expect(seloManutencao(null)).toBeNull();
    expect(seloManutencao(undefined)).toBeNull();
  });
});

describe('textoSemSaude (card e painel dizem o mesmo)', () => {
  it('leitura falhou: saúde indisponível; senão sem avaliação', () => {
    expect(textoSemSaude(true)).toBe('saúde indisponível');
    expect(textoSemSaude(false)).toBe('sem avaliação');
  });
});

describe('serial fora do formato (DEVICE_RE) = sem serial válido', () => {
  const agoraMs = Date.parse('2026-11-22T12:00:00Z');
  it('resumoBoia: sem hardware e sem saúde de outra bóia', () => {
    const r = resumoBoia({
      buoy: { codigo: 'SM-01', deviceId: 'ab c', modo: 'campo' }, mqtt: {}, ultimas: [],
      healthRows: [{ device_id: 'ab c', sensor: 'ph', estado: 'falha' }], agoraMs,
    });
    expect(r.conexao).toBe('sem-hardware');
    expect(r.saude).toBeNull();
  });
});

describe('conexão de bóia de bancada (mesma regra de buoyConnection)', () => {
  const agoraMs = 1_000_000;
  const buoy = { codigo: 'SM-09', deviceId: 'snt-0009', modo: 'bancada' };
  it('desligada: bancada-offline, nunca offline vermelho', () => {
    expect(resumoBoia({ buoy, mqtt: { lwt: 'offline' }, ultimas: [], healthRows: [], agoraMs }).conexao).toBe('bancada-offline');
  });
  it('ligada e transmitindo: online', () => {
    const mqtt = { lwt: 'online', sensores: { ph: 7, _recebidoEm: agoraMs - 3000 } };
    expect(resumoBoia({ buoy, mqtt, ultimas: [], healthRows: [], agoraMs }).conexao).toBe('online');
  });
  it('rotuloConexao: neutro com texto próprio', () => {
    expect(rotuloConexao('bancada-offline', 'há 3 min')).toEqual({ texto: 'bancada, offline é normal', tom: 'neutral' });
  });
  it('conexaoDaBoia repassa modo', () => {
    expect(conexaoDaBoia({ deviceId: 'snt-0009', modo: 'bancada', lwt: 'offline', agoraMs })).toBe('bancada-offline');
  });
});
