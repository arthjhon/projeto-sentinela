"""Tests for infra/bin/provision-board.py (fakes only; no serial port, no ssh)."""
import importlib.util
import logging
import pathlib
import subprocess

import pytest

SRC = pathlib.Path(__file__).resolve().parent.parent / "bin" / "provision-board.py"
spec = importlib.util.spec_from_file_location("provision_board", SRC)
pb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pb)

PASSWORD = "Zx9Qw3Er7Ty1Ui5Op2As6Df4Gh8Jk0Lq3Wm5Nb7V"
MAC = "aa:bb:cc:dd:ee:01"


class FakeBoard:
    def __init__(self, calls, state="unprovisioned", serial="none", reboot_serial=None, prov_error=None,
                 reboot_fails=False, reboot_state="provisioned", unprov_error=None, reboot_mac=MAC):
        self.unprov_error, self.reboot_mac = unprov_error, reboot_mac
        self.calls, self.state, self.serial = calls, state, serial
        self.reboot_serial, self.prov_error = reboot_serial, prov_error
        self.reboot_fails, self.reboot_state = reboot_fails, reboot_state
        self.received = None

    def unprov(self):
        self.calls.append("unprov")
        if self.unprov_error:
            raise pb.BoardError(self.unprov_error)

    def ident(self):
        self.calls.append("ident")
        return {"serial": self.serial, "mac": MAC, "fw": "5.1.0", "state": self.state}

    def prov(self, serial, password):
        self.calls.append(f"prov:{serial}")
        self.received = password
        if self.prov_error == "OSERROR":
            raise OSError("port vanished")
        if self.prov_error == "INTERRUPT":
            raise KeyboardInterrupt
        if self.prov_error == "UNSURE":
            raise pb.BoardUnsure("no verdict")
        if self.prov_error:
            raise pb.BoardError(self.prov_error)

    def wait_reboot_ident(self, timeout_s):
        self.calls.append("reboot_ident")
        if self.reboot_fails:
            raise pb.BoardError("board did not come back")
        return {"serial": self.reboot_serial or "none", "mac": self.reboot_mac, "fw": "5.1.0",
                "state": self.reboot_state}


class FakeRemote:
    def __init__(self, calls, reserve=("snt-0001", "reservado", False), marcar_fails=False,
                 row=None, users=None):
        self.calls, self.reserve, self.marcar_fails = calls, reserve, marcar_fails
        self.row, self.users = row, set(users or [])
        self.scripts = []

    def mqtt_list(self):
        self.calls.append("mqtt_list")
        return set(self.users)

    def sql(self, script):
        self.scripts.append(script)
        if "WHERE mac" in script and "dispositivo_" not in script:
            self.calls.append("lookup")
            return f"{self.row[0]}|{self.row[1]}\n" if self.row else ""
        if "dispositivo_reservar" in script:
            self.calls.append("reservar")
            s, sit, existed = self.reserve
            return f"{s}|{sit}|{'t' if existed else 'f'}\n"
        if "dispositivo_marcar" in script:
            self.calls.append("marcar:" + ("baixado" if "'baixado'" in script else "provisionado"))
            if self.marcar_fails:
                raise pb.RemoteError("sql failed")
            return ""
        if "dispositivo_liberar_reserva" in script:
            self.calls.append("liberar")
            return ""
        raise AssertionError(script)

    def mqtt_add(self, user):
        self.calls.append(f"mqtt_add:{user}")
        return PASSWORD

    def mqtt_del(self, user):
        self.calls.append(f"mqtt_del:{user}")
        self.users.discard(user)


def run(board, remote, argv=("provision", "--port", "COM5")):
    return pb.main(list(argv), board=board, remote=remote)


def test_provision_happy_path(capsys, caplog):
    caplog.set_level(logging.DEBUG)
    calls = []
    board = FakeBoard(calls, reboot_serial="snt-0001")
    remote = FakeRemote(calls)
    assert run(board, remote) == 0
    assert calls == ["ident", "reservar", "mqtt_add:snt-0001", "prov:snt-0001",
                     "reboot_ident", "marcar:provisionado"]
    out = capsys.readouterr()
    assert "snt-0001" in out.out
    assert PASSWORD not in out.out + out.err + caplog.text
    assert board.received == PASSWORD
    assert all(PASSWORD not in s for s in remote.scripts)


def test_already_provisioned_stops(capsys):
    calls = []
    board = FakeBoard(calls, state="provisioned", serial="snt-0007")
    remote = FakeRemote(calls, row=("snt-0007", "provisionado"), users={"snt-0007"})
    assert run(board, remote) == 0
    assert calls == ["ident", "lookup", "mqtt_list"]
    assert "nothing to do" in capsys.readouterr().out


