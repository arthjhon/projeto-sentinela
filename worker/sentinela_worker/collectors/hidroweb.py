"""ANA HidroWebService source (EstacoesTelemetricas), behind the `AnaSource` interface.

Auth is a GET with the `Identificador`/`Senha` headers returning a Bearer token (~1 h).
Credentials, tokens and auth headers never reach a log line or an exception message: errors
carry only HTTP status codes and fixed text.

Request window (measured on the live API, 2026-11-20): `Data de Busca` is a local
(America/Maceio) date D and the window ends at the end of D (23:59), or at "now" when D is
today. `HORA_24` covers the 24 h before that end. `DIAS_N` covers, for a past D, 00:00 of
D-(N-1) up to the end of D; for today it is a rolling N x 24 h ending now. `busca_params`
picks the smallest range covering the window; rows are always filtered back to [inicio, fim].
"""
import json
import re
from collections.abc import Sequence
from datetime import date, datetime, time as dtime, timedelta, timezone
import time

import httpx

from ..log import log
from .ana import LOCAL_TZ, MAX_BODY_BYTES, USER_AGENT, AnaReading, _number

BASE_URL = "https://www.ana.gov.br/hidrowebservice/EstacoesTelemetricas"
AUTH_URL = f"{BASE_URL}/OAUth/v1"
SERIE_URL = f"{BASE_URL}/HidroinfoanaSerieTelemetricaAdotada/v2"
TIMEOUT = httpx.Timeout(60.0, connect=10.0)
MAX_STATIONS = 10
DEFAULT_TOKEN_LIFE_S = 50 * 60
TOKEN_MARGIN_S = 5 * 60
DAY_RANGES = ((2, "DIAS_2"), (7, "DIAS_7"), (14, "DIAS_14"), (21, "DIAS_21"), (30, "DIAS_30"))
MAX_RANGE_DAYS = DAY_RANGES[-1][0]
_VALIDADE = re.compile(r"^\w{3} (\w{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) GMT([+-])(\d{2}):(\d{2}) (\d{4})$")
_MONTHS = {m: i for i, m in enumerate(
    ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"), 1)}


class AnaCredentialsMissing(RuntimeError):
    def __init__(self):
        super().__init__("credencial ANA ausente (ANA_HIDRO_USER/ANA_HIDRO_PASS)")


class AnaAuthError(RuntimeError):
    pass


class AnaApiError(RuntimeError):
    pass


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_validade(text) -> datetime | None:
    """`Fri Nov 20 00:33:15 GMT-03:00 2026` -> aware datetime; None when unparsable."""
    m = _VALIDADE.match(str(text or "").strip())
    if not m or m.group(1) not in _MONTHS:
        return None
    mon, day, hh, mm, ss, sign, oh, om, year = m.groups()
    try:
        tz = timezone(timedelta(hours=int(oh), minutes=int(om)) * (1 if sign == "+" else -1))
        return datetime(int(year), _MONTHS[mon], int(day), int(hh), int(mm), int(ss), tzinfo=tz)
    except ValueError:
        return None


def busca_params(inicio: datetime, fim: datetime, today: date) -> tuple[date, str]:
    """`(Data de Busca, Range)` for the window inicio..fim (tz-aware). The date is the local
    date of `fim`. For today the window is the rolling span ending at `fim` (taken as now);
    for a past date it ends at the end of that day. Raises ValueError beyond DIAS_30."""
    d = fim.astimezone(LOCAL_TZ).date()
    if d >= today:
        span = fim - inicio
        if span <= timedelta(hours=24):
            return d, "HORA_24"
        for n, name in DAY_RANGES:
            if span <= timedelta(days=n):
                return d, name
    else:
        if inicio >= datetime.combine(d, dtime(), LOCAL_TZ):
            return d, "HORA_24"
        for n, name in DAY_RANGES:
            if inicio >= datetime.combine(d - timedelta(days=n - 1), dtime(), LOCAL_TZ):
                return d, name
    raise ValueError(f"window exceeds the {MAX_RANGE_DAYS}-day API range")


def _value(raw) -> tuple[float | None, bool]:
    if raw is None or isinstance(raw, bool):
        return None, raw is not None
    return _number(str(raw))


def _status(raw) -> tuple[int | None, bool]:
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None, False
    try:
        return int(str(raw).strip()), False
    except ValueError:
        return None, True


def parse_serie(body: dict, estacoes: Sequence[str]) -> dict[str, list[AnaReading]]:
    """Parses a series response. `status != "OK"` / `code != 200` raises AnaApiError (an API
    error is not "no data"). Every requested station is a key. Rows of stations not requested
    and rows with an unparsable timestamp are dropped with a warning. Rows are not
    window-filtered."""
    if not isinstance(body, dict) or body.get("status") != "OK" or body.get("code") != 200:
        status = body.get("status") if isinstance(body, dict) else None
        code = body.get("code") if isinstance(body, dict) else None
        raise AnaApiError(f"ANA API error: status={str(status)[:20]!r} code={str(code)[:10]!r}")
    out: dict[str, list[AnaReading]] = {e: [] for e in estacoes}
    items = body.get("items") or []
    if not isinstance(items, list):
        raise AnaApiError("ANA API error: unexpected items payload")
    unrequested = bad_time = malformed = 0
    for row in items:
        if not isinstance(row, dict):
            malformed += 1
            continue
        est = str(row.get("codigoestacao", "")).strip()
        if est not in out:
            unrequested += 1
            continue
        try:
            t = datetime.strptime(str(row.get("Data_Hora_Medicao")).strip(), "%Y-%m-%d %H:%M:%S.%f")
        except ValueError:
            bad_time += 1
            continue
        t = t.replace(tzinfo=LOCAL_TZ).astimezone(timezone.utc)
        vals = []
        for key in ("Vazao_Adotada", "Cota_Adotada", "Chuva_Adotada"):
            v, bad = _value(row.get(key))
            malformed += bad
            vals.append(v)
        stats = []
        for key in ("Vazao_Adotada_Status", "Cota_Adotada_Status", "Chuva_Adotada_Status"):
            s, bad = _status(row.get(key))
            malformed += bad
            stats.append(s)
        out[est].append(AnaReading(est, t, *vals, *stats))
    if unrequested:
        log("WARN", "ana", "rows for unrequested stations dropped", count=unrequested)
    if bad_time:
        log("WARN", "ana", "rows with bad timestamp dropped", count=bad_time)
    if malformed:
        log("WARN", "ana", "malformed values treated as missing", count=malformed)
    return out


class HidroWebSource:
    max_window_days = 29

    def __init__(self, client: httpx.Client, user: str | None, password: str | None, clock=time.monotonic):
        self._client = client
        self._user = user
        self._password = password
        self._clock = clock
        self._token: str | None = None
        self._renew_at = 0.0  # clock() value from which the token must be renewed

    # -- auth -----------------------------------------------------------------
    def _authenticate(self) -> None:
        self._token = None
        resp = self._client.get(
            AUTH_URL,
            headers={"Identificador": self._user, "Senha": self._password, "User-Agent": USER_AGENT},
            timeout=TIMEOUT,
        )
        if resp.status_code != 200:
            raise AnaAuthError(f"ANA auth failed: HTTP {resp.status_code}")
        try:
            items = resp.json().get("items") or {}
            token = items.get("tokenautenticacao")
            ok = items.get("sucesso") is True and isinstance(token, str) and bool(token)
        except (ValueError, AttributeError):
            raise AnaAuthError("ANA auth failed: unexpected response") from None
        if not ok:
            raise AnaAuthError("ANA auth failed: credentials rejected")
        validade = _parse_validade(items.get("validade"))
        life = (validade - _utcnow()).total_seconds() if validade else DEFAULT_TOKEN_LIFE_S
        self._token = token
        self._renew_at = self._clock() + life - TOKEN_MARGIN_S

    def _ensure_token(self) -> str:
        if self._token is None or self._clock() >= self._renew_at:
            self._authenticate()
        return self._token

    # -- series ---------------------------------------------------------------
    def _get_serie(self, params: dict) -> dict | None:
        buf = bytearray()
        with self._client.stream(
            "GET", SERIE_URL, params=params,
            headers={"Authorization": f"Bearer {self._ensure_token()}", "User-Agent": USER_AGENT},
            timeout=TIMEOUT,
        ) as resp:
            if resp.status_code == 401:
                return None
            if resp.status_code != 200:
                raise AnaApiError(f"ANA series failed: HTTP {resp.status_code}")
            for chunk in resp.iter_bytes():
                buf += chunk
                if len(buf) > MAX_BODY_BYTES:
                    raise ValueError("ANA response too large")
        try:
            return json.loads(bytes(buf))
        except ValueError:
            raise ValueError("invalid ANA JSON") from None

    def fetch_many(self, estacoes: Sequence[str], inicio: datetime, fim: datetime) -> dict[str, list[AnaReading]]:
        """One request for all stations. `inicio`/`fim` are tz-aware and inclusive."""
        if not self._user or not self._password:
            raise AnaCredentialsMissing()
        if not estacoes or len(estacoes) > MAX_STATIONS:
            raise ValueError(f"between 1 and {MAX_STATIONS} stations per request")
        if fim - inicio > timedelta(days=self.max_window_days):
            raise ValueError(f"window longer than {self.max_window_days} days")
        d, rng = busca_params(inicio, fim, datetime.now(LOCAL_TZ).date())
        params = {
            "Codigos_Estacoes": ",".join(estacoes),
            "Tipo Filtro Data": "DATA_LEITURA",
            "Data de Busca (yyyy-MM-dd)": d.isoformat(),
            "Range Intervalo de busca": rng,
        }
        body = self._get_serie(params)
        if body is None:  # 401 on a token that looked valid: re-authenticate once, never loop
            self._token = None
            body = self._get_serie(params)
            if body is None:
                raise AnaAuthError("ANA series failed: HTTP 401 after re-authentication")
        parsed = parse_serie(body, estacoes)
        return {e: [r for r in rows if inicio <= r.time <= fim] for e, rows in parsed.items()}

    def fetch(self, estacao: str, inicio: datetime, fim: datetime) -> list[AnaReading]:
        return self.fetch_many([estacao], inicio, fim)[estacao]
