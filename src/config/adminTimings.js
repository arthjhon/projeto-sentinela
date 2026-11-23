// Tempos do painel admin num lugar só (antes eram números soltos em cada tela).
// Limiares de conexão da bóia ficam em utils/buoyConnection.js (SEM_LEITURA_MS).

/** Relógio das telas ("há X s" recalculado). */
export const CLOCK_TICK_MS = 5_000;
/** Polling de saúde dos sensores na página Status. */
export const STATUS_HEALTH_POLL_MS = 30_000;
/** Broker MQTT fora há até isto: ainda "conectando". */
export const BROKER_CONNECTING_MS = 10_000;
/** Broker MQTT fora há mais que isto: falha (entre os dois: reconectando). */
export const BROKER_FAIL_MS = 30_000;
/** Contexto ambiental: a janela "agora" avança e as séries são relidas a cada tanto. */
export const CONTEXTO_REFRESH_MS = 5 * 60_000;
/** Contexto ambiental: pausa antes de aplicar a data digitada. */
export const CONTEXTO_ESPERA_DATA_MS = 600;
/** Contexto ambiental: marcas do eixo X (iguais em todos os gráficos). */
export const CONTEXTO_TICKS = 7;
