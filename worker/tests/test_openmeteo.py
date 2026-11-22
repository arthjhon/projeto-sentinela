import json
from datetime import date, datetime, timezone
from pathlib import Path

import httpx
import pytest
import respx

from sentinela_worker.collectors import openmeteo as om

FIX = Path(__file__).parent / "fixtures"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
PREVIOUS_URL = "https://previous-runs-api.open-meteo.com/v1/forecast"


def load(name):
    return json.loads((FIX / name).read_text())


def utc(*a):
    return datetime(*a, tzinfo=timezone.utc)


def rec(p):
    return p._tags, p._fields, p._time


class FakeSink:
    def __init__(self):
        self.writes = []

    def write(self, bucket, points):
        self.writes.append((bucket, list(points)))


def payload(times, **series):
    return {"hourly": {"time": times, **series}}


def test_lead_time_is_hours_from_fetch_hour():
    pts = om.forecast_points(load("openmeteo_forecast.json"), utc(2026, 11, 17, 10, 37))
    p = next(x for x in pts if x._time == utc(2026, 11, 17, 13))
    assert p._tags["antecedencia_h"] == "3"
    assert p._tags["fonte"] == "openmeteo"
    assert p._tags["modelo"] == "best_match"
    assert p._tags["ponto"] == "celmm"
    assert p._name == "previsao"
    assert set(p._fields) <= set(om.VARIABLES)


def test_past_hours_are_dropped():
    pts = om.forecast_points(load("openmeteo_forecast.json"), utc(2026, 11, 17, 10, 37))
    leads = [int(p._tags["antecedencia_h"]) for p in pts]
    assert min(leads) == 0
    assert all(l >= 0 for l in leads)
    assert not any(p._time == utc(2026, 11, 17, 9) for p in pts)


def test_lead_time_capped_at_168():
    times = [f"2026-11-{17 + h // 24}T{h % 24:02d}:00" for h in range(0, 200)]
    pl = payload(times, temperature_2m=[20.0] * 200)
    pts = om.forecast_points(pl, utc(2026, 11, 17, 0, 5))
    leads = [int(p._tags["antecedencia_h"]) for p in pts]
    assert max(leads) == 168 and min(leads) == 0
    assert len(pts) == 169


def test_lead_tag_is_integer_string_within_range():
    for p in om.forecast_points(load("openmeteo_forecast.json"), utc(2026, 11, 17, 0, 1)):
        s = p._tags["antecedencia_h"]
        assert isinstance(s, str) and s.isdigit() and 0 <= int(s) <= 168
    for p in om.previous_runs_points(load("openmeteo_previous_runs.json")):
        s = p._tags["antecedencia_h"]
        assert isinstance(s, str) and s.isdigit() and 24 <= int(s) <= 168


def test_previous_day_n_maps_to_24n_hours():
    pl = payload(
        ["2024-06-10T00:00"],
        temperature_2m_previous_day3=[25.5],
        temperature_2m_previous_day1=[24.0],
    )
    got = {p._tags["antecedencia_h"]: p._fields["temperature_2m"] for p in om.previous_runs_points(pl)}
    assert got == {"72": 25.5, "24": 24.0}


def test_previous_runs_fixture_all_leads_present():
    pts = om.previous_runs_points(load("openmeteo_previous_runs.json"))
    assert {p._tags["antecedencia_h"] for p in pts} == {str(24 * n) for n in range(1, 8)}
    assert all(p._tags["modelo"] == "best_match" and p._tags["ponto"] == "celmm" for p in pts)
    # precipitation_probability is entirely null in this fixture: never written, never zero
    assert not any("precipitation_probability" in p._fields for p in pts)
    assert any("precipitation" in p._fields for p in pts)


def test_null_values_are_skipped_not_zeroed():
    pl = payload(
        ["2026-11-17T10:00", "2026-11-17T11:00"],
        precipitation=[None, 0.0],
        cloud_cover=[None, None],
        temperature_2m=[30.1, None],
    )
    pts = om.forecast_points(pl, utc(2026, 11, 17, 10, 0))
    recs = {p._tags["antecedencia_h"]: p._fields for p in pts}
    assert recs == {"0": {"temperature_2m": 30.1}, "1": {"precipitation": 0.0}}


def test_missing_variable_is_skipped():
    pl = payload(["2026-11-17T10:00"], temperature_2m=[30.1])
    pts = om.forecast_points(pl, utc(2026, 11, 17, 10, 0))
    assert [p._fields for p in pts] == [{"temperature_2m": 30.1}]


@respx.mock
def test_fetch_forecast_request_params_and_user_agent():
    route = respx.get(FORECAST_URL).respond(200, json=load("openmeteo_forecast.json"))
    with httpx.Client() as c:
        out = om.fetch_forecast(c, -9.6559, -35.7701)
    assert out["hourly"]["time"]
    req = route.calls[0].request
    q = req.url.params
    assert q["forecast_days"] == "7" and q["timezone"] == "UTC"
    assert q["latitude"] == "-9.6559" and q["longitude"] == "-35.7701"
    assert q["hourly"] == ",".join(om.VARIABLES)
    assert req.headers["user-agent"].startswith("sentinela-worker/")


def test_current_points_have_no_lead_tag_and_measurement_previsao_atual():
    pts = om.current_points(load("openmeteo_forecast.json"), utc(2026, 11, 17, 10, 37), "bacia_mundau")
    assert pts
    for p in pts:
        assert p._name == "previsao_atual"
        assert "antecedencia_h" not in p._tags
        assert p._tags["ponto"] == "bacia_mundau"
        assert p._tags["fonte"] == "openmeteo" and p._tags["modelo"] == "best_match"
        assert set(p._fields) <= set(om.VARIABLES)


