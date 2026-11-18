from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from sentinela_worker import status_job
from sentinela_worker.pg import Buoy
from sentinela_worker.status_job import (
    StatusRow, check_influx, check_ingestao, check_worker, human_age, run_status)

NOW = datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)
START = NOW - timedelta(hours=2)


class FakeSink:
    def __init__(self, last=None, ping_ok=True, ping_exc=None, query_exc=None):
        self.last = last or {}          # device_id -> datetime
        self.ping_ok, self.ping_exc, self.query_exc = ping_ok, ping_exc, query_exc

    def ping(self):
        if self.ping_exc:
            raise self.ping_exc
        return self.ping_ok

    def query_df(self, flux):
        if self.query_exc:
            raise self.query_exc
        assert "max(column:\"_time\")" in flux and "sensores" in flux
        return pd.DataFrame({"device_id": list(self.last),
                             "_time": [pd.Timestamp(t) for t in self.last.values()]})


def campo(code="SM-01", dev="dev1"):
    return Buoy(code, dev, "campo", None)


def ago(**kw):
    return NOW - timedelta(**kw)


def test_ingestao_all_campo_fresh_is_ok():
    row = check_ingestao(FakeSink({"dev1": ago(seconds=30)}), [campo()], NOW)
    assert (row.componente, row.estado) == ("telegraf_ingestao", "ok")
    assert row.dados == {"dev1": ago(seconds=30).isoformat()}


def test_ingestao_campo_stale_degradado_then_falha():
    assert check_ingestao(FakeSink({"dev1": ago(minutes=5)}), [campo()], NOW).estado == "degradado"
    assert check_ingestao(FakeSink({"dev1": ago(minutes=2)}), [campo()], NOW).estado == "ok"
    assert check_ingestao(FakeSink({"dev1": ago(minutes=15)}), [campo()], NOW).estado == "degradado"
    r = check_ingestao(FakeSink({"dev1": ago(minutes=20)}), [campo()], NOW)
    assert r.estado == "falha" and "SM-01" in r.detalhe and "há 20 min" in r.detalhe
    r = check_ingestao(FakeSink({}), [campo()], NOW)
    assert r.estado == "falha"
    # the worst buoy wins
    two = [campo(), campo("SM-02", "dev2")]
    r = check_ingestao(FakeSink({"dev1": ago(seconds=10), "dev2": ago(minutes=20)}), two, NOW)
    assert r.estado == "falha"


def test_no_campo_buoy_is_ok_with_detail():
    bancada = Buoy("SM-09", "devb", "bancada", None)
    row = check_ingestao(FakeSink({"devb": ago(minutes=3)}), [bancada], NOW)
    assert row.estado == "ok"
    assert row.detalhe.startswith("Nenhuma bóia em campo") and "há 3 min" in row.detalhe
    row = check_ingestao(FakeSink({}), [], NOW)
    assert row.estado == "ok" and "nenhum ponto em 24 h" in row.detalhe
    # a campo buoy without deviceId is not evaluated
    assert check_ingestao(FakeSink({}), [Buoy("SM-02", None, "campo", None)], NOW).estado == "ok"


def test_ingestao_dados_lists_every_device():
    sink = FakeSink({"dev1": ago(seconds=30), "devb": ago(minutes=3), "ghost": ago(hours=2)})
    row = check_ingestao(sink, [campo(), Buoy("SM-09", "devb", "bancada", None)], NOW)
    assert set(row.dados) == {"dev1", "devb", "ghost"}


def test_ingestao_query_error_is_falha_redacted():
    sink = FakeSink(query_exc=RuntimeError("boom http://u:s3cr3t@h/?token=abc123"))
    row = check_ingestao(sink, [campo()], NOW)
    assert row.estado == "falha" and "s3cr3t" not in row.detalhe and "abc123" not in row.detalhe


def test_influx_ok_and_slow_is_degradado():
    ticks = iter([100.0, 100.1])
    assert check_influx(FakeSink(), NOW, clock=lambda: next(ticks)).estado == "ok"
    ticks = iter([100.0, 102.5])
    row = check_influx(FakeSink(), NOW, clock=lambda: next(ticks))
    assert row.estado == "degradado" and "2.5" in row.detalhe


def test_influx_ping_false_is_falha():
    assert check_influx(FakeSink(ping_ok=False), NOW).estado == "falha"


def test_worker_row():
    row = check_worker("v1.2", START, NOW)
    assert (row.componente, row.estado) == ("worker", "ok")
    assert "v1.2" in row.detalhe and row.dados["versao"] == "v1.2"


@pytest.mark.parametrize("secs,text", [(30, "há 30 s"), (180, "há 3 min"), (7200, "há 2 h"),
                                       (59, "há 59 s"), (3599, "há 59 min")])
def test_human_age(secs, text):
    assert human_age(timedelta(seconds=secs)) == text


def test_influx_down_marks_falha_and_other_rows_still_written(monkeypatch):
    calls = []

    class FakeStore:
        def __init__(self, conn):
            pass

        def upsert(self, rows):
            calls.append(list(rows))

    monkeypatch.setattr(status_job, "PgSystemStatus", FakeStore)
    monkeypatch.setattr(status_job, "load_registry", lambda conn: [campo()])
    sink = FakeSink(ping_exc=ConnectionError("influx down"),
                    query_exc=ConnectionError("influx down"))
    rows = run_status(NOW, sink, lambda: object(), "v1", START)
    assert len(calls) == 1 and len(calls[0]) == 3
    by = {r.componente: r for r in calls[0]}
    assert by["influxdb"].estado == "falha"
    assert by["telegraf_ingestao"].estado == "falha" and by["telegraf_ingestao"].detalhe
    assert by["worker"].estado == "ok"
    assert rows == calls[0]


def test_postgres_write_failure_fails_the_job(monkeypatch):
    class BadStore:
        def __init__(self, conn):
            pass

        def upsert(self, rows):
            raise RuntimeError("pg down")

    monkeypatch.setattr(status_job, "PgSystemStatus", BadStore)
    monkeypatch.setattr(status_job, "load_registry", lambda conn: [])
    with pytest.raises(RuntimeError):
        run_status(NOW, FakeSink(), lambda: object(), "v1", START)


def test_registry_failure_does_not_stop_other_rows(monkeypatch):
    calls = []

    class FakeStore:
        def __init__(self, conn):
            pass

        def upsert(self, rows):
            calls.append(list(rows))

    def boom(conn):
        raise RuntimeError("registry unreadable")

    monkeypatch.setattr(status_job, "PgSystemStatus", FakeStore)
    monkeypatch.setattr(status_job, "load_registry", boom)
    run_status(NOW, FakeSink(), lambda: object(), "v1", START)
    by = {r.componente: r for r in calls[0]}
    assert by["telegraf_ingestao"].estado == "falha" and by["influxdb"].estado == "ok"


def test_check_worker_shows_short_version_keeps_full_in_dados():
    from datetime import datetime, timezone
    from sentinela_worker.status_job import check_worker
    now = datetime(2026, 11, 18, 12, tzinfo=timezone.utc)
    full = "0123456789abcdef0123456789abcdef01234567"
    row = check_worker(full, now, now)
    assert "versão 0123456;" in row.detalhe
    assert full not in row.detalhe
    assert row.dados["versao"] == full
