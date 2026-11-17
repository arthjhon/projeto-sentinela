#!/usr/bin/env bash
# Verifies that a broker credential is NOT allowed to publish on <device_id>/sensores.
#
# Usage: mqtt-acl-check.sh <broker_host> <user> <pass> <device_id>
#
# Exit codes:
#   0  publish rejected by the broker  ("ACL OK: publish rejected")
#   1  publish accepted by the broker  ("ACL FAIL: publish accepted")
#   2  usage error, or could not connect/authenticate (result is inconclusive)
#
# Env overrides (mainly for the local test harness):
#   MQTT_PORT  broker port (default 8883)
#   MQTT_TLS   1 = TLS with the system CA bundle (default), 0 = plain TCP
#
# Uses mosquitto_pub from PATH, or falls back to a pinned eclipse-mosquitto image.
# The password never goes on the command line: it is written to a mode-600 temp
# config file that mosquitto_pub reads from $XDG_CONFIG_HOME/mosquitto_pub (this
# version has no -o flag), so it does not show up in `ps`. Limitation: the file
# exists briefly on disk (and is bind-mounted read-only in the docker fallback).
set -u

readonly MOSQUITTO_IMAGE="eclipse-mosquitto:2.0.22"
readonly CA_FILE="/etc/ssl/certs/ca-certificates.crt"

if [ "$#" -ne 4 ]; then
  echo "usage: ${0##*/} <broker_host> <user> <pass> <device_id>" >&2
  exit 2
fi
broker=$1 user=$2 pass=$3 device_id=$4
port=${MQTT_PORT:-8883}
tls=${MQTT_TLS:-1}

for v in "$broker" "$user" "$pass" "$device_id"; do
  if [ -z "$v" ]; then
    echo "error: arguments must not be empty" >&2
    exit 2
  fi
done
# The options file is line-based; reject values that could inject extra options.
case "$user$pass$broker$device_id" in
  *$'\n'* | *$'\r'*)
    echo "error: arguments must not contain newlines" >&2
    exit 2
    ;;
esac

cfgdir=$(mktemp -d) || exit 2
trap 'rm -rf "$cfgdir"' EXIT
chmod 700 "$cfgdir"
umask 077
printf -- '-u %s\n-P %s\n' "$user" "$pass" >"$cfgdir/mosquitto_pub"

args=(-V mqttv5 -q 1 -h "$broker" -p "$port" -t "$device_id/sensores" -m '{"ph":0}')
if [ "$tls" = "1" ]; then
  args+=(--cafile "$CA_FILE")
fi

if command -v mosquitto_pub >/dev/null 2>&1; then
  out=$(XDG_CONFIG_HOME="$cfgdir" mosquitto_pub "${args[@]}" 2>&1)
  rc=$?
elif command -v docker >/dev/null 2>&1; then
  out=$(docker run --rm --network host --user "$(id -u):$(id -g)" \
    -e XDG_CONFIG_HOME=/cfg -v "$cfgdir:/cfg:ro" -v "$CA_FILE:$CA_FILE:ro" \
    "$MOSQUITTO_IMAGE" mosquitto_pub "${args[@]}" 2>&1)
  rc=$?
else
  echo "error: neither mosquitto_pub nor docker found" >&2
  exit 2
fi

# mosquitto_pub (MQTT v5, QoS 1) exits 0 even when the broker denies the publish:
# the PUBACK carries reason code 135 and the client only prints
# "Warning: Publish N failed: Not authorized." Connection/auth failures are
# different ("Connection error: ...") and exit non-zero.
if grep -q "Publish [0-9]* failed: Not authorized" <<<"$out"; then
  echo "ACL OK: publish rejected"
  exit 0
fi
if [ "$rc" -eq 0 ] && ! grep -qi "failed" <<<"$out"; then
  echo "ACL FAIL: publish accepted"
  exit 1
fi

echo "error: could not complete the check (mosquitto_pub exit $rc):" >&2
# Output has no credentials: mosquitto_pub does not echo them.
echo "$out" >&2
exit 2