def test_current_points_skip_past_hours():
    pts = om.current_points(load("openmeteo_forecast.json"), utc(2026, 11, 17, 10, 37), "celmm")
    assert min(p._time for p in pts) == utc(2026, 11, 17, 10)
    assert not any(p._time == utc(2026, 11, 17, 9) for p in pts)


def test_forecast_points_tag_ponto():
    fc = load("openmeteo_forecast.json")
    now = utc(2026, 11, 17, 10, 37)
    assert {p._tags["ponto"] for p in om.forecast_points(fc, now)} == {"celmm"}
    assert {p._tags["ponto"] for p in om.forecast_points(fc, now, "bacia_mundau")} == {"bacia_mundau"}


def test_pontos_constant():
    assert om.PONTOS == (("celmm", -9.6559, -35.7701), ("bacia_mundau", -9.4672, -35.8597))


@respx.mock
def test_fetch_uses_point_coordinates():
    route = respx.get(FORECAST_URL).respond(200, json=load("openmeteo_forecast.json"))
    sink = FakeSink()
    with httpx.Client() as c:
        om.collect_openmeteo(c, sink, utc(2026, 11, 17, 10, 37))
    got = {(r.request.url.params["latitude"], r.request.url.params["longitude"]) for r in route.calls}
    assert got == {("-9.6559", "-35.7701"), ("-9.4672", "-35.8597")}


@respx.mock
def test_collect_writes_once_per_point():
    respx.get(FORECAST_URL).respond(200, json=load("openmeteo_forecast.json"))
    sink = FakeSink()
    with httpx.Client() as c:
        om.collect_openmeteo(c, sink, utc(2026, 11, 17, 10, 37))
    assert len(sink.writes) == 2
    assert all(b == "externos" for b, _ in sink.writes)
    for (_, pts), ponto in zip(sink.writes, ["celmm", "bacia_mundau"]):
        assert {p._tags["ponto"] for p in pts} == {ponto}
        assert {p._name for p in pts} == {"previsao", "previsao_atual"}


@respx.mock
def test_one_point_failure_still_writes_other():
    def handler(request):
        if request.url.params["latitude"] == "-9.4672":
            return httpx.Response(500, text="boom")
        return httpx.Response(200, json=load("openmeteo_forecast.json"))

    respx.get(FORECAST_URL).mock(side_effect=handler)
    sink = FakeSink()
    with httpx.Client() as c, pytest.raises(httpx.HTTPStatusError):
        om.collect_openmeteo(c, sink, utc(2026, 11, 17, 10, 37))
    assert len(sink.writes) == 1
    assert {p._tags["ponto"] for p in sink.writes[0][1]} == {"celmm"}


@respx.mock
def test_openmeteo_http_error_records_failure():
    respx.get(FORECAST_URL).respond(503, html="<html>Service Unavailable</html>")
    sink = FakeSink()
    with httpx.Client() as c, pytest.raises(httpx.HTTPStatusError):
        om.collect_openmeteo(c, sink, utc(2026, 11, 17, 10, 37))
    assert sink.writes == []


@respx.mock
def test_malformed_payload_raises_without_writing():
    respx.get(FORECAST_URL).respond(200, json={"hourly": {"time": ["2026-11-17T10:00"], "temperature_2m": [1, 2, 3]}})
    sink = FakeSink()
    with httpx.Client() as c, pytest.raises(Exception):
        om.collect_openmeteo(c, sink, utc(2026, 11, 17, 10, 37))
    assert sink.writes == []


@respx.mock
def test_backfill_monthly_chunks_sleep_and_idempotent(capsys):
    route = respx.get(PREVIOUS_URL).respond(200, json=load("openmeteo_previous_runs.json"))
    sink = FakeSink()
    sleeps = []
    with httpx.Client() as c:
        om.backfill_openmeteo(c, sink, date(2024, 5, 20), date(2024, 7, 10), sleep=sleeps.append)
        first = [[rec(p) for p in pts] for _, pts in sink.writes]
        om.backfill_openmeteo(c, sink, date(2024, 5, 20), date(2024, 7, 10), sleep=sleeps.append)
    ranges = [(r.request.url.params["start_date"], r.request.url.params["end_date"]) for r in route.calls[:3]]
    assert ranges == [("2024-05-20", "2024-05-31"), ("2024-06-01", "2024-06-30"), ("2024-07-01", "2024-07-10")]
    assert len(sink.writes) == 6 and all(b == "externos" for b, _ in sink.writes)
    assert all(s >= 1 for s in sleeps) and len(sleeps) == 4  # between requests only
    assert [[rec(p) for p in pts] for _, pts in sink.writes[3:]] == first
    lines = [json.loads(l) for l in capsys.readouterr().out.splitlines() if l.strip()]
    assert sum(1 for l in lines if l["job"] == "backfill-openmeteo") >= 6
    assert route.calls[0].request.headers["user-agent"].startswith("sentinela-worker/")


@respx.mock
def test_backfill_error_does_not_write_failed_chunk():
    respx.get(PREVIOUS_URL).respond(503, html="<html>x</html>")
    sink = FakeSink()
    with httpx.Client() as c, pytest.raises(httpx.HTTPStatusError):
        om.backfill_openmeteo(c, sink, date(2024, 6, 1), date(2024, 6, 2), sleep=lambda s: None)
    assert sink.writes == []
