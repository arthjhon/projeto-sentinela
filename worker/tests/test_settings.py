import pytest

from sentinela_worker.settings import Settings

ENV = {
    "INFLUX_URL": "http://influxdb:8086",
    "INFLUX_ORG": "sentinela",
    "INFLUX_WORKER_TOKEN": "tok-secret-123",
    "PG_WORKER_DSN": "postgresql://u:pw-secret-456@db/x",
}


def test_from_env_reads_values_and_default_config_path():
    s = Settings.from_env(ENV)
    assert s.influx_url == "http://influxdb:8086"
    assert s.detector_config_path == "/app/config/detector.yaml"
    assert Settings.from_env({**ENV, "DETECTOR_CONFIG": "/x.yaml"}).detector_config_path == "/x.yaml"


def test_repr_hides_secrets():
    text = repr(Settings.from_env(ENV))
    assert "tok-secret-123" not in text and "pw-secret-456" not in text


def test_missing_var_names_it_without_values():
    env = {k: v for k, v in ENV.items() if k != "PG_WORKER_DSN"}
    with pytest.raises(RuntimeError) as e:
        Settings.from_env(env)
    msg = str(e.value)
    assert "PG_WORKER_DSN" in msg and "tok-secret-123" not in msg
