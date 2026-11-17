from datetime import date, datetime, timezone
from pathlib import Path

import httpx
import pytest
import respx

from sentinela_worker import __main__ as cli
from sentinela_worker.collectors import ana

FIX = Path(__file__).parent / "fixtures"
URL = "https://telemetriaws1.ana.gov.br/ServiceANA.asmx/DadosHidrometeorologicos"


def utc(*a):
    return datetime(*a, tzinfo=timezone.utc)


def rec(p):
    return p._tags, p._fields, p._time


class FakeSink:
    def __init__(self):
        self.writes = []

    def write(self, bucket, points):
        self.writes.append((bucket, list(points)))


def xml(rows):
    body = "".join(
        f"<DadosHidrometereologicos><CodEstacao>{c}</CodEstacao><DataHora>{t} </DataHora>"
        f"<Vazao>{v}</Vazao><Nivel>{n}</Nivel><Chuva>{ch}</Chuva></DadosHidrometereologicos>"
        for c, t, v, n, ch in rows
    )
    return (
        '<?xml version="1.0" encoding="utf-8"?><DataTable xmlns="http://MRCS/"><diffgr:diffgram '
        'xmlns:diffgr="urn:schemas-microsoft-com:xml-diffgram-v1"><DocumentElement xmlns="">'
        f"{body}</DocumentElement></diffgr:diffgram></DataTable>"
    )


def source():
    return ana.AnaLegacySource(httpx.Client())


@respx.mock
def test_parses_vazao_nivel_chuva():
    respx.get(URL).respond(200, text=(FIX / "ana_39770000.xml").read_text())
    rows = source().fetch("39770000", utc(2026, 11, 16, 0), utc(2026, 11, 18, 0))
    assert len(rows) == 134
    r = max(rows, key=lambda x: x.time)
    assert (r.estacao, r.vazao, r.nivel, r.chuva) == ("39770000", 6.56, 438.0, 0.0)


@respx.mock
def test_ana_datahora_is_converted_from_local_to_utc():
    respx.get(URL).respond(200, text=xml([("1", "2026-11-17 02:15:00", "1.5", "2", "0")]))
    (r,) = source().fetch("1", utc(2026, 11, 17, 0), utc(2026, 11, 18, 0))
    assert r.time == utc(2026, 11, 17, 5, 15)


@respx.mock
def test_empty_fields_become_none():
    respx.get(URL).respond(200, text=xml([("1", "2026-11-17 02:15:00", "", "2.5", "")]))
    (r,) = source().fetch("1", utc(2026, 11, 17, 0), utc(2026, 11, 18, 0))
    assert (r.vazao, r.nivel, r.chuva) == (None, 2.5, None)


@respx.mock
def test_unparseable_values_become_none_and_do_not_crash():
    respx.get(URL).respond(200, text=xml([("1", "2026-11-17 02:15:00", "abc", "nan", "3.0")]))
    (r,) = source().fetch("1", utc(2026, 11, 17, 0), utc(2026, 11, 18, 0))
    assert (r.vazao, r.nivel, r.chuva) == (None, None, 3.0)


@respx.mock
def test_error_table_returns_empty_list_not_exception():
    respx.get(URL).respond(200, text=(FIX / "ana_error_table.xml").read_text())
    assert source().fetch("39800100", utc(2026, 11, 16), utc(2026, 11, 18)) == []


@respx.mock
def test_request_uses_local_dates_covering_the_utc_window_and_filters_rows():
    route = respx.get(URL).respond(
        200,
        text=xml(
            [
                ("1", "2026-11-16 20:45:00", "1", "1", "1"),  # 23:45Z on 16th: out
                ("1", "2026-11-16 21:00:00", "2", "1", "1"),  # 00:00Z on 17th: in
                ("1", "2026-11-17 20:45:00", "3", "1", "1"),  # 23:45Z on 17th: in
                ("1", "2026-11-17 21:00:00", "4", "1", "1"),  # 00:00Z on 18th: out
            ]
        ),
    )
    rows = source().fetch("1", utc(2026, 11, 17, 0), utc(2026, 11, 17, 23, 59))
    q = route.calls[0].request.url.params
    assert (q["codEstacao"], q["dataInicio"], q["dataFim"]) == ("1", "16/11/2026", "17/11/2026")
    assert sorted(r.vazao for r in rows) == [2.0, 3.0]
    assert route.calls[0].request.headers["user-agent"].startswith("sentinela-worker/")


