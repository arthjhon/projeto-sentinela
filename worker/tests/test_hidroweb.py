import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

from sentinela_worker.collectors import hidroweb
from sentinela_worker.collectors.ana import ESTACOES, LOCAL_TZ
from sentinela_worker.collectors.hidroweb import (
    AnaCredentialsMissing,
    HidroWebSource,
    busca_params,
    parse_serie,
)

FIX = Path(__file__).parent / "fixtures"
SERIE = json.loads((FIX / "hidroweb_serie.json").read_text())
AUTH = json.loads((FIX / "hidroweb_auth.json").read_text())
PASSWORD = "pw-s3cret-xyz"
USER = "12345678901"
TOKEN = AUTH["items"]["tokenautenticacao"]
WALL = datetime(2026, 11, 20, 0, 0, tzinfo=LOCAL_TZ)  # validade in the fixture is 00:33:15 (-03:00)
AUTH_PATH = "/hidrowebservice/EstacoesTelemetricas/OAUth/v1"
SERIE_PATH = "/hidrowebservice/EstacoesTelemetricas/HidroinfoanaSerieTelemetricaAdotada/v2"


def utc(*a):
    return datetime(*a, tzinfo=timezone.utc)


def local(*a):
    return datetime(*a, tzinfo=LOCAL_TZ)


class Api:
    """Scripted ANA: records requests, answers auth/series with configurable replies."""

    def __init__(self, series=None, auth=None):
        self.requests: list[httpx.Request] = []
        self.series = list(series or [])      # queue of callables/Responses; last one repeats
        self.auth = list(auth or [])

    def _next(self, queue, default):
        item = queue.pop(0) if len(queue) > 1 else (queue[0] if queue else default)
        return item() if callable(item) else item

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        if req.url.path == AUTH_PATH:
            return self._next(self.auth, httpx.Response(200, json=AUTH))
        assert req.url.path == SERIE_PATH, req.url
        return self._next(self.series, httpx.Response(200, json=SERIE))

    @property
    def auths(self):
        return [r for r in self.requests if r.url.path == AUTH_PATH]

    @property
    def series_reqs(self):
        return [r for r in self.requests if r.url.path == SERIE_PATH]


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


@pytest.fixture(autouse=True)
def wall(monkeypatch):
    now = [WALL]
    monkeypatch.setattr(hidroweb, "_utcnow", lambda: now[0].astimezone(timezone.utc))
    return now


def make(api, clock=None, user=USER, password=PASSWORD):
    client = httpx.Client(transport=httpx.MockTransport(api))
    return HidroWebSource(client, user, password, clock=clock or Clock())


WIN = (utc(2026, 11, 18, 0), utc(2026, 11, 20, 0))
FOUR = ESTACOES[:4]


# --- parse_serie -------------------------------------------------------------


def test_parse_maps_fields_and_utc():
    out = parse_serie(SERIE, FOUR)
    first = out["39770000"][0]
    assert first.estacao == "39770000"
    assert first.time == utc(2026, 11, 19, 2, 45)  # 23:45 America/Maceio
    assert (first.vazao, first.chuva) == (7.22, 0.0)
    raw = next(x for x in SERIE["items"] if x["codigoestacao"] == "39770000"
               and x["Data_Hora_Medicao"] == "2026-11-18 23:45:00.0")
    assert first.nivel == float(raw["Cota_Adotada"])


def test_null_and_empty_are_absent():
    body = {"status": "OK", "code": 200, "items": [
        {"codigoestacao": "39770000", "Data_Hora_Medicao": "2026-11-19 01:15:00.0",
         "Vazao_Adotada": None, "Cota_Adotada": "", "Chuva_Adotada": "nan"},
    ]}
    (r,) = parse_serie(body, ["39770000"])["39770000"]
    assert (r.vazao, r.nivel, r.chuva) == (None, None, None)


def test_status_fields_parsed():
    body = {"status": "OK", "code": 200, "items": [
        {"codigoestacao": "1", "Data_Hora_Medicao": "2026-11-19 01:15:00.0", "Vazao_Adotada": "1.0",
         "Vazao_Adotada_Status": "0", "Cota_Adotada": "2.0", "Cota_Adotada_Status": None,
         "Chuva_Adotada": "0.0", "Chuva_Adotada_Status": "0"},
    ]}
    (r,) = parse_serie(body, ["1"])["1"]
    assert (r.vazao_status, r.nivel_status, r.chuva_status) == (0, None, 0)


