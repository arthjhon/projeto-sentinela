#!/usr/bin/env python3
"""Provision a Sentinela board with its permanent serial (snt-NNNN) and MQTT credential.

  provision-board.py provision --port COM5 [--hardware heltec_wifi_lora_32_v3] [--host umj-sentinela]
  provision-board.py retire snt-NNNN [--host umj-sentinela]
  provision-board.py ident --port COM5
  provision-board.py unprov --port COM5     (clear the board's identity; registry/broker untouched)

Runs on the workstation with the board on USB. Talks to the board over its serial console
(Task 2 protocol) and to the VM over `ssh <host>` (key auth, no prompts). On the VM it calls
/usr/local/sbin/mqtt-user.sh and the SQL functions dispositivo_* through
`sudo -n docker exec -i supabase-db psql` with the SQL on stdin.

The MQTT password comes from mqtt-user.sh stdout, lives in one local variable and is written
only to the board's serial port. It is never put in argv, printed, logged, stored in a file or
included in an exception message (messages are scrubbed too).

Serial port control lines: DTR and RTS are forced LOW (False) BEFORE the port is opened. On
the Heltec V3 (CP210x auto-reset circuit) and on native USB-CDC, asserting them can reset the
board or drop it into the bootloader. The deliberate reset happens only through the firmware
(PROV/UNPROV restart ~500 ms after OK); after it the port may vanish, so we reconnect to the
same port name with retries (up to 60 s) before asking IDENT? again. The control-line behaviour
on open was verified on Windows only (the supported path); on Linux it was not verified.

Exit: 0 ok; 1 failure: before the password could reach the board everything is undone; once it
may have reached the board (accepted, unsure, interrupted) credential and reservation are KEPT
and `provision` must be run again to reconcile; 2 usage / invalid argument.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
import time
from typing import Callable, Protocol

SERIAL_RE = re.compile(r"^snt-[0-9]{4}$")
MAC_RE = re.compile(r"^([0-9a-f]{2}:){5}[0-9a-f]{2}$")
HARDWARE_RE = re.compile(r"^[a-z0-9_]{1,40}$")
PASSWORD_RE = re.compile(r"^[A-Za-z0-9]{40}$")
HOST_RE = re.compile(r"^[A-Za-z0-9._@][A-Za-z0-9._@-]{0,99}$")  # no leading "-" (ssh option)
DEFAULT_HARDWARE = "heltec_wifi_lora_32_v3"
DEFAULT_HOST = "umj-sentinela"
MQTT_USER_SH = "/usr/local/sbin/mqtt-user.sh"
PSQL = "sudo -n docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At"
BAUD = 115200
LINE_TIMEOUT_S = 5
# setup() can block ~30 s on an unreachable Wi-Fi before the console is serviced again, so both
# the first IDENT and the post-restart wait allow well over that.
IDENT_TIMEOUT_S = 45.0
REBOOT_TIMEOUT_S = 60.0
EXPECT_TIMEOUT_S = 20.0


class BoardError(Exception):
    pass


class BoardUnsure(BoardError):
    """The password line was sent but the board's verdict (OK/ERR) never arrived."""

    def __init__(self, msg: str, interrupted: bool = False):
        super().__init__(msg)
        self.interrupted = interrupted  # Ctrl-C (not a timeout / I/O error)


class RemoteError(Exception):
    pass


class Board(Protocol):
    def ident(self) -> dict: ...
    def prov(self, serial: str, password: str) -> None: ...
    def wait_reboot_ident(self, timeout_s: float) -> dict: ...
    def unprov(self) -> None: ...


class Remote(Protocol):
    def sql(self, script: str) -> str: ...
    def mqtt_list(self) -> set: ...
    def mqtt_add(self, user: str) -> str: ...
    def mqtt_del(self, user: str) -> None: ...


# ------------------------------------------------------------------ SQL helpers
def _check(value: str, rx: re.Pattern, what: str) -> str:
    if not isinstance(value, str) or not rx.match(value):
        raise ValueError(f"invalid {what}")
    return value


