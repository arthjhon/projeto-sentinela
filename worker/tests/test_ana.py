from datetime import date, datetime, timedelta, timezone
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
    note = ana.collect_ana(FakeSource(fail={"39760000"}), sink, utc(2026, 11, 17, 12), sleep=lambda s: None)
    assert note == "estacoes secundarias com falha: 39760000"   # job ok, failure reported
    written = [p._tags["estacao"] for _, pts in sink.writes for p in pts]
    assert written == ["39770000", "39740000", "39700000", "39800100"]


def test_all_stations_ok_returns_no_note():
    assert ana.collect_ana(FakeSource(), FakeSink(), utc(2026, 11, 17, 12), sleep=lambda s: None) is None


def test_primary_station_failure_fails_the_job_and_lists_every_failed_station():
    sink = FakeSink()
    with pytest.raises(RuntimeError) as e:
        ana.collect_ana(FakeSource(fail={"39770000", "39800100"}), sink, utc(2026, 11, 17, 12),
                        sleep=lambda s: None)
    assert "39770000" in str(e.value) and "39800100" in str(e.value)
    written = [p._tags["estacao"] for _, pts in sink.writes for p in pts]
    assert written == ["39760000", "39740000", "39700000"]           # the others still written


def test_note_is_short_even_if_every_secondary_fails():
    note = ana.collect_ana(FakeSource(fail=set(ana.ESTACOES[1:])), FakeSink(), utc(2026, 11, 17, 12),
                           sleep=lambda s: None)
    assert note and len(note) <= ana.NOTE_MAX_CHARS and all(e in note for e in ana.ESTACOES[1:])


@respx.mock
def test_error_table_station_is_not_a_failure():
    """ErrorTable ("no data") from ANA, even for the primary station, is a successful
    request with zero points: no exception, no note."""
    error_table = (FIX / "ana_error_table.xml").read_bytes()
    data = xml([("39760000", "2026-11-17 02:15:00", "2.0", "1.0", "0.0")])

    def answer(request):
        if request.url.params["codEstacao"] in ("39770000", "39800100"):
            return httpx.Response(200, content=error_table)
        return httpx.Response(200, text=data)

    respx.get(URL).mock(side_effect=answer)
    sink = FakeSink()
    note = ana.collect_ana(source(), sink, utc(2026, 11, 17, 12), sleep=lambda s: None)
    assert note is None
    assert {p._tags["estacao"] for _, pts in sink.writes for p in pts} == {"39760000", "39740000", "39700000"}


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


# --- HidroWebService integration (batch source, selection) ---------------------------------

class BatchSource:
    max_window_days = 29

    def __init__(self, data=None, exc=None):
        self.data = data
        self.exc = exc
        self.calls = []

    def fetch_many(self, estacoes, inicio, fim):
        self.calls.append((tuple(estacoes), inicio, fim))
        if self.exc:
            raise self.exc
        if self.data is not None:
            return {e: list(self.data.get(e, [])) for e in estacoes}
        return {e: [ana.AnaReading(e, utc(2026, 11, 17, 5, 15), 1.0, 2.0, 0.0, 0, 0, 0)] for e in estacoes}

    def fetch(self, estacao, inicio, fim):  # pragma: no cover - must not be used
        raise AssertionError("per-station fetch must not be used with fetch_many")


def test_collect_uses_fetch_many_once():
    src, sleeps, sink = BatchSource(), [], FakeSink()
    note = ana.collect_ana(src, sink, utc(2026, 11, 17, 12), sleep=sleeps.append)
    assert note is None and sleeps == []
    assert src.calls == [(ana.ESTACOES, utc(2026, 11, 15, 12), utc(2026, 11, 17, 12))]
    assert sorted(p._tags["estacao"] for _, pts in sink.writes for p in pts) == sorted(ana.ESTACOES)


def test_collect_batch_failure_raises():
    sink = FakeSink()
    with pytest.raises(RuntimeError, match="boom"):
        ana.collect_ana(BatchSource(exc=RuntimeError("boom")), sink, utc(2026, 11, 17, 12), sleep=lambda s: None)
    assert sink.writes == []


