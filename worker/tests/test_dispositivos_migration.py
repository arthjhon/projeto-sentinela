"""dispositivos registry + serial allocation. Skipped unless TEST_PG_DSN is set.

Every test runs in one transaction that is rolled back; nothing here commits.
"""
import json
import os
import pathlib

import psycopg
import pytest

DSN = os.environ.get("TEST_PG_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="TEST_PG_DSN not set")

MIGRATIONS = pathlib.Path(__file__).resolve().parents[2] / "supabase" / "migrations"
MIGRATION = MIGRATIONS / "20261120_dispositivos.sql"
BASE = [MIGRATIONS / "20261117_sensor_health.sql"]  # creates profiles dependencies used by RLS
ADMIN = "00000000-0000-0000-0000-0000000000a1"
OPER = "00000000-0000-0000-0000-0000000000a2"
MAC1, MAC2, MAC3 = "aa:bb:cc:dd:ee:01", "aa:bb:cc:dd:ee:02", "aa:bb:cc:dd:ee:03"


@pytest.fixture
def conn():
    c = psycopg.connect(DSN, autocommit=False)
    try:
        for m in BASE:
            c.execute(m.read_text())
        c.execute(MIGRATION.read_text())
        yield c
    finally:
        c.rollback()
        c.close()


def reserve(conn, mac, hw="esp32s3"):
    return conn.execute("SELECT serial, situacao FROM public.dispositivo_reservar(%s, %s)",
                        (mac, hw)).fetchone()


def expect_error(conn, exc, sql, params=()):
    conn.execute("SAVEPOINT s")
    try:
        with pytest.raises(exc):
            conn.execute(sql, params)
    finally:
        conn.execute("ROLLBACK TO s")


def as_role(conn, role, uid=None):
    me = conn.execute("SELECT current_user").fetchone()[0]
    conn.execute(f'GRANT {role} TO "{me}"')
    conn.execute(f"SET LOCAL ROLE {role}")
    if uid:
        conn.execute("SELECT set_config('request.jwt.claims', %s, true)",
                     (json.dumps({"sub": uid, "role": "authenticated"}),))


def test_reserve_first_serial_is_0001(conn):
    assert reserve(conn, MAC1) == ("snt-0001", "reservado")


def test_reserve_sequential(conn):
    assert reserve(conn, MAC1)[0] == "snt-0001"
    assert reserve(conn, MAC2)[0] == "snt-0002"
    assert reserve(conn, MAC3)[0] == "snt-0003"


def test_reserve_same_mac_returns_same_serial(conn):
    first = reserve(conn, MAC1)
    conn.execute("SELECT public.dispositivo_marcar(%s, 'provisionado')", (first[0],))
    assert reserve(conn, MAC1) == (first[0], "provisionado")
    assert conn.execute("SELECT count(*) FROM public.dispositivos").fetchone()[0] == 1


def test_reserve_after_baixado_never_reuses(conn):
    reserve(conn, MAC1)
    s2 = reserve(conn, MAC2)[0]
    assert s2 == "snt-0002"
    conn.execute("SELECT public.dispositivo_marcar(%s, 'baixado')", (s2,))
    assert reserve(conn, MAC3)[0] == "snt-0003"


def test_reserve_baixado_mac_raises(conn):
    s = reserve(conn, MAC1)[0]
    conn.execute("SELECT public.dispositivo_marcar(%s, 'baixado')", (s,))
    conn.execute("SAVEPOINT s")
    with pytest.raises(psycopg.errors.RaiseException, match="dispositivo_baixado"):
        conn.execute("SELECT * FROM public.dispositivo_reservar(%s, 'esp32s3')", (MAC1,))
    conn.execute("ROLLBACK TO s")


def test_marcar_provisionado_sets_timestamp(conn):
    s = reserve(conn, MAC1)[0]
    assert conn.execute("SELECT provisionado_em FROM public.dispositivos WHERE serial=%s",
                        (s,)).fetchone()[0] is None
    conn.execute("SELECT public.dispositivo_marcar(%s, 'provisionado')", (s,))
    assert conn.execute("SELECT situacao, provisionado_em IS NOT NULL FROM public.dispositivos"
                        " WHERE serial=%s", (s,)).fetchone() == ("provisionado", True)
    expect_error(conn, psycopg.errors.RaiseException,
                 "SELECT public.dispositivo_marcar('snt-9999', 'baixado')")


def test_liberar_only_reservado(conn):
    s1 = reserve(conn, MAC1)[0]
    s2 = reserve(conn, MAC2)[0]
    conn.execute("SELECT public.dispositivo_marcar(%s, 'provisionado')", (s2,))
    conn.execute("SELECT public.dispositivo_liberar_reserva(%s)", (s1,))
    conn.execute("SELECT public.dispositivo_liberar_reserva(%s)", (s2,))
    assert [r[0] for r in conn.execute("SELECT serial FROM public.dispositivos").fetchall()] == [s2]


def test_bad_mac_rejected(conn):
    for bad in ("AA:BB:CC:DD:EE:01", "aa-bb-cc-dd-ee-01", "aa:bb:cc:dd:ee"):
        expect_error(conn, psycopg.errors.CheckViolation,
                     "SELECT * FROM public.dispositivo_reservar(%s, 'esp32s3')", (bad,))


def test_rls_admin_reads_operador_does_not(conn):
    reserve(conn, MAC1)
    conn.execute("SET LOCAL session_replication_role = replica")
    conn.execute("INSERT INTO public.profiles(id, name, username, role) VALUES"
                 " (%s,'a','a_probe','admin'), (%s,'o','o_probe','operador')"
                 " ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role", (ADMIN, OPER))
    conn.execute("SET LOCAL session_replication_role = origin")
    as_role(conn, "authenticated", ADMIN)
    assert conn.execute("SELECT count(*) FROM public.dispositivos").fetchone()[0] == 1
    conn.execute("RESET ROLE")
    as_role(conn, "authenticated", OPER)
    assert conn.execute("SELECT count(*) FROM public.dispositivos").fetchone()[0] == 0
    expect_error(conn, psycopg.errors.InsufficientPrivilege,
                 "DELETE FROM public.dispositivos")


def test_authenticated_cannot_execute_functions(conn):
    as_role(conn, "authenticated", ADMIN)
    for sql in ("SELECT * FROM public.dispositivo_reservar('aa:bb:cc:dd:ee:09','x')",
                "SELECT public.dispositivo_marcar('snt-0001','baixado')",
                "SELECT public.dispositivo_liberar_reserva('snt-0001')"):
        expect_error(conn, psycopg.errors.InsufficientPrivilege, sql)
    conn.execute("RESET ROLE")
    as_role(conn, "anon")
    expect_error(conn, psycopg.errors.InsufficientPrivilege,
                 "SELECT * FROM public.dispositivo_reservar('aa:bb:cc:dd:ee:09','x')")


def test_migration_idempotent(conn):
    reserve(conn, MAC1)
    conn.execute(MIGRATION.read_text())
    conn.execute(MIGRATION.read_text())
    assert conn.execute("SELECT count(*) FROM public.dispositivos").fetchone()[0] == 1
    assert reserve(conn, MAC2)[0] == "snt-0002"