def test_already_provisioned_reconciles_reserved_row(capsys):
    calls = []
    board = FakeBoard(calls, state="provisioned", serial="snt-0007")
    remote = FakeRemote(calls, row=("snt-0007", "reservado"), users={"snt-0007"})
    assert run(board, remote) == 0
    assert "marcar:provisionado" in calls
    assert "SERIAL: snt-0007" in capsys.readouterr().out


@pytest.mark.parametrize("row,users", [
    (None, {"snt-0007"}),                       # no row
    (("snt-0002", "provisionado"), {"snt-0007"}),  # serial differs
    (("snt-0007", "provisionado"), set()),      # broker user gone
    (("snt-0007", "baixado"), {"snt-0007"}),
])
def test_already_provisioned_inconsistent_fails(row, users, capsys):
    calls = []
    board = FakeBoard(calls, state="provisioned", serial="snt-0007")
    assert run(board, FakeRemote(calls, row=row, users=users)) == 1
    assert not any(c.startswith("marcar") for c in calls)
    assert capsys.readouterr().err


def test_reprovision_reuses_serial(capsys):
    calls = []
    board = FakeBoard(calls, reboot_serial="snt-0003")
    remote = FakeRemote(calls, reserve=("snt-0003", "provisionado", True))
    assert run(board, remote) == 0
    assert "mqtt_add:snt-0003" in calls and "prov:snt-0003" in calls
    assert "liberar" not in calls
    assert "snt-0003" in capsys.readouterr().out


def test_rollback_on_board_failure(capsys):
    calls = []
    board = FakeBoard(calls, prov_error="ERR bad_password")
    assert run(board, FakeRemote(calls)) == 1
    assert "mqtt_del:snt-0001" in calls and "liberar" in calls
    assert not any(c.startswith("marcar") for c in calls)
    out = capsys.readouterr()
    assert PASSWORD not in out.out + out.err


def test_rollback_keeps_reused_row():
    calls = []
    board = FakeBoard(calls, prov_error="ERR bad_password")
    remote = FakeRemote(calls, reserve=("snt-0003", "provisionado", True))
    assert run(board, remote) == 1
    assert "mqtt_del:snt-0003" in calls
    assert "liberar" not in calls


def test_ident_mismatch_after_ok_keeps_everything(capsys):
    calls = []
    board = FakeBoard(calls, reboot_serial="snt-0099")
    assert run(board, FakeRemote(calls)) == 1
    assert "mqtt_del:snt-0001" not in calls and "liberar" not in calls
    assert not any(c.startswith("marcar") for c in calls)
    assert PASSWORD not in "".join(capsys.readouterr())


def test_reboot_timeout_after_ok_does_not_undo(capsys):
    calls = []
    board = FakeBoard(calls, reboot_fails=True)
    remote = FakeRemote(calls)
    assert run(board, remote) == 1
    assert "mqtt_del:snt-0001" not in calls and "liberar" not in calls
    assert "KEPT" in capsys.readouterr().err


def test_keyboard_interrupt_after_ok_does_not_undo():
    calls = []
    board = FakeBoard(calls)

    def boom(t):
        raise KeyboardInterrupt
    board.wait_reboot_ident = boom
    assert run(board, FakeRemote(calls)) == 1
    assert "mqtt_del:snt-0001" not in calls and "liberar" not in calls


def test_no_verdict_board_unprovisioned_undoes():
    calls = []
    board = FakeBoard(calls, prov_error="UNSURE", reboot_state="unprovisioned")
    assert run(board, FakeRemote(calls)) == 1
    assert "mqtt_del:snt-0001" in calls and "liberar" in calls


def test_no_verdict_board_provisioned_keeps():
    calls = []
    board = FakeBoard(calls, prov_error="UNSURE", reboot_serial="snt-0001")
    assert run(board, FakeRemote(calls)) == 1
    assert "mqtt_del:snt-0001" not in calls and "liberar" not in calls


def test_no_verdict_and_unreachable_keeps():
    calls = []
    board = FakeBoard(calls, prov_error="UNSURE", reboot_fails=True)
    assert run(board, FakeRemote(calls)) == 1
    assert "mqtt_del:snt-0001" not in calls and "liberar" not in calls


def test_mqtt_add_failure_still_releases_new_row_and_skips_nothing_else():
    calls = []
    remote = FakeRemote(calls)

    def bad(user):
        calls.append("mqtt_add")
        raise pb.RemoteError("ssh down")
    remote.mqtt_add = bad
    assert run(FakeBoard(calls), remote) == 1
    assert "liberar" in calls