def build_reserve_sql(mac: str, hardware: str) -> str:
    """Only validated values reach the SQL text (regexes contain no quote characters).

    `existed` is read in the same psql session BEFORE reserving, so the caller knows whether
    the row was created by this run (decides if undo may release the reservation).
    Output: <serial>|<situacao>|<t|f existed>.
    """
    mac = _check(mac, MAC_RE, "mac")
    hardware = _check(hardware, HARDWARE_RE, "hardware")
    return (
        f"SELECT EXISTS (SELECT 1 FROM public.dispositivos WHERE mac = '{mac}') AS existed \\gset\n"
        f"SELECT serial || '|' || situacao || '|' || :'existed' "
        f"FROM public.dispositivo_reservar('{mac}', '{hardware}');\n"
    )


def build_lookup_sql(mac: str) -> str:
    mac = _check(mac, MAC_RE, "mac")
    return f"SELECT serial || '|' || situacao FROM public.dispositivos WHERE mac = '{mac}';\n"


def build_marcar_sql(serial: str, situacao: str) -> str:
    serial = _check(serial, SERIAL_RE, "serial")
    if situacao not in ("provisionado", "baixado"):
        raise ValueError("invalid situacao")
    return f"SELECT public.dispositivo_marcar('{serial}', '{situacao}');\n"


def build_liberar_sql(serial: str) -> str:
    serial = _check(serial, SERIAL_RE, "serial")
    return f"SELECT public.dispositivo_liberar_reserva('{serial}');\n"


# ------------------------------------------------------------------ real remote
class SshRemote:
    def __init__(self, host: str, runner: Callable = subprocess.run):
        self.host = _check(host, HOST_RE, "host")
        self._run = runner

    def _ssh(self, command: str, stdin: str | None = None) -> str:
        argv = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", self.host, command]
        # Bytes in both directions (text=False): on Windows text mode would turn "\n" into "\r\n"
        # on the way to psql. No input -> /dev/null, so ssh never reads the operator's console.
        io = {"input": stdin.encode("utf-8")} if stdin is not None else {"stdin": subprocess.DEVNULL}
        try:
            res = self._run(argv, capture_output=True, text=False, timeout=60, check=False, **io)
        except subprocess.TimeoutExpired:
            raise RemoteError("ssh timed out") from None
        if res.returncode != 0:
            # stdout is never echoed (it may carry the password); stderr never does.
            detail = (res.stderr or b"").decode("utf-8", "replace").strip()[:300]
            raise RemoteError(f"remote command failed (exit {res.returncode}): {detail}")
        return (res.stdout or b"").decode("utf-8", "replace")

    def sql(self, script: str) -> str:
        return self._ssh(PSQL, stdin=script)

    def mqtt_add(self, user: str) -> str:
        _check(user, SERIAL_RE, "user")
        out = self._ssh(f"sudo -n {MQTT_USER_SH} add {user}").strip()
        if not PASSWORD_RE.match(out):
            raise RemoteError("mqtt-user.sh add returned an unexpected output")
        return out

    def mqtt_list(self) -> set:
        return {ln.strip() for ln in self._ssh(f"sudo -n {MQTT_USER_SH} list").splitlines() if ln.strip()}

    def mqtt_del(self, user: str) -> None:
        _check(user, SERIAL_RE, "user")
        self._ssh(f"sudo -n {MQTT_USER_SH} del {user}")


# ------------------------------------------------------------------ real board
def open_serial(port: str):
    import serial  # pyserial==3.5

    s = serial.Serial()
    s.dtr = False  # before open(): do not pulse reset/bootloader lines
    s.rts = False
    s.port = port
    s.baudrate = BAUD
    s.timeout = LINE_TIMEOUT_S
    s.write_timeout = LINE_TIMEOUT_S
    s.open()
    return s


def parse_ident(line: str) -> dict | None:
    if not line.startswith("IDENT "):
        return None
    kv = dict(p.split("=", 1) for p in line[6:].split() if "=" in p)
    if not {"serial", "mac", "fw", "state"} <= kv.keys():
        return None
    return kv


