#!/usr/bin/env bash
# Local test for infra/bin/mqtt-acl-check.sh against a throwaway mosquitto broker.
# Needs docker. Does not touch any real broker.
set -u

readonly IMAGE="eclipse-mosquitto:2.0.22"
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
script="$here/../bin/mqtt-acl-check.sh"
name="acl-check-test-$$"
port=18883
tmp=$(mktemp -d)
fails=0

# shellcheck disable=SC2317  # invoked via trap
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1
  # The container entrypoint chowns the config dir to uid 1883, so remove it
  # from inside a container (mounting the parent, to delete the dir itself).
  docker run --rm -v "$(dirname "$tmp"):/p" "$IMAGE" rm -rf "/p/$(basename "$tmp")" >/dev/null 2>&1
}
trap cleanup EXIT

cat >"$tmp/mosquitto.conf" <<CONF
listener $port
password_file /mosquitto/config/pw
acl_file /mosquitto/config/acl
CONF
cat >"$tmp/acl" <<'ACL'
user browser
topic deny +/sensores
topic write +/ota/command
user device
topic write +/sensores
ACL

docker run --rm -v "$tmp:/c" "$IMAGE" sh -c '
  : > /c/pw
  mosquitto_passwd -b /c/pw browser browserpass
  mosquitto_passwd -b /c/pw device devicepass
  chmod 0700 /c/pw /c/acl /c/mosquitto.conf
  chown 1883:1883 /c/pw /c/acl /c/mosquitto.conf' >/dev/null 2>&1 || { echo "setup failed" >&2; exit 2; }

docker run -d --name "$name" --network host -v "$tmp:/mosquitto/config" \
  "$IMAGE" mosquitto -c /mosquitto/config/mosquitto.conf >/dev/null || exit 2

for _ in $(seq 1 30); do
  (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && break
  sleep 0.2
done

check() { # <description> <expected rc> <user> <pass>
  local desc=$1 want=$2 got
  MQTT_PASS=$4 MQTT_TLS=0 MQTT_PORT=$port "$script" 127.0.0.1 "$3" dev1 >/dev/null 2>&1
  got=$?
  if [ "$got" -eq "$want" ]; then
    echo "PASS: $desc (exit $got)"
  else
    echo "FAIL: $desc (expected $want, got $got)"
    fails=$((fails + 1))
  fi
}

check "denied user is rejected"       0 browser browserpass
check "allowed user is accepted"      1 device  devicepass
check "wrong password is inconclusive" 2 browser wrongpass

MQTT_PASS=x MQTT_TLS=0 MQTT_PORT=$port "$script" onlyone >/dev/null 2>&1
if [ $? -eq 2 ]; then echo "PASS: wrong arg count (exit 2)"; else echo "FAIL: wrong arg count"; fails=$((fails + 1)); fi

env -u MQTT_PASS MQTT_TLS=0 MQTT_PORT=$port "$script" 127.0.0.1 browser dev1 >/dev/null 2>&1
if [ $? -eq 2 ]; then echo "PASS: unset MQTT_PASS (exit 2)"; else echo "FAIL: unset MQTT_PASS"; fails=$((fails + 1)); fi

[ "$fails" -eq 0 ] && echo "all tests passed" || echo "$fails test(s) failed"
exit $((fails > 0))