def test_undo_skips_mqtt_del_if_add_never_attempted():
    calls = []
    pb._undo(FakeRemote(calls), "snt-0001", True, False)
    assert calls == ["liberar"]


def test_unprov(capsys):
    calls = []
    board = FakeBoard(calls, reboot_state="unprovisioned")
    assert run(board, FakeRemote(calls), ("unprov", "--port", "COM5")) == 0
    assert calls == ["unprov", "reboot_ident"]
    assert "unprovisioned" in capsys.readouterr().out


def test_unprov_fails_if_still_provisioned():
    calls = []
    board = FakeBoard(calls, reboot_serial="snt-0001")
    assert run(board, FakeRemote(calls), ("unprov", "--port", "COM5")) == 1


def test_host_leading_dash_rejected():
    with pytest.raises(SystemExit) as e:  # argparse itself refuses a dash-leading value
        pb.main(["provision", "--port", "COM5", "--host", "-oProxyCommand=x"], board=None, remote=None)
    assert e.value.code == 2
    assert pb.main(["provision", "--port", "COM5", "--host=-oProxyCommand=x"], board=None, remote=None) == 2
    with pytest.raises(ValueError):
        pb.SshRemote("-oProxyCommand=x")


def test_marcar_failure_after_confirmed_board_keeps_credential(capsys):
    calls = []
    board = FakeBoard(calls, reboot_serial="snt-0001")
    assert run(board, FakeRemote(calls, marcar_fails=True)) == 1
    assert "mqtt_del:snt-0001" not in calls and "liberar" not in calls
    assert "KEPT" in capsys.readouterr().err


def test_retire():
    calls = []
    assert run(None, FakeRemote(calls, users={"snt-0004"}), ("retire", "snt-0004")) == 0
    assert calls == ["mqtt_list", "mqtt_del:snt-0004", "marcar:baixado"]


def test_retire_idempotent_when_user_already_gone():
    calls = []
    assert run(None, FakeRemote(calls), ("retire", "snt-0004")) == 0
    assert calls == ["mqtt_list", "marcar:baixado"]


def test_retire_rejects_bad_serial():
    calls = []
    with pytest.raises(SystemExit) as e:
        run(None, FakeRemote(calls), ("retire", "SNT-0004"))
    assert e.value.code == 2
    assert calls == []


def test_serial_from_reserve_validated():
    calls = []
    board = FakeBoard(calls, reboot_serial="SNT-1")
    remote = FakeRemote(calls, reserve=("SNT-1", "reservado", False))
    assert run(board, remote) == 1
    assert not any(c.startswith("mqtt_add") for c in calls)


def test_usage_error_exit_2():
    with pytest.raises(SystemExit) as e:
        pb.main(["provision"], board=None, remote=None)
    assert e.value.code == 2


def test_ident_cmd(capsys):
    calls = []
    assert run(FakeBoard(calls), FakeRemote(calls), ("ident", "--port", "COM5")) == 0
    assert "mac=" + MAC in capsys.readouterr().out


def test_bad_mac_from_board_aborts():
    calls = []
    board = FakeBoard(calls)
    board.ident = lambda: {"serial": "none", "mac": "AA-BB", "fw": "5", "state": "unprovisioned"}
    assert run(board, FakeRemote(calls)) == 1
    assert "reservar" not in calls


def test_bad_hardware_rejected():
    assert pb.main(["provision", "--port", "COM5", "--hardware", "x; drop"],
                   board=None, remote=None) == 2


# ---- real Remote: argv and stdin only ---------------------------------------
class Recorder:
    def __init__(self, stdout=""):
        self.calls, self.stdout = [], stdout

    def __call__(self, argv, **kw):
        self.calls.append((argv, kw))
        return subprocess.CompletedProcess(argv, 0, stdout=self.stdout, stderr="")


def test_password_not_in_argv():
    rec = Recorder(stdout=PASSWORD + "\n")
    remote = pb.SshRemote("umj-sentinela", runner=rec)
    assert remote.mqtt_add("snt-0001") == PASSWORD
    remote.sql("SELECT 1;")
    remote.mqtt_del("snt-0001")
    rec.stdout = "svc/telegraf\nsnt-0001\n"
    assert remote.mqtt_list() == {"svc/telegraf", "snt-0001"}
    for argv, kw in rec.calls:
        assert argv[0] == "ssh" and "umj-sentinela" in argv
        assert argv[argv.index("umj-sentinela") - 1] == "--"
        assert PASSWORD not in " ".join(argv)
        assert PASSWORD not in repr(kw.get("input"))
        assert kw.get("shell") is not True
    cmds = [a[-1] for a, _ in rec.calls]
    assert cmds[0] == "sudo -n /usr/local/sbin/mqtt-user.sh add snt-0001"
    assert "psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At" in cmds[1]
    assert rec.calls[1][1]["input"] == "SELECT 1;"
    assert cmds[2] == "sudo -n /usr/local/sbin/mqtt-user.sh del snt-0001"
    assert cmds[3] == "sudo -n /usr/local/sbin/mqtt-user.sh list"


