const dia = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Maceio', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Dia do calendário em Maceió (YYYY-MM-DD) do instante `agora`, independente do fuso do navegador. */
export function hojeMaceio(agora = new Date()) {
  return dia.format(agora);
}
