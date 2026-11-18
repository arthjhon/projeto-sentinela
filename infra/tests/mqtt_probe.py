#!/usr/bin/env python3
"""MQTT v5 probe used by infra/tests/mosquitto.test.sh.

  mqtt_probe.py --url URL [--user U] (--pub TOPIC | --sub TOPIC)
                [--expect allowed|denied] [--retain] [--bytes N]
                [--observer USER|- [--obs-url URL]] [--receive]
                [--feeder USER [--feeder-url URL]]

The password is read from env MQTT_PASS (observer: MQTT_OBS_PASS, feeder: MQTT_FEED_PASS), never argv.
Exit 0 iff the observed result equals --expect (default allowed), 1 on
mismatch, 2 on probe setup errors.

  --sub : allowed iff the connection and the SUBACK are granted. With
          --receive the probe also needs a message within 3 s (retained check).
          With --feeder USER, USER (privileged) also publishes to the topic
          after the subscribe and the message must arrive: Mosquitto 2.0 can
          answer SUBACK "granted" for an ACL-denied filter, so delivery is the
          authoritative signal there too.
  --pub : (--observer required; "-" = anonymous) allowed iff the message reaches a privileged observer within 3 s.
          Mosquitto drops unauthorized publishes silently on MQTT 3.1.1, so
          delivery is the authoritative signal; the v5 PUBACK reason code is
          printed for information. A refused connection counts as denied.
"""
import argparse
import os
import sys
import threading
import uuid
from urllib.parse import urlparse

import paho.mqtt.client as mqtt

WAIT = 3.0


def make(url, user, password):
    u = urlparse(url)
    ws = u.scheme in ("ws", "wss")
    c = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id="probe-" + uuid.uuid4().hex[:12],
        protocol=mqtt.MQTTv5,
        transport="websockets" if ws else "tcp",
    )
    if user:
        c.username_pw_set(user, password)
    if u.scheme in ("wss", "mqtts"):
        c.tls_set()
    port = u.port or {"ws": 80, "wss": 443, "tcp": 1883, "mqtt": 1883, "mqtts": 8883}[u.scheme]
    return c, u.hostname, port


def connect(url, user, password):
    """Return a connected client, or None when the broker refuses/unreachable."""
    c, host, port = make(url, user, password)
    ok = threading.Event()
    state = {"good": False}

    def on_connect(_c, _u, _f, rc, _p):
        state["good"] = not rc.is_failure
        ok.set()

    c.on_connect = on_connect
    try:
        c.connect(host, port, keepalive=30)
    except OSError as e:
        print(f"connect error: {e}", file=sys.stderr)
        return None
    c.loop_start()
    if not ok.wait(5) or not state["good"]:
        c.loop_stop()
        return None
    return c


def subscribe(c, topic):
    done = threading.Event()
    res = {}

    def on_sub(_c, _u, _mid, rcs, _p):
        res["rc"] = rcs[0]
        print(f"suback: {rcs[0]}", file=sys.stderr)
        done.set()

    c.on_subscribe = on_sub
    c.subscribe(topic, qos=1)
    return done.wait(5) and not res["rc"].is_failure


def do_sub(a, pw):
    c = connect(a.url, a.user, pw)
    if c is None:
        return False
    got = threading.Event()
    c.on_message = lambda *_: got.set()
    ok = subscribe(c, a.sub)
    if ok and a.feeder:
        f = connect(a.feeder_url or a.url, a.feeder, os.environ.get("MQTT_FEED_PASS", ""))
        if f is None:
            print("feeder could not connect", file=sys.stderr)
            sys.exit(2)
        f.publish(a.sub, b"feed", qos=1).wait_for_publish(timeout=WAIT)
        f.loop_stop()
        f.disconnect()
    if ok and (a.receive or a.feeder):
        ok = got.wait(WAIT)
    c.loop_stop()
    c.disconnect()
    return ok


def do_pub(a, pw):
    obs_pw = os.environ.get("MQTT_OBS_PASS", "")
    obs_user = None if a.observer == "-" else a.observer
    obs = connect(a.obs_url or a.url, obs_user, obs_pw)
    if obs is None:
        print("observer could not connect", file=sys.stderr)
        sys.exit(2)
    marker = uuid.uuid4().hex.encode()
    payload = marker + b"x" * max(0, a.bytes - len(marker))
    seen = threading.Event()

    def on_message(_c, _u, msg):
        if msg.payload.startswith(marker):
            seen.set()

    obs.on_message = on_message
    if not subscribe(obs, a.pub):
        print("observer cannot subscribe to " + a.pub, file=sys.stderr)
        sys.exit(2)

    c = connect(a.url, a.user, pw)
    if c is None:
        obs.loop_stop()
        return False
    info = c.publish(a.pub, payload, qos=1, retain=a.retain)
    try:
        info.wait_for_publish(timeout=WAIT)
        if info.is_published():
            print("puback received", file=sys.stderr)
    except (RuntimeError, ValueError):
        pass
    delivered = seen.wait(WAIT)
    for x in (c, obs):
        x.loop_stop()
        x.disconnect()
    return delivered


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--user")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--pub")
    g.add_argument("--sub")
    p.add_argument("--expect", choices=("allowed", "denied"), default="allowed")
    p.add_argument("--retain", action="store_true")
    p.add_argument("--bytes", type=int, default=0)
    p.add_argument("--observer")
    p.add_argument("--obs-url")
    p.add_argument("--receive", action="store_true")
    p.add_argument("--feeder")
    p.add_argument("--feeder-url")
    a = p.parse_args()
    if a.pub and not a.observer:
        p.error("--pub needs --observer")
    pw = os.environ.get("MQTT_PASS", "")
    allowed = do_sub(a, pw) if a.sub else do_pub(a, pw)
    got = "allowed" if allowed else "denied"
    print(got)
    return 0 if got == a.expect else 1


if __name__ == "__main__":
    sys.exit(main())
