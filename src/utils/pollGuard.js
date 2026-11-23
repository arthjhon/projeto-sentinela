/** Uma rodada por vez; só o resultado da rodada mais recente vale. */
export function createPollGuard() {
  let seq = 0;
  let inFlight = false;
  return {
    start() { if (inFlight) return null; inFlight = true; return ++seq; },
    isLatest(token) { return token === seq; },
    finish() { inFlight = false; },
  };
}