def test_every_requested_station_is_a_key():
    out = parse_serie(SERIE, ESTACOES)
    assert set(out) == set(ESTACOES) and out["39800100"] == []


def test_unrequested_station_dropped(capsys):
    out = parse_serie(SERIE, ["39770000"])
    assert set(out) == {"39770000"} and out["39770000"]
    assert all(r.estacao == "39770000" for r in out["39770000"])
    assert "unrequested" in capsys.readouterr().out


def test_bad_timestamp_dropped(capsys):
    body = {"status": "OK", "code": 200, "items": [
        {"codigoestacao": "1", "Data_Hora_Medicao": "garbage", "Vazao_Adotada": "1"},
        {"codigoestacao": "1", "Data_Hora_Medicao": None, "Vazao_Adotada": "1"},
        {"codigoestacao": "1", "Data_Hora_Medicao": "2026-11-19 01:15:00.0", "Vazao_Adotada": "1"},
    ]}
    assert len(parse_serie(body, ["1"])["1"]) == 1
    assert "bad timestamp" in capsys.readouterr().out


@pytest.mark.parametrize("body", [
    {"status": "ERROR", "code": 500, "message": "boom", "items": None},
    {"status": "OK", "code": 400, "items": []},
    {"status": "NOK", "code": 200, "items": []},
])
def test_api_error_status_raises(body):
    with pytest.raises(hidroweb.AnaApiError):
        parse_serie(body, ["1"])


def test_api_error_status_raises_through_fetch():
    api = Api(series=[httpx.Response(200, json={"status": "ERROR", "code": 500, "message": "x", "items": None})])
    with pytest.raises(hidroweb.AnaApiError):
        make(api).fetch("39770000", *WIN)


def test_items_none_with_ok_status_is_no_data():
    out = parse_serie({"status": "OK", "code": 200, "items": None}, ["1"])
    assert out == {"1": []}


# --- busca_params ------------------------------------------------------------


def test_busca_params_collect():
    now = local(2026, 11, 19, 23, 33)
    assert busca_params(now - timedelta(hours=48), now, now.date()) == (date(2026, 11, 19), "DIAS_2")


def test_busca_params_last_24h_today():
    now = local(2026, 11, 19, 23, 33)
    assert busca_params(now - timedelta(hours=24), now, now.date()) == (date(2026, 11, 19), "HORA_24")


def test_busca_params_past_day():
    # a past date's window is that whole local day, so one local day fits HORA_24
    assert busca_params(local(2026, 11, 10, 0), local(2026, 11, 10, 23, 59, 59), date(2026, 11, 19)) == (
        date(2026, 11, 10), "HORA_24")
    # DIAS_2 on a past date starts at 00:00 of the previous day
    assert busca_params(local(2026, 11, 9, 0), local(2026, 11, 10, 23, 59, 59), date(2026, 11, 19)) == (
        date(2026, 11, 10), "DIAS_2")
    assert busca_params(local(2026, 11, 8, 23), local(2026, 11, 10, 23, 59, 59), date(2026, 11, 19))[1] == "DIAS_7"


def test_busca_params_29_days():
    fim = local(2026, 11, 10, 23, 59, 59)
    inicio = local(2026, 10, 13, 0)  # 29 local days ending 2026-11-10
    assert busca_params(inicio, fim, date(2026, 11, 19)) == (date(2026, 11, 10), "DIAS_30")


def test_busca_params_today_fim_before_now_measures_span_from_now():
    now = local(2026, 11, 19, 12, 0)
    inicio, fim = local(2026, 11, 17, 0), local(2026, 11, 19, 0)  # span exactly 2 d, but now is 12 h later
    assert busca_params(inicio, fim, now.date(), now) == (date(2026, 11, 19), "DIAS_7")
    # without `now` the window would be mistaken for DIAS_2 and lose the first 12 h
    assert busca_params(inicio, fim, now.date()) == (date(2026, 11, 19), "DIAS_2")


def test_busca_params_uses_local_date_of_fim():
    fim = utc(2026, 11, 11, 1, 0)  # 22:00 on the 10th in Maceio
    assert busca_params(fim - timedelta(hours=3), fim, date(2026, 11, 19))[0] == date(2026, 11, 10)


def test_busca_params_window_beyond_api_raises():
    with pytest.raises(ValueError):
        busca_params(local(2026, 9, 1), local(2026, 11, 10, 23), date(2026, 11, 19))


