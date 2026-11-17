"""DB tests against the local Supabase. Skipped unless TEST_PG_DSN is set.

Every test runs inside one transaction that is rolled back at the end: the
database is never modified persistently. Nothing here calls commit().
"""
import json
import os
import pathlib
from datetime import datetime, timedelta, timezone

import psycopg
import pytest

from sentinela_worker.detector.state import SensorState, StateChange
from sentinela_worker.pg import (
    Buoy, FanOutStatus, MaintenanceWindow, PgHealthStore, PgJobStatus,
    load_maintenance, load_registry,
)

DSN = os.environ.get("TEST_PG_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="TEST_PG_DSN not set")

MIGRATION = (pathlib.Path(__file__).resolve().parents[2]
             / "supabase" / "migrations" / "20261117_sensor_health.sql")
T0 = datetime(2026, 11, 17, 12, tzinfo=timezone.utc)
USER = "00000000-0000-0000-0000-0000000000aa"


@pytest.fixture
def conn():
    c = psycopg.connect(DSN, autocommit=False)
    try:
        c.execute(MIGRATION.read_text())
        c.execute("SET LOCAL session_replication_role = replica")  # fixtures skip FKs/triggers
        yield c
    finally:
        c.rollback()
        c.close()


def as_role(conn, role, uid=None):
    # PG15: the role creator is not automatically a member; grant inside the rolled-back tx.
    # (GRANT ... TO CURRENT_USER crashes this Supabase backend; use the explicit name.)
    me = conn.execute("SELECT current_user").fetchone()[0]
    conn.execute(f'GRANT {role} TO "{me}"')
    conn.execute(f"SET LOCAL ROLE {role}")
    if uid:
        conn.execute("SELECT set_config('request.jwt.claims', %s, true)",
                     (json.dumps({"sub": uid, "role": "authenticated"}),))


def reset_role(conn):
    conn.execute("RESET ROLE")


def change(device="dev1", sensor="ph", estado="falha", open_event=True, close_event=False):
    return StateChange(device, sensor, "SM-01", "campo",
                       SensorState(estado, "motivo", T0), open_event, close_event)


def set_registry(conn, value):
    conn.execute("DELETE FROM public.app_settings WHERE key='map_buoys'")
    if value is not None:
        conn.execute("INSERT INTO public.app_settings(key, value) VALUES ('map_buoys', %s::jsonb)",
                     (json.dumps(value),))


def test_migration_is_idempotent(conn):
    conn.execute(MIGRATION.read_text())


def test_worker_role_can_write_health_tables(conn):
    as_role(conn, "sentinela_worker")
    conn.execute("INSERT INTO public.sensor_health(device_id,sensor,modo,estado,motivo,desde,atualizado_em)"
                 " VALUES ('d','ph','campo','ok','x',now(),now())")
    conn.execute("UPDATE public.sensor_health SET estado='falha' WHERE device_id='d'")
    conn.execute("INSERT INTO public.sensor_health_events(device_id,sensor,estado,inicio)"
                 " VALUES ('d','ph','falha',now())")
    conn.execute("INSERT INTO public.worker_jobs(job,ok) VALUES ('j', true)")
    assert conn.execute("SELECT count(*) FROM public.sensor_health").fetchone()[0] == 1
    conn.execute("DELETE FROM public.sensor_health")
    conn.execute("DELETE FROM public.worker_jobs")


def test_worker_role_cannot_write_app_settings(conn):
    as_role(conn, "sentinela_worker")
    conn.execute("SELECT * FROM public.app_settings").fetchall()
    conn.execute("SELECT * FROM public.maintenance_logs").fetchall()
    for sql in ("INSERT INTO public.app_settings(key,value) VALUES ('zz_t','{}')",
                "UPDATE public.app_settings SET value='{}'",
                "DELETE FROM public.app_settings",
                "DELETE FROM public.maintenance_logs"):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("SAVEPOINT s")
            try:
                conn.execute(sql)
            finally:
                conn.execute("ROLLBACK TO s")


def test_worker_role_has_no_bypassrls_and_owns_nothing(conn):
    assert conn.execute("SELECT rolbypassrls, rolcanlogin, rolsuper FROM pg_roles"
                        " WHERE rolname='sentinela_worker'").fetchone() == (False, False, False)
    owners = conn.execute("SELECT count(*) FROM pg_tables WHERE schemaname='public' AND"
                          " tableowner='sentinela_worker'").fetchone()[0]
    assert owners == 0


def test_authenticated_client_can_read_but_not_write_sensor_health(conn):
    conn.execute("INSERT INTO public.sensor_health(device_id,sensor,modo,estado,motivo,desde,atualizado_em)"
                 " VALUES ('d','ph','campo','ok','x',now(),now())")
    conn.execute("INSERT INTO public.profiles(id, name, username, role) VALUES (%s,'t','t_probe','visualizador')"
                 " ON CONFLICT (id) DO NOTHING", (USER,))
    as_role(conn, "authenticated", USER)
    for t in ("sensor_health", "sensor_health_events", "worker_jobs"):
        conn.execute(f"SELECT * FROM public.{t}").fetchall()
    assert conn.execute("SELECT count(*) FROM public.sensor_health").fetchone()[0] >= 1
    for sql in ("INSERT INTO public.sensor_health(device_id,sensor,modo,estado,desde,atualizado_em)"
                " VALUES ('e','ph','campo','ok',now(),now())",
                "UPDATE public.sensor_health SET estado='falha'",
                "DELETE FROM public.sensor_health",
                "INSERT INTO public.worker_jobs(job) VALUES ('x')"):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("SAVEPOINT s")
            try:
                conn.execute(sql)
            finally:
                conn.execute("ROLLBACK TO s")


def test_user_without_profile_reads_nothing(conn):
    conn.execute("INSERT INTO public.sensor_health(device_id,sensor,modo,estado,motivo,desde,atualizado_em)"
                 " VALUES ('d','ph','campo','ok','x',now(),now())")
    as_role(conn, "authenticated", "00000000-0000-0000-0000-0000000000bb")
    assert conn.execute("SELECT count(*) FROM public.sensor_health").fetchone()[0] == 0


def test_anon_has_no_access(conn):
    as_role(conn, "anon")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        conn.execute("SELECT * FROM public.sensor_health")


def test_only_one_open_event_per_device_sensor(conn):
    sql = ("INSERT INTO public.sensor_health_events(device_id,sensor,estado,inicio)"
           " VALUES ('d','ph','falha',now())")
    conn.execute(sql)
    with pytest.raises(psycopg.errors.UniqueViolation):
        conn.execute("SAVEPOINT s")
        try:
            conn.execute(sql)
        finally:
            conn.execute("ROLLBACK TO s")
    conn.execute("UPDATE public.sensor_health_events SET fim=now()")
    conn.execute(sql)  # closed one does not block a new open one


def test_registry_without_modo_defaults_to_bancada(conn):
    set_registry(conn, [
        {"codigo": "SM-01", "deviceId": "dev1"},
        {"codigo": "SM-02", "deviceId": "dev2", "modo": "campo", "modoDesde": "2026-11-01T10:00:00Z"},
        {"codigo": "SM-03", "deviceId": "dev3", "modo": "lixo", "modoDesde": "nope"},
        {"codigo": "SM-04"},
        "not-a-dict", {"deviceId": "x"},
    ])
    by = {b.codigo: b for b in load_registry(conn)}
    assert set(by) == {"SM-01", "SM-02", "SM-03", "SM-04"}
    assert by["SM-01"] == Buoy("SM-01", "dev1", "bancada", None)
    assert by["SM-02"].modo == "campo"
    assert by["SM-02"].modo_desde == datetime(2026, 11, 1, 10, tzinfo=timezone.utc)
    assert by["SM-03"].modo == "bancada" and by["SM-03"].modo_desde is None
    assert by["SM-04"].device_id is None


def test_registry_missing_or_invalid_value(conn):
    set_registry(conn, None)
    assert load_registry(conn) == []
    set_registry(conn, {"a": 1})
    assert load_registry(conn) == []


def test_load_maintenance(conn):
    conn.execute("DELETE FROM public.maintenance_logs WHERE boia_id LIKE 'ZZ-%'")
    conn.execute("INSERT INTO public.maintenance_logs(boia_id,operador_nome,motivo,timestamp_inicio,timestamp_fim)"
                 " VALUES ('ZZ-1','t','m',%s,%s),('ZZ-2','t','m',%s,NULL),('ZZ-3','t','m',%s,%s)",
                 (T0, T0 + timedelta(hours=1), T0 - timedelta(hours=2),
                  T0 - timedelta(days=30), T0 - timedelta(days=29)))
    got = {w.boia_id: w for w in load_maintenance(conn, T0 - timedelta(days=1)) if w.boia_id.startswith("ZZ-")}
    assert set(got) == {"ZZ-1", "ZZ-2"}
    assert got["ZZ-2"].fim is None
    assert isinstance(got["ZZ-1"], MaintenanceWindow)


def test_apply_upserts_opens_closes_and_prunes(conn):
    store = PgHealthStore(conn)
    store.apply([change(), change(sensor="turb", estado="ok", open_event=False)], [])
    assert set(store.load_states()) == {("dev1", "ph"), ("dev1", "turb")}
    assert store.load_states()[("dev1", "ph")] == SensorState("falha", "motivo", T0)
    assert conn.execute("SELECT count(*) FROM public.sensor_health_events WHERE fim IS NULL").fetchone()[0] == 1
    store.apply([change(estado="ok", open_event=False, close_event=True)], [("dev1", "turb")])
    assert set(store.load_states()) == {("dev1", "ph")}
    assert conn.execute("SELECT count(*) FROM public.sensor_health_events WHERE fim IS NULL").fetchone()[0] == 0
    # reopening twice must not violate the unique open-event index
    store.apply([change(), change()], [])
    assert conn.execute("SELECT count(*) FROM public.sensor_health_events WHERE fim IS NULL").fetchone()[0] == 1


def test_apply_is_atomic(conn):
    store = PgHealthStore(conn)
    store.apply([change(sensor="ph", estado="ok", open_event=False)], [])
    bad = change(sensor="turb", estado="ok", open_event=False)
    bad2 = StateChange("dev1", "cond", "SM-01", "campo",
                       SensorState("estado_invalido", "m", T0), False, False)  # violates CHECK
    with pytest.raises(psycopg.Error):
        store.apply([change(sensor="ph", estado="falha"), bad, bad2], [])
    states = store.load_states()
    assert set(states) == {("dev1", "ph")}
    assert states[("dev1", "ph")].estado == "ok"
    assert conn.execute("SELECT count(*) FROM public.sensor_health_events").fetchone()[0] == 0


def test_job_status_upsert_and_fanout(conn):
    calls = []

    class Other:
        def record(self, *a):
            calls.append(a)

    sink = FanOutStatus(PgJobStatus(conn), Other())
    sink.record("ana", True, T0, 1.5, None)
    sink.record("ana", False, T0 + timedelta(minutes=1), 0.5, "boom")
    row = conn.execute("SELECT ok, ultima_execucao, ultimo_sucesso, duracao_s, erro"
                       " FROM public.worker_jobs WHERE job='ana'").fetchone()
    assert row == (False, T0 + timedelta(minutes=1), T0, 0.5, "boom")
    assert len(calls) == 2


def test_fanout_isolates_failing_sink():
    class Bad:
        def record(self, *a):
            raise RuntimeError("x")

    seen = []

    class Good:
        def record(self, *a):
            seen.append(a)

    FanOutStatus(Bad(), Good()).record("j", True, T0, 1.0, None)
    assert len(seen) == 1