class SerialBoard:
    def __init__(self, port: str, opener: Callable = open_serial, sleep: Callable = time.sleep):
        self.port_name, self._opener, self._sleep = port, opener, sleep
        self._port = None

    def _open(self):
        if self._port is None:
            self._port = self._opener(self.port_name)
        return self._port

    def _close(self):
        if self._port is not None:
            try:
                self._port.close()
            except Exception:
                pass
            self._port = None

    def _readline(self) -> str | None:
        """None = read timeout (pyserial returns b""); "" = blank line (b"\\n"): the firmware
        frames every reply as "\\n<line>\\n"."""
        raw = self._open().readline()
        if not raw:
            return None
        return raw.decode("ascii", "replace").strip()

    def _send(self, text: str) -> None:
        self._open().write((text + "\n").encode("ascii"))

    def ident(self, timeout_s: float = IDENT_TIMEOUT_S) -> dict:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            self._open().reset_input_buffer()
            self._send("IDENT?")
            attempt_end = min(deadline, time.monotonic() + LINE_TIMEOUT_S)
            while time.monotonic() < attempt_end:
                line = self._readline()
                if line is None:
                    break
                info = parse_ident(line) if line else None
                if info:
                    return info
        raise BoardError("no IDENT reply from the board")

    def _expect(self, expected: str, timeout_s: float = EXPECT_TIMEOUT_S) -> str:
        """Wait for a line equal to `expected` (exact match; anything else is noise)."""
        deadline = time.monotonic() + timeout_s
        noise = 0
        while noise < 50 and time.monotonic() < deadline:  # skip blank lines and firmware logs
            line = self._readline()
            if line is None:
                raise BoardError("timeout waiting for the board")
            if not line:
                continue
            if line.startswith("ERR "):  # exact prefix with the space: "ERRO:" is a log line
                raise BoardError(line)
            if line == expected:
                return line
            noise += 1
        raise BoardError("timeout waiting for the board")

    def prov(self, serial: str, password: str) -> None:
        _check(serial, SERIAL_RE, "serial")
        self._send(f"PROV {serial}")
        self._expect("PASS?")
        try:
            self._send(password)  # only place the password leaves this process
            self._expect(f"OK {serial}")
        except BoardError as e:
            if str(e).startswith("ERR ") and str(e) != "ERR save_failed":
                raise  # explicit refusal: nothing was saved
            # timeout, or save_failed (the board restarts; NVS state unknown): ask it afterwards
            raise BoardUnsure("no verdict from the board after the password was sent") from None
        except OSError:
            # I/O error after the password may have reached the board: same doubt.
            raise BoardUnsure("I/O error after the password was sent") from None
        except KeyboardInterrupt:
            raise BoardUnsure("interrupted after the password was sent", interrupted=True) from None

    def unprov(self) -> None:
        self._send("UNPROV")
        self._expect("OK")  # exact line "OK": "OK snt-NNNN" (a PROV reply) does not count

    def wait_reboot_ident(self, timeout_s: float = REBOOT_TIMEOUT_S) -> dict:
        self._close()
        deadline = time.monotonic() + timeout_s
        self._sleep(1.0)  # the board restarts ~500 ms after OK
        last = "no attempt"
        while time.monotonic() < deadline:
            try:
                return self.ident(min(10.0, max(1.0, deadline - time.monotonic())))
            except (OSError, BoardError) as e:
                last = type(e).__name__
                self._close()
                self._sleep(1.0)
        raise BoardError(f"board did not come back within {timeout_s:.0f}s ({last})")


# ------------------------------------------------------------------ flows
def scrub(text: str, secret: str | None) -> str:
    return text.replace(secret, "***") if secret else text


def _validate_ident(info: dict) -> dict:
    if not MAC_RE.match(info.get("mac", "")):
        raise BoardError("board reported an invalid MAC")
    if info.get("state") not in ("provisioned", "unprovisioned"):
        raise BoardError("board reported an invalid state")
    return info


def _same_board(got: dict, first: dict) -> None:
    if got["mac"] != first["mac"]:
        raise BoardError("MAC changed across the restart (placa trocada?); nothing was undone")


def print_banner(serial: str, mac: str) -> None:
    print("=" * 40)
    print(f"  SERIAL: {serial}")
    print(f"  MAC:    {mac}")
    print("  Escreva este serial na etiqueta da placa.")
    print("=" * 40)


_UNPROV_HINT = ("run `provision-board.py unprov --port <porta>` and then `provision` again "
                "(the same serial is reused)")


def _lookup(remote: Remote, mac: str):
    out = remote.sql(build_lookup_sql(mac)).strip().splitlines()
    if not out:
        return None
    parts = out[-1].split("|")
    if len(parts) != 2 or not SERIAL_RE.match(parts[0]):
        raise RemoteError("unexpected reply from the registry lookup")
    return parts[0], parts[1]


