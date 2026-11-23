#!/usr/bin/env bash
# shellcheck disable=SC2317  # trap function and test_* run via dispatcher
# Live test for infra/stack/mosquitto/{mosquitto.conf,acl} against a throwaway
# eclipse-mosquitto container (own network, own data volume, mqtt-test-* names,
# all removed on exit). The probe is infra/tests/mqtt_probe.py running in a
# throwaway python image with paho-mqtt. Needs docker and network access to
# pull images / PyPI on first run. Passwords are random per run and never reach argv.
set -u

readonly BROKER_IMAGE=eclipse-mosquitto:2.0.22
readonly PY_IMAGE=python:3.12.8-slim
readonly PAHO=paho-mqtt==2.1.0
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
conf_dir=$(cd "$here/../stack" 2>/dev/null && pwd)/mosquitto
run=mqtt-test-$$-$RANDOM
net=$run-net
vol=$run-data
broker=$run-broker
probe_img=$run-probe
tmp=$(mktemp -d)
fails=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; fails=$((fails + 1)); }

teardown() {
  docker rm -f -v "$broker" >/dev/null 2>&1
  docker volume rm -f "$vol" >/dev/null 2>&1
  docker network rm "$net" >/dev/null 2>&1
  docker rmi -f "$probe_img" >/dev/null 2>&1
  rm -rf "$tmp"
}
trap teardown EXIT

for f in mosquitto.conf acl; do
  [ -f "$conf_dir/$f" ] || { echo "FAIL: missing $conf_dir/$f"; exit 1; }
done

# ---- probe image -------------------------------------------------------------
mkdir "$tmp/img"
printf 'FROM %s\nRUN pip install --no-cache-dir %s\n' "$PY_IMAGE" "$PAHO" >"$tmp/img/Dockerfile"
docker build -q -t "$probe_img" "$tmp/img" >/dev/null || { echo "cannot build probe image"; exit 1; }

# ---- passwords (mode-600 file, hashed inside the broker image) ----------------
users=(esp_a esp_b svc/telegraf svc/ota)
declare -A pw
umask 077
: >"$tmp/plain"
for u in "${users[@]}"; do
  pw[$u]=$(head -c 18 /dev/urandom | base64 | tr -d '/+=:')
  printf '%s:%s\n' "$u" "${pw[$u]}" >>"$tmp/plain"
done
umask 022
docker network create "$net" >/dev/null || { echo "cannot create network"; exit 1; }
docker volume create "$vol" >/dev/null
# mosquitto_passwd -U hashes a plaintext user:password file in place (no password in argv).
docker run --rm -v "$vol:/data" -v "$tmp/plain:/in/plain:ro" "$BROKER_IMAGE" sh -c '
  cp /in/plain /data/passwd && mosquitto_passwd -U /data/passwd &&
  chown 1883:1883 /data/passwd && chmod 600 /data/passwd' >/dev/null 2>&1 \
  || { echo "cannot seed passwd"; exit 1; }

start_broker() {
  docker run -d --name "$broker" --network "$net" \
    -v "$conf_dir/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro" \
    -v "$conf_dir/acl:/mosquitto/config/acl:ro" \
    -v "$vol:/mosquitto/data" "$BROKER_IMAGE" >/dev/null || return 1
  wait_broker 0
}
wait_broker() { # <log lines to skip>: wait for "running" printed after them
  local _
  for _ in $(seq 50); do
    docker logs "$broker" 2>&1 | tail -n +$(($1 + 1)) | grep -q 'running' && return 0
    [ "$(docker inspect -f '{{.State.Running}}' "$broker" 2>/dev/null)" = true ] || return 1
    sleep 0.2
  done
  return 1
}
start_broker || { echo "FAIL: broker did not start"; docker logs "$broker" 2>&1 | tail -n 20; exit 1; }

readonly WS="ws://$broker:9001" WSD="ws://$broker:9002" TCP="tcp://$broker:1883"

