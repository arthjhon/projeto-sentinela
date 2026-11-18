from datetime import datetime, timedelta, timezone

import pytest

from sentinela_worker.detector.rules import Flag
from sentinela_worker.detector.state import SensorState, derive_state

NOW = datetime(2026, 11, 17, 12, tzinfo=timezone.utc)
EARLIER = NOW - timedelta(hours=3)

FALHA = Flag("travado", "falha", NOW - timedelta(hours=2), 7.0, "valor constante por 120 min")
SEM = Flag("sem_dados", "falha", NOW - timedelta(minutes=20), None, "sem amostras ha 20 min")
SUSP = Flag("plausibilidade", "suspeito", NOW, 4.2, "valor fora da faixa plausivel [5, 10]")


def st(flags=(), modo="campo", man=False, cad=True, suf=True, prev=None):
    return derive_state(list(flags), modo, man, cad, suf, NOW, prev)


@pytest.mark.parametrize("kw,flags,estado", [
    (dict(man=True, modo="bancada", cad=True), [FALHA, SEM, SUSP], "manutencao"),
    (dict(modo="bancada"), [FALHA, SEM, SUSP], "bancada"),
    (dict(modo="bancada", suf=False), [], "bancada"),
    (dict(modo="nao_cadastrado", cad=False), [FALHA, SEM, SUSP], "nao_cadastrado"),
    (dict(), [SUSP, SEM, FALHA], "falha"),
    (dict(), [SUSP, SEM], "sem_dados"),
    (dict(suf=False), [SUSP], "suspeito"),
    (dict(suf=False), [], "dados_insuficientes"),
    (dict(), [], "ok"),
])
def test_precedence(kw, flags, estado):
    assert st(flags, **kw).estado == estado


def test_bancada_is_never_red_whatever_the_flags():
    for flags in ([FALHA], [SEM], [SUSP], [FALHA, SEM, SUSP]):
        assert st(flags, modo="bancada").estado == "bancada"


def test_desde_is_kept_while_estado_is_unchanged_and_reset_on_change():
    prev = SensorState("falha", "travado: x", EARLIER)
    same = st([FALHA], prev=prev)
    assert same.estado == "falha" and same.desde == EARLIER
    changed = st([], prev=prev)
    assert changed.estado == "ok" and changed.desde == NOW
    assert st([FALHA]).desde == NOW                     # no previous state


def test_motivo_names_the_rule_and_detail():
    s = st([FALHA, SUSP])
    assert s.motivo.startswith("travado: valor constante por 120 min")
    assert s.motivo.endswith(" (+ plausibilidade)")     # listed, but not the reason
    two = st([FALHA, Flag("faixa", "falha", NOW, 15.0, "fora")])
    assert "travado" in two.motivo and "faixa" in two.motivo
    assert st([]).motivo == "" and st(man=True).motivo


def test_motivo_regras_round_trips_derive_state_motivo():
    from sentinela_worker.detector.state import motivo_regras
    deriva = Flag("deriva", "suspeito", NOW, 0.2, "deriva lenta: nivel atual +0.200 (media 24 h; x)")
    pico = Flag("pico", "suspeito", NOW, None, "5 picos isolados em 60 min (limite 5)")
    assert motivo_regras(st([deriva, pico]).motivo) == {"deriva", "pico"}
    assert motivo_regras(st([pico, deriva]).motivo) == {"pico", "deriva"}
    assert motivo_regras(st([pico]).motivo) == {"pico"}
    assert motivo_regras("") == set() and motivo_regras(st(man=True).motivo) == set()


def test_motivo_lists_every_active_rule_after_the_winning_severity():
    from sentinela_worker.detector.state import motivo_regras
    deriva = Flag("deriva", "suspeito", NOW, 0.2, "deriva lenta: nivel atual +0.200 (media 24 h; x)")
    faixa = Flag("faixa", "falha", NOW, 15.0, "valor fora da faixa [0, 14]")
    s = st([deriva, SEM, faixa])
    assert s.estado == "falha" and s.motivo.startswith("faixa: valor fora da faixa [0, 14]")
    assert s.motivo.endswith(" (+ deriva, sem_dados)")
    assert motivo_regras(s.motivo) == {"faixa", "deriva", "sem_dados"}   # deriva not forgotten
    assert motivo_regras(st([SEM, deriva]).motivo) == {"sem_dados", "deriva"}