@respx.mock
def test_oversized_body_is_rejected():
    respx.get(URL).respond(200, content=b"x" * (ana.MAX_BODY_BYTES + 1))
    with pytest.raises(ValueError, match="too large"):
        source().fetch("1", utc(2026, 11, 16), utc(2026, 11, 17))


@respx.mock
def test_doctype_is_rejected():
    respx.get(URL).respond(200, text='<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "y">]><a/>')
    with pytest.raises(ValueError):
        source().fetch("1", utc(2026, 11, 16), utc(2026, 11, 17))


class FakeSource:
    def __init__(self, fail=()):
        self.fail = set(fail)
        self.calls = []

    def fetch(self, estacao, inicio, fim):
        self.calls.append((estacao, inicio, fim))
        if estacao in self.fail:
            raise httpx.ConnectError("boom")
        return [
            ana.AnaReading(estacao, utc(2026, 11, 17, 5, 15), 1.0, None, 0.0),
            ana.AnaReading(estacao, utc(2026, 11, 17, 5, 30), None, None, None),
        ]


def test_points_have_fields_only_when_present_and_skip_empty_rows():
    sink = FakeSink()
    ana.collect_ana(FakeSource(), sink, utc(2026, 11, 17, 12), sleep=lambda s: None)
    bucket, pts = sink.writes[0]
    assert bucket == "externos"
    tags, fields, t = rec(pts[0])
    assert pts[0]._name == "ana_telemetria"
    assert tags == {"estacao": "39770000"} and fields == {"vazao": 1.0, "chuva": 0.0}
    assert t == utc(2026, 11, 17, 5, 15)
    assert len(pts) == 1


def test_collect_window_is_48h_with_1s_pause_between_stations():
    src, sleeps = FakeSource(), []
    ana.collect_ana(src, FakeSink(), utc(2026, 11, 17, 12), sleep=sleeps.append)
    assert [c[0] for c in src.calls] == list(ana.ESTACOES)
    assert src.calls[0][1:] == (utc(2026, 11, 15, 12), utc(2026, 11, 17, 12))
    assert sleeps == [1.0] * 4


def test_one_station_failure_does_not_skip_the_others():
    sink = FakeSink()
    with pytest.raises(RuntimeError) as e:
        ana.collect_ana(FakeSource(fail={"39760000"}), sink, utc(2026, 11, 17, 12), sleep=lambda s: None)
    assert "39760000" in str(e.value)
    written = [p._tags["estacao"] for _, pts in sink.writes for p in pts]
    assert written == ["39770000", "39740000", "39700000", "39800100"]


def test_backfill_monthly_chunks_with_2s_pause_per_station():
    src, sleeps, sink = FakeSource(), [], FakeSink()
    ana.backfill_ana(src, sink, date(2026, 1, 20), date(2026, 2, 10), sleep=sleeps.append)
    first = [c for c in src.calls if c[0] == "39770000"]
    assert first[0][1:] == (utc(2026, 1, 20), utc(2026, 1, 31, 23, 59, 59))
    assert first[1][1:] == (utc(2026, 2, 1), utc(2026, 2, 10, 23, 59, 59))
    assert len(src.calls) == 10
    assert sleeps == [2.0] * 9


def test_backfill_failure_in_one_station_still_writes_others_then_raises():
    sink = FakeSink()
    with pytest.raises(RuntimeError, match="39740000"):
        ana.backfill_ana(FakeSource(fail={"39740000"}), sink, date(2026, 1, 1), date(2026, 1, 2), sleep=lambda s: None)
    assert len(sink.writes) == 4


def test_backfill_ana_cli_wiring(monkeypatch):
    calls = {}
    monkeypatch.setenv("INFLUX_URL", "http://127.0.0.1:1")
    monkeypatch.setenv("INFLUX_ORG", "o")
    monkeypatch.setenv("INFLUX_WORKER_TOKEN", "t")
    monkeypatch.setenv("PG_WORKER_DSN", "postgresql://x")

    def fake(source, sink, start, end, **kw):
        calls["args"] = (start, end)

    monkeypatch.setattr(ana, "backfill_ana", fake)
    assert cli.main(["backfill-ana", "--start", "2024-06-01", "--end", "2024-06-03"]) == 0
    assert calls["args"] == (date(2024, 6, 1), date(2024, 6, 3))
    assert cli.main(["backfill-ana", "--start", "2024-06-01"]) == 0
    from datetime import timedelta
    assert calls["args"][1] == datetime.now(timezone.utc).date() - timedelta(days=1)