# probe <pass-var-user|-> ... : args after env are passed to mqtt_probe.py.
# Passwords travel via env (name-only -e), never argv.
probe() { # <user|-> <args...>
  local user=$1; shift
  local pass="" opass="" fpass="" args=("$@") i
  [ "$user" != - ] && { pass=${pw[$user]}; args+=(--user "$user"); }
  for ((i = 0; i < ${#args[@]}; i++)); do
    if [ "${args[$i]}" = --observer ]; then
      local o=${args[$((i + 1))]}
      [ "$o" != - ] && opass=${pw[$o]}
    fi
    [ "${args[$i]}" = --feeder ] && fpass=${pw[${args[$((i + 1))]}]}
  done
  MQTT_PASS=$pass MQTT_OBS_PASS=$opass MQTT_FEED_PASS=$fpass \
    docker run --rm --network "$net" -e MQTT_PASS -e MQTT_OBS_PASS -e MQTT_FEED_PASS \
    -v "$here/mqtt_probe.py:/probe.py:ro" "$probe_img" python -I /probe.py "${args[@]}" 2>"${PROBE_ERR:-/dev/null}"
}
check() { # <description> <user|-> <probe args...>   (last arg of caller decides expect)
  local desc=$1; shift
  if probe "$@" >/dev/null; then pass "$desc"; else fail "$desc"; fi
}

test_anonymous_reads_telemetry() {
  check "anonymous ws reads esp_a/sensores" - --url "$WS" --sub esp_a/sensores \
    --feeder esp_a --feeder-url "$TCP" --expect allowed
}
test_anonymous_cannot_publish() {
  check "anonymous ws cannot publish esp_a/sensores" - --url "$WS" --pub esp_a/sensores \
    --observer svc/telegraf --obs-url "$TCP" --expect denied
  check "anonymous ws cannot publish esp_a/ota/command" - --url "$WS" --pub esp_a/ota/command \
    --observer esp_a --obs-url "$TCP" --expect denied
}
test_anonymous_tcp_refused() {
  check "anonymous tcp 1883 refused" - --url "$TCP" --sub esp_a/sensores --expect denied
}
test_device_listener_requires_auth() {
  check "anonymous ws 9002 refused" - --url "$WSD" --sub esp_a/sensores --expect denied
  check "esp_a publishes esp_a/sensores on ws 9002" esp_a --url "$WSD" --pub esp_a/sensores \
    --observer svc/telegraf --obs-url "$TCP" --expect allowed
  check "esp_a cannot publish esp_b/sensores on ws 9002" esp_a --url "$WSD" --pub esp_b/sensores \
    --observer svc/telegraf --obs-url "$TCP" --expect denied
  check "svc/ota command via ws 9002 reaches esp_a" svc/ota --url "$WSD" --pub esp_a/ota/command \
    --observer esp_a --obs-url "$TCP" --expect allowed
}
test_device_publishes_own_prefix() {
  check "esp_a publishes esp_a/sensores" esp_a --url "$TCP" --pub esp_a/sensores \
    --observer svc/telegraf --expect allowed
}
test_device_cannot_cross_prefix() {
  check "esp_a cannot publish esp_b/sensores" esp_a --url "$TCP" --pub esp_b/sensores \
    --observer svc/telegraf --expect denied
  check "esp_a cannot subscribe esp_b/ota/command" esp_a --url "$TCP" --sub esp_b/ota/command \
    --feeder svc/ota --expect denied
}
test_service_accounts_cannot_inject() {
  local u t
  for u in svc/telegraf svc/ota; do
    for t in svc/sensores x/sensores x/status; do
      check "$u cannot publish $t" "$u" --url "$TCP" --pub "$t" --observer svc/telegraf --expect denied
    done
  done
}
test_ota_publisher_reaches_device() {
  check "svc/ota command reaches esp_a" svc/ota --url "$TCP" --pub esp_a/ota/command \
    --observer esp_a --expect allowed
}
test_telegraf_reads_both() {
  check "telegraf receives +/sensores from esp_a" esp_a --url "$TCP" --pub esp_a/sensores \
    --observer svc/telegraf --expect allowed
  check "telegraf receives +/status from esp_a" esp_a --url "$TCP" --pub esp_a/status \
    --observer svc/telegraf --expect allowed
}
test_packet_size_limit() {
  check "5000-byte publish not delivered" esp_a --url "$TCP" --pub esp_a/sensores --bytes 5000 \
    --observer svc/telegraf --expect denied
  check "1000-byte publish is delivered" esp_a --url "$TCP" --pub esp_a/sensores --bytes 1000 \
    --observer svc/telegraf --expect allowed
}
test_retained_survive_restart() {
  check "esp_a retains esp_a/availability" esp_a --url "$TCP" --pub esp_a/availability --retain \
    --observer - --obs-url "$WS" --expect allowed
  local skip
  skip=$(docker logs "$broker" 2>&1 | wc -l)
  if ! { docker restart -t 10 "$broker" >/dev/null && wait_broker "$skip"; }; then
    fail "broker restart"
    return
  fi
  check "retained availability survives restart" - --url "$WS" --sub esp_a/availability --receive --expect allowed
}

for t in test_anonymous_reads_telemetry test_anonymous_cannot_publish test_anonymous_tcp_refused test_device_listener_requires_auth \
  test_device_publishes_own_prefix test_device_cannot_cross_prefix test_service_accounts_cannot_inject \
  test_ota_publisher_reaches_device test_telegraf_reads_both test_packet_size_limit \
  test_retained_survive_restart; do
  echo "--- $t"
  "$t"
done

[ "$fails" -eq 0 ] && echo "all tests passed" || echo "$fails test(s) failed"
exit $((fails > 0))