# --- fetch_many / token ------------------------------------------------------


def test_fetch_many_one_request_for_all_stations(wall):
    api = Api()
    now = local(2026, 11, 19, 23, 33)
    wall[0] = now
    src = make(api)
    out = src.fetch_many(ESTACOES, now - timedelta(hours=48), now)
    assert set(out) == set(ESTACOES)
    assert len(api.series_reqs) == 1 and len(api.auths) == 1
    q = dict(api.series_reqs[0].url.params)
    assert q == {
        "Codigos_Estacoes": "39770000,39760000,39740000,39700000,39800100",
        "Tipo Filtro Data": "DATA_LEITURA",
        "Data de Busca (yyyy-MM-dd)": "2026-11-19",
        "Range Intervalo de busca": "DIAS_2",
    }


def test_fetch_many_today_decision_uses_utcnow_seam(wall):
    wall[0] = local(2026, 11, 19, 12, 0)  # "today" is 2026-11-19 even though the real date is later
    api = Api()
    make(api).fetch_many(FOUR, local(2026, 11, 17, 0), local(2026, 11, 19, 0))
    q = dict(api.series_reqs[0].url.params)
    assert (q["Data de Busca (yyyy-MM-dd)"], q["Range Intervalo de busca"]) == ("2026-11-19", "DIAS_7")
    wall[0] = local(2026, 11, 25, 12, 0)  # fim now clearly in the past: midnight-aligned DIAS_2
    api = Api()
    make(api).fetch_many(FOUR, local(2026, 11, 18, 0), local(2026, 11, 19, 0))
    assert dict(api.series_reqs[0].url.params)["Range Intervalo de busca"] == "DIAS_2"


def test_auth_response_too_large_raises():
    api = Api(auth=[httpx.Response(200, content=b"x" * (hidroweb.MAX_AUTH_BODY_BYTES + 1))])
    with pytest.raises(hidroweb.AnaAuthError, match="too large"):
        make(api).fetch("39770000", *WIN)
    assert not api.series_reqs


def test_rows_are_filtered_to_window():
    api = Api()
    out = make(api).fetch_many(FOUR, utc(2026, 11, 19, 3, 0), utc(2026, 11, 19, 23, 0))
    times = [r.time for rows in out.values() for r in rows]
    assert times and all(utc(2026, 11, 19, 3, 0) <= t <= utc(2026, 11, 19, 23, 0) for t in times)


def test_fetch_single_station():
    api = Api()
    rows = make(api).fetch("39770000", *WIN)
    assert rows and all(r.estacao == "39770000" for r in rows)
    assert dict(api.series_reqs[0].url.params)["Codigos_Estacoes"] == "39770000"


def test_headers_auth_only_on_auth_request():
    api = Api()
    make(api).fetch("39770000", *WIN)
    a, s = api.auths[0], api.series_reqs[0]
    assert a.headers["Identificador"] == USER and a.headers["Senha"] == PASSWORD
    assert "authorization" not in a.headers
    assert s.headers["Authorization"] == f"Bearer {TOKEN}"
    assert "identificador" not in s.headers and "senha" not in s.headers


def test_window_too_long_or_too_many_stations_raise():
    src = make(Api())
    with pytest.raises(ValueError):
        src.fetch_many(["39770000"], utc(2026, 10, 1), utc(2026, 11, 19))
    with pytest.raises(ValueError):
        src.fetch_many([str(i) for i in range(11)], *WIN)


def test_token_reused_until_near_expiry():
    api, clock = Api(), Clock()
    src = make(api, clock)
    src.fetch("39770000", *WIN)
    clock.t += 60 * 20  # validade is 33 min away, margin is 5 min
    src.fetch("39770000", *WIN)
    assert len(api.auths) == 1 and len(api.series_reqs) == 2


def test_token_renewed_5min_before_validade():
    # validade is 33:15 (1995 s) after "now"; the margin is 300 s, so renewal starts at 1695 s
    api, clock = Api(), Clock()
    src = make(api, clock)
    src.fetch("39770000", *WIN)
    clock.t += 1690
    src.fetch("39770000", *WIN)
    assert len(api.auths) == 1
    clock.t += 10
    src.fetch("39770000", *WIN)
    assert len(api.auths) == 2


