"""PgConnection: lazy, long-lived, recreated when broken or reset (no database needed)."""
from sentinela_worker.pg import PgConnection


class _Conn:
    def __init__(self):
        self.closed = False
        self.broken = False

    def close(self):
        self.closed = True

    def execute(self, *a, **k):
        return ("executed", self)

    def transaction(self):
        return ("tx", self)


def test_pg_connection_is_lazy_long_lived_and_recreated():
    made = []

    def connect(dsn, **kw):
        made.append(kw)
        return _Conn()

    pg = PgConnection("postgresql://x", connect=connect)
    assert made == []                                    # lazy: nothing until first use
    _, c1 = pg.execute("SELECT 1")
    assert pg.transaction()[1] is c1 and len(made) == 1  # long-lived
    assert made[0]["autocommit"] is False and made[0]["connect_timeout"] > 0
    c1.broken = True                                     # lost connection -> new one
    assert pg.execute("SELECT 1")[1] is not c1 and len(made) == 2
    c2 = pg.execute("SELECT 1")[1]
    pg.reset()                                           # explicit reset (OperationalError)
    assert c2.closed and pg.execute("SELECT 1")[1] is not c2 and len(made) == 3
    pg.close()
    assert made and pg.execute("SELECT 1")[1] is not None and len(made) == 4