def test_collect_station_without_data_is_ok():
    sink = FakeSink()
    r = ana.AnaReading("39770000", utc(2026, 11, 17, 5, 15), 1.0, None, None)
    note = ana.collect_ana(BatchSource(data={"39770000": [r]}), sink, utc(2026, 11, 17, 12), sleep=lambda s: None)
    assert note is None
    assert [p._tags["estacao"] for _, pts in sink.writes for p in pts] == ["39770000"]


def test_points_include_status_fields():
    r = ana.AnaReading("1", utc(2026, 11, 17, 5), 1.0, 2.0, None, 0, 0, None)
    (p,) = ana._points([r])
    assert p._fields == {"vazao": 1.0, "nivel": 2.0, "vazao_status": 0, "nivel_status": 0}
    assert all(isinstance(p._fields[k], int) for k in ("vazao_status", "nivel_status"))


def test_points_legacy_has_no_status_fields():
    (p,) = ana._points([ana.AnaReading("1", utc(2026, 11, 17, 5), 1.0, 2.0, 0.0)])
    assert p._fields == {"vazao": 1.0, "nivel": 2.0, "chuva": 0.0}


def test_backfill_chunks_fit_api_window():
    src, sink = BatchSource(), FakeSink()
    ana.backfill_ana(src, sink, date(2026, 1, 1), date(2026, 3, 15), sleep=lambda s: None)
    assert len(src.calls) == 3
    prev_end = None
    for estacoes, inicio, fim in src.calls:
        assert estacoes == ana.ESTACOES
        assert (fim.date() - inicio.date()).days + 1 <= 29
        if prev_end is None:
            assert inicio == utc(2026, 1, 1)
        else:
            assert inicio.date() == prev_end.date() + timedelta(days=1)
        prev_end = fim
    assert prev_end == utc(2026, 3, 15, 23, 59, 59)


def test_backfill_batch_failure_raises():
    with pytest.raises(RuntimeError, match="backfill-ana"):
        ana.backfill_ana(BatchSource(exc=RuntimeError("x")), FakeSink(), date(2026, 1, 1), date(2026, 1, 2),
                         sleep=lambda s: None)


def test_make_ana_source_default_is_hidroweb():
    from sentinela_worker.collectors.hidroweb import HidroWebSource
    assert isinstance(ana.make_ana_source({}, httpx.Client()), HidroWebSource)
    assert isinstance(ana.make_ana_source({"ANA_SOURCE": "hidrowebservice"}, httpx.Client()), HidroWebSource)


def test_make_ana_source_legado():
    assert isinstance(ana.make_ana_source({"ANA_SOURCE": "legado"}, httpx.Client()), ana.AnaLegacySource)


def test_make_ana_source_unknown_raises():
    with pytest.raises(ValueError, match="ANA_SOURCE"):
        ana.make_ana_source({"ANA_SOURCE": "xpto"}, httpx.Client())


def test_missing_credentials_job_fails_with_message(monkeypatch):
    from sentinela_worker import scheduler
    monkeypatch.delenv("ANA_SOURCE", raising=False)
    monkeypatch.delenv("ANA_HIDRO_USER", raising=False)
    monkeypatch.delenv("ANA_HIDRO_PASS", raising=False)
    jobs, closers = cli.build_jobs(object(), object(), "config/detector.yaml")

    class Status:
        def __init__(self):
            self.rows = []

        def record(self, name, ok, started, duration, error):
            self.rows.append((name, ok, error))

    status = Status()
    try:
        ana_job = next(j for j in jobs if j.name == "ana")
        scheduler._run_job(ana_job, status, scheduler.utcnow)
        other = scheduler.Job("other", 60, lambda now: None)
        scheduler._run_job(other, status, scheduler.utcnow)
    finally:
        for c in closers:
            c.close()
    (n1, ok1, err1), (n2, ok2, _) = status.rows
    assert (n1, ok1) == ("ana", False)
    assert "credencial ANA ausente (ANA_HIDRO_USER/ANA_HIDRO_PASS)" in err1
    assert (n2, ok2) == ("other", True)


def test_redact_covers_ana_auth_headers():
    from sentinela_worker.redact import redact_text
    out = redact_text("Identificador: 12345678901 Senha: s3cr3t tokenautenticacao: abc.def Authorization: Bearer xyz")
    for secret in ("12345678901", "s3cr3t", "abc.def", "xyz"):
        assert secret not in out
