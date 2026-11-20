from datetime import datetime, timezone

import httpx

from sentinela_worker.redact import MAX_ERROR_LEN, redact_error, redact_text
from sentinela_worker.scheduler import Job, run_forever


def _http_error(url):
    req = httpx.Request("GET", url)
    return httpx.HTTPStatusError(
        f"Client error '401' for url '{url}'", request=req, response=httpx.Response(401, request=req)
    )


def test_masks_query_userinfo_and_auth_values():
    cases = [
        "https://api.x/v1?x=1&apikey=SECRET&y=2",
        "https://user:pw@api.x/v1?x=1",
        "https://api.x/v1?Access_Token=SECRET&x=1",
    ]
    for url in cases:
        out = redact_error(_http_error(url))
        assert "SECRET" not in out and "pw@" not in out and "user:" not in out
    assert "x=1" in redact_error(_http_error(cases[0]))
    out = redact_error(RuntimeError("Authorization: Bearer abc.def got Token xyz123"))
    assert "abc.def" not in out and "xyz123" not in out


def test_truncates_to_cap():
    assert len(redact_error(ValueError("a" * 5000))) <= MAX_ERROR_LEN


def test_scheduler_log_and_status_are_redacted(tmp_path, monkeypatch, capsys):
    from datetime import timedelta
    from sentinela_worker import scheduler

    monkeypatch.setattr(scheduler, "TICK_FILE", str(tmp_path / "tick"))
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    clock = [t0]
    records = []

    class St:
        def record(self, job, ok, started, duration_s, error):
            records.append(error)

    def boom(now):
        raise _http_error("https://user:pw@api.x/v1?apikey=SECRET&x=1") from None

    def sleep(s):
        clock[0] += timedelta(seconds=s)

    run_forever([Job("a", 900, boom)], St(), now=lambda: clock[0], sleep=sleep,
                stop=lambda: clock[0] >= t0 + timedelta(seconds=10))
    out = capsys.readouterr().out
    assert records and all("SECRET" not in r and "pw" not in r for r in records)
    assert "SECRET" not in out and "pw@" not in out and "***" in out


def test_masks_ana_hidroweb_credentials_and_token():
    text = (
        "headers {'Identificador': '12345678901', 'Senha': 'pw-xyz'} "
        "Senha: pw-abc Identificador=98765432100 "
        '{"tokenautenticacao": "TOKEN-AAA", "token": "tok-bbb", "sucesso": true}'
    )
    out = redact_text(text)
    for secret in ("12345678901", "pw-xyz", "pw-abc", "98765432100", "TOKEN-AAA", "tok-bbb"):
        assert secret not in out
    assert "sucesso" in out