def test_unparsable_validade_assumes_50_minutes():
    auth = json.loads(json.dumps(AUTH))
    auth["items"]["validade"] = "not a date"
    api, clock = Api(auth=[httpx.Response(200, json=auth)]), Clock()
    src = make(api, clock)
    src.fetch("39770000", *WIN)
    clock.t += 2690  # 50 min = 3000 s, minus the 300 s margin = 2700 s
    src.fetch("39770000", *WIN)
    assert len(api.auths) == 1
    clock.t += 20
    src.fetch("39770000", *WIN)
    assert len(api.auths) == 2


def test_401_reauthenticates_once():
    api = Api(series=[httpx.Response(401), httpx.Response(200, json=SERIE)])
    rows = make(api).fetch("39770000", *WIN)
    assert rows
    assert len(api.auths) == 2 and len(api.series_reqs) == 2


def test_second_401_raises():
    api = Api(series=[httpx.Response(401)])
    with pytest.raises(hidroweb.AnaAuthError):
        make(api).fetch("39770000", *WIN)
    assert len(api.auths) == 2 and len(api.series_reqs) == 2  # no loop


def test_auth_rejected_raises():
    bad = {"status": "OK", "code": 200, "items": {"sucesso": False, "token": None, "tokenautenticacao": None}}
    api = Api(auth=[httpx.Response(200, json=bad)])
    with pytest.raises(hidroweb.AnaAuthError):
        make(api).fetch("39770000", *WIN)
    assert not api.series_reqs


def test_rejected_credentials_back_off_6h_then_retry():
    bad = {"status": "OK", "code": 200, "items": {"sucesso": False, "tokenautenticacao": None}}
    clock = Clock()
    api = Api(auth=[httpx.Response(200, json=bad), httpx.Response(200, json=bad)])
    src = make(api, clock=clock)
    with pytest.raises(hidroweb.AnaAuthError, match="rejected"):
        src.fetch("39770000", *WIN)
    assert len(api.auths) == 1
    for _ in range(3):  # later ticks: no new auth request
        clock.t += 900
        with pytest.raises(hidroweb.AnaAuthError, match="suspended") as ei:
            src.fetch("39770000", *WIN)
        assert ei.value.permanent
    assert len(api.auths) == 1
    clock.t += 6 * 3600
    with pytest.raises(hidroweb.AnaAuthError):
        src.fetch("39770000", *WIN)
    assert len(api.auths) == 2  # window over: tried again


def test_missing_credentials_raises():
    for user, pw in ((None, PASSWORD), (USER, None), ("", ""), (None, None)):
        api = Api()
        with pytest.raises(AnaCredentialsMissing) as ei:
            make(api, user=user, password=pw).fetch("39770000", *WIN)
        assert str(ei.value) == "credencial ANA ausente (ANA_HIDRO_USER/ANA_HIDRO_PASS)"
        assert not api.requests
    assert issubclass(AnaCredentialsMissing, RuntimeError)


def test_response_too_large_raises(monkeypatch):
    monkeypatch.setattr(hidroweb, "MAX_BODY_BYTES", 100)
    with pytest.raises(ValueError, match="too large"):
        make(Api()).fetch("39770000", *WIN)


def test_invalid_json_raises():
    api = Api(series=[httpx.Response(200, text="<html>not json</html>")])
    with pytest.raises(ValueError):
        make(api).fetch("39770000", *WIN)


def _timeout(req=None):
    raise httpx.ReadTimeout("timed out")


@pytest.mark.parametrize("kind", ["auth500", "series500", "timeout", "auth_echo", "series_echo"])
def test_errors_do_not_contain_secrets(kind, capsys):
    if kind == "auth500":
        api = Api(auth=[httpx.Response(500, text="boom")])
    elif kind == "auth_echo":
        api = Api(auth=[httpx.Response(500, text=f"Senha={PASSWORD} Identificador={USER}")])
    elif kind == "series500":
        api = Api(series=[httpx.Response(500, text="boom")])
    elif kind == "series_echo":
        api = Api(series=[httpx.Response(500, text=f"Bearer {TOKEN} {PASSWORD}")])
    else:
        api = Api(series=[_timeout])
    with pytest.raises(Exception) as ei:
        make(api).fetch("39770000", *WIN)
    blob = repr(ei.value) + str(ei.value) + capsys.readouterr().out + capsys.readouterr().err
    from sentinela_worker.redact import redact_error
    blob += redact_error(ei.value)
    for secret in (PASSWORD, TOKEN, USER):
        assert secret not in blob