def test_remote_rejects_bad_user_and_bad_password_output(capsys):
    remote = pb.SshRemote("h", runner=Recorder(stdout="has space and secret\n"))
    with pytest.raises(ValueError):
        remote.mqtt_add("snt-1; rm -rf /")
    with pytest.raises(pb.RemoteError) as e:
        remote.mqtt_add("snt-0001")
    assert "secret" not in str(e.value)


def test_remote_failure_message_has_no_stdout():
    def runner(argv, **kw):
        return subprocess.CompletedProcess(argv, 3, stdout=PASSWORD, stderr="boom")
    with pytest.raises(pb.RemoteError) as e:
        pb.SshRemote("h", runner=runner).mqtt_add("snt-0001")
    assert PASSWORD not in str(e.value)


def test_reserve_sql_quotes_only_validated_values():
    r = pb.build_reserve_sql(MAC, "heltec_wifi_lora_32_v3")
    assert MAC in r and "\\gset" in r
    with pytest.raises(ValueError):
        pb.build_reserve_sql("aa:bb", "x")
    with pytest.raises(ValueError):
        pb.build_reserve_sql(MAC, "x';--")


# ---- real board: protocol over a fake line device ---------------------------
class FakePort:
    def __init__(self, script):
        self.script, self.written, self.rx = script, [], []
        self.closed = False

    def write(self, data):
        self.written.append(data)
        line = data.decode().strip()
        self.rx.extend(self.script(line))

    def readline(self):
        return (self.rx.pop(0) + "\r\n").encode() if self.rx else b""

    def reset_input_buffer(self):
        self.rx.clear()

    def close(self):
        self.closed = True


def test_serial_board_ident_and_prov():
    def script(line):
        if line == "IDENT?":
            return ["boot noise", f"IDENT serial=none mac={MAC} fw=5.1.0 state=unprovisioned"]
        if line == "PROV snt-0001":
            return ["PASS?"]
        if line == PASSWORD:
            return ["OK snt-0001"]
        return ["ERR bad_command"]
    port = FakePort(script)
    b = pb.SerialBoard("COM5", opener=lambda p: port)
    info = b.ident()
    assert info == {"serial": "none", "mac": MAC, "fw": "5.1.0", "state": "unprovisioned"}
    b.prov("snt-0001", PASSWORD)
    assert (PASSWORD + "\n").encode() in port.written


def test_serial_board_prov_error_hides_password():
    def script(line):
        return ["PASS?"] if line.startswith("PROV") else ["ERR bad_password"]
    b = pb.SerialBoard("COM5", opener=lambda p: FakePort(script))
    with pytest.raises(pb.BoardError) as e:
        b.prov("snt-0001", PASSWORD)
    assert PASSWORD not in str(e.value) and "bad_password" in str(e.value)


def test_serial_board_reconnects_after_reboot():
    attempts = []

    def opener(p):
        attempts.append(p)
        if len(attempts) < 3:
            raise OSError("port gone")
        return FakePort(lambda l: [f"IDENT serial=snt-0001 mac={MAC} fw=5.1.0 state=provisioned"])
    b = pb.SerialBoard("COM5", opener=opener, sleep=lambda s: None)
    info = b.wait_reboot_ident(20)
    assert info["serial"] == "snt-0001" and len(attempts) == 3


def test_default_opener_sets_dtr_rts_low(monkeypatch):
    serial = pytest.importorskip("serial")
    seen = {}

    class S:
        def __init__(self):
            self.port = None

        def open(self):
            seen["dtr"], seen["rts"], seen["port"] = self.dtr, self.rts, self.port
    monkeypatch.setattr(serial, "Serial", S)
    pb.open_serial("COM5")
    assert seen == {"dtr": False, "rts": False, "port": "COM5"}