def reconcile_provisioned(remote: Remote, info: dict) -> int:
    """Board already holds an identity: make sure registry and broker agree with it."""
    serial, mac = info["serial"], info["mac"]
    if not SERIAL_RE.match(serial):
        print("error: board reports state=provisioned with an invalid serial", file=sys.stderr)
        return 1
    row = _lookup(remote, mac)
    if row is None or row[0] != serial:
        print(f"error: board says {serial} but the registry has {row[0] if row else 'no row'} for "
              f"{mac}; {_UNPROV_HINT}", file=sys.stderr)
        return 1
    if row[1] == "baixado":
        print(f"error: {serial} is retired (baixado) in the registry", file=sys.stderr)
        return 1
    if serial not in remote.mqtt_list():
        print(f"error: broker user {serial} does not exist (an earlier failure removed it); "
              f"{_UNPROV_HINT}", file=sys.stderr)
        return 1
    if row[1] == "reservado":
        remote.sql(build_marcar_sql(serial, "provisionado"))
        print(f"registry reconciled: {serial} -> provisionado")
        print_banner(serial, mac)
        return 0
    print(f"already provisioned: {serial} (mac {mac}); nothing to do")
    return 0


def do_provision(board: Board, remote: Remote, hardware: str) -> int:
    info = _validate_ident(board.ident())
    if info["state"] == "provisioned":
        return reconcile_provisioned(remote, info)

    out = remote.sql(build_reserve_sql(info["mac"], hardware)).strip().splitlines()
    parts = out[-1].split("|") if out else []
    if len(parts) != 3 or not SERIAL_RE.match(parts[0]) or parts[1] not in ("reservado", "provisionado"):
        print("error: unexpected reply from dispositivo_reservar; aborting before touching the broker",
              file=sys.stderr)
        return 1
    serial, existed = parts[0], parts[2] == "t"
    created_here = not existed

    password = None
    add_attempted = False
    # keep: the password may have reached the board, so nothing is ever undone automatically.
    # It is set BEFORE board.prov(): a Ctrl-C at any point from here on (even a second one while
    # the board is being checked) lands in the keep path, never in _undo. Only an explicit refusal
    # (a plain BoardError: nothing was saved) or the board itself reporting "unprovisioned" clears it.
    keep = False
    accepted = False  # the board answered OK: its state is known (identity in NVS)
    try:
        add_attempted = True
        password = remote.mqtt_add(serial)
        keep = True
        unsure = interrupted = False
        try:
            board.prov(serial, password)
            accepted = True
        except BoardUnsure as e:
            unsure, interrupted = True, e.interrupted
        except BoardError:
            keep = False
            raise  # explicit refusal / nothing sent: safe to undo
        except OSError:
            unsure = True  # anything unexpected around the password line: assume the worst
        except KeyboardInterrupt:
            unsure = interrupted = True
        password = None
        if unsure:
            print("Interrompido; verificando a placa (até 60 s). Ctrl-C de novo aborta e mantém "
                  "credencial e reserva." if interrupted else
                  "Sem veredito da placa; verificando a placa (até 60 s). Ctrl-C aborta e mantém "
                  "credencial e reserva.", file=sys.stderr, flush=True)
            got = _validate_ident(board.wait_reboot_ident(REBOOT_TIMEOUT_S))
            _same_board(got, info)
            if got["state"] == "unprovisioned":
                keep = False
                raise BoardError("board did not accept the credential")
            raise BoardError("board saved an identity but never confirmed; rerun to reconcile")
        got = _validate_ident(board.wait_reboot_ident(REBOOT_TIMEOUT_S))
        _same_board(got, info)
        if got["serial"] != serial or got["state"] != "provisioned":
            raise BoardError(f"board came back as {got['serial']!r}/{got['state']}, expected {serial}")
        remote.sql(build_marcar_sql(serial, "provisionado"))
    except (Exception, KeyboardInterrupt) as e:  # noqa: BLE001
        msg = scrub(f"{type(e).__name__}: {e}", password)
        password = None
        print(f"error: {msg}", file=sys.stderr)
        if keep:
            state = (f"board accepted {serial}" if accepted
                     else f"board state unknown (it may hold {serial})")
            print(f"warning: {state}; credential and reservation were KEPT. Run `provision` again: "
                  f"if the board holds {serial} it reconciles the registry; if it is unprovisioned it "
                  f"provisions it again with the same serial; otherwise it tells you to run unprov.",
                  file=sys.stderr)
            return 1
        _undo(remote, serial, created_here, add_attempted)
        return 1
    finally:
        password = None

    print_banner(serial, info["mac"])
    return 0