def test_serial_board_ignores_logs_and_blank_lines():
    def script(line):
        if line == "IDENT?":
            return ["", "ERRO: MQTT connect failed", f"IDENT serial=none mac={MAC} fw=5.1.0 state=unprovisioned", ""]
        if line == "PROV snt-0001":
            return ["", "ERRO: MQTT rc=-2", "PASS?", ""]
        if line == PASSWORD:
            return ["", "ERRO: wifi", "OK snt-0001", ""]
        return ["ERR bad_command"]
    port = FakePort(script)
    b = pb.SerialBoard("COM5", opener=lambda p: port)
    assert b.ident()["state"] == "unprovisioned"
    b.prov("snt-0001", PASSWORD)


def test_serial_board_save_failed_is_unsure():
    def script(line):
        return ["PASS?"] if line.startswith("PROV") else ["", "ERR save_failed", ""]
    b = pb.SerialBoard("COM5", opener=lambda p: FakePort(script))
    with pytest.raises(pb.BoardUnsure):
        b.prov("snt-0001", PASSWORD)


def test_serial_board_unprov_ok_and_err():
    b = pb.SerialBoard("COM5", opener=lambda p: FakePort(lambda l: ["", "OK", ""]))
    b.unprov()
    b = pb.SerialBoard("COM5", opener=lambda p: FakePort(lambda l: ["ERR clear_failed"]))
    with pytest.raises(pb.BoardError):
        b.unprov()


class SilentPort(FakePort):
    """Answers the first N writes via script, then goes silent (readline -> b'')."""
    def __init__(self, script, answers):
        super().__init__(script)
        self.answers = answers

    def write(self, data):
        self.written.append(data)
        if self.answers > 0:
            self.answers -= 1
            self.rx.extend(self.script(data.decode().strip()))


def test_prov_silent_after_prov_is_plain_error():
    b = pb.SerialBoard("COM5", opener=lambda p: SilentPort(lambda l: [], 0))
    with pytest.raises(pb.BoardError) as e:
        b.prov("snt-0001", PASSWORD)
    assert not isinstance(e.value, pb.BoardUnsure)


def test_prov_silent_after_password_is_unsure():
    b = pb.SerialBoard("COM5", opener=lambda p: SilentPort(lambda l: ["PASS?"], 1))
    with pytest.raises(pb.BoardUnsure):
        b.prov("snt-0001", PASSWORD)


def test_unprov_silent_raises():
    b = pb.SerialBoard("COM5", opener=lambda p: SilentPort(lambda l: [], 0))
    with pytest.raises(pb.BoardError):
        b.unprov()


@pytest.mark.parametrize("exc", [OSError("gone"), KeyboardInterrupt()])
def test_exception_after_password_send_is_unsure(exc):
    class P(FakePort):
        def write(self, data):
            if data.decode().strip() == PASSWORD:
                raise exc
            super().write(data)
    b = pb.SerialBoard("COM5", opener=lambda p: P(lambda l: ["PASS?"]))
    with pytest.raises(pb.BoardUnsure):
        b.prov("snt-0001", PASSWORD)


@pytest.mark.parametrize("err", ["OSERROR", "INTERRUPT"])
def test_exception_in_prov_never_releases_when_board_unreachable(err):
    calls = []
    board = FakeBoard(calls, prov_error=err, reboot_fails=True)
    assert run(board, FakeRemote(calls)) == 1
    assert "liberar" not in calls and "mqtt_del:snt-0001" not in calls


def test_exception_in_prov_undoes_only_if_board_unprovisioned():
    calls = []
    board = FakeBoard(calls, prov_error="OSERROR", reboot_state="unprovisioned")
    assert run(board, FakeRemote(calls)) == 1
    assert "liberar" in calls and "mqtt_del:snt-0001" in calls


def test_mac_change_after_ok_keeps_everything(capsys):
    calls = []
    board = FakeBoard(calls, reboot_serial="snt-0001", reboot_mac="aa:bb:cc:dd:ee:99")
    assert run(board, FakeRemote(calls)) == 1
    assert "liberar" not in calls and "mqtt_del:snt-0001" not in calls
    assert "placa trocada" in capsys.readouterr().err


def test_mac_change_after_unsure_keeps_everything():
    calls = []
    board = FakeBoard(calls, prov_error="UNSURE", reboot_state="unprovisioned",
                      reboot_mac="aa:bb:cc:dd:ee:99")
    assert run(board, FakeRemote(calls)) == 1
    assert "liberar" not in calls and "mqtt_del:snt-0001" not in calls


def test_unprov_clear_failed_reports_actual_state(capsys):
    calls = []
    board = FakeBoard(calls, unprov_error="ERR clear_failed", reboot_state="unprovisioned")
    assert run(board, FakeRemote(calls), ("unprov", "--port", "COM5")) == 1
    assert calls == ["unprov", "reboot_ident"]
    assert "state=unprovisioned" in capsys.readouterr().out