def _undo(remote: Remote, serial: str, created_here: bool, add_attempted: bool) -> None:
    # mqtt_del only if add was attempted: the board is unprovisioned, so any credential for this
    # serial is orphaned (a reused serial gets a fresh password on the next run anyway).
    if add_attempted:
        try:
            remote.mqtt_del(serial)
        except Exception as e:  # noqa: BLE001
            print(f"warning: could not remove broker user {serial} ({type(e).__name__}; it may not exist); "
                  f"check with mqtt-user.sh list",
                  file=sys.stderr)
    if created_here:
        try:
            remote.sql(build_liberar_sql(serial))
        except Exception as e:  # noqa: BLE001
            print(f"warning: undo dispositivo_liberar_reserva failed ({type(e).__name__}); "
                  f"release {serial} by hand", file=sys.stderr)


def do_retire(remote: Remote, serial: str) -> int:
    try:
        # Idempotent: a retry after a partial failure must not stop at "user not found".
        # mqtt-user.sh del has no distinct exit code for it, so list (names only) first.
        if serial in remote.mqtt_list():
            remote.mqtt_del(serial)
        remote.sql(build_marcar_sql(serial, "baixado"))
    except (RemoteError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    print(f"{serial} retired (credential removed, registry: baixado; the serial is never reused)")
    return 0


def do_unprov(board: Board) -> int:
    failed = False
    try:
        board.unprov()
    except BoardError as e:
        # ERR clear_failed also restarts the board: report what it actually holds afterwards.
        print(f"error: {e}", file=sys.stderr)
        failed = True
    info = _validate_ident(board.wait_reboot_ident(REBOOT_TIMEOUT_S))
    print(" ".join(f"{k}={info[k]}" for k in ("serial", "mac", "fw", "state")))
    if info["state"] != "unprovisioned":
        print("error: board still reports an identity", file=sys.stderr)
        return 1
    if failed:
        return 1
    print("board cleared. Registry and broker user were not touched: `provision` reuses the serial "
          "(new password); `retire` removes it for good.")
    return 0


def do_ident(board: Board) -> int:
    info = board.ident()
    print(" ".join(f"{k}={info[k]}" for k in ("serial", "mac", "fw", "state")))
    return 0


# ------------------------------------------------------------------ CLI
def _serial_arg(v: str) -> str:
    if not SERIAL_RE.match(v):
        raise argparse.ArgumentTypeError("must match ^snt-[0-9]{4}$")
    return v


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="provision-board.py", description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("provision")
    a.add_argument("--port", required=True)
    a.add_argument("--hardware", default=DEFAULT_HARDWARE)
    a.add_argument("--host", default=DEFAULT_HOST)
    r = sub.add_parser("retire")
    r.add_argument("serial", type=_serial_arg)
    r.add_argument("--host", default=DEFAULT_HOST)
    i = sub.add_parser("ident")
    i.add_argument("--port", required=True)
    u = sub.add_parser("unprov")
    u.add_argument("--port", required=True)
    return p


def main(argv: list[str] | None = None, board: Board | None = None, remote: Remote | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.cmd == "provision" and not HARDWARE_RE.match(args.hardware):
        print("error: --hardware must match ^[a-z0-9_]{1,40}$", file=sys.stderr)
        return 2
    if args.cmd in ("provision", "retire") and not HOST_RE.match(args.host):
        print("error: invalid --host", file=sys.stderr)
        return 2
    try:
        if args.cmd == "ident":
            return do_ident(board or SerialBoard(args.port))
        if args.cmd == "unprov":
            return do_unprov(board or SerialBoard(args.port))
        if args.cmd == "retire":
            return do_retire(remote or SshRemote(args.host), args.serial)
        return do_provision(board or SerialBoard(args.port), remote or SshRemote(args.host), args.hardware)
    except (BoardError, RemoteError, OSError) as e:
        print(f"error: {type(e).__name__}: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
