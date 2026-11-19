#!/usr/bin/env bash
# shellcheck disable=SC2015,SC2016,SC2317  # `cond && pass || fail` (pass never fails); trap fn and test_* via dispatcher
# Live test for infra/bin/mqtt-user.sh against a throwaway eclipse-mosquitto
# container running the real config (own network and data volume, mqtt-user-test-*
# names, all removed on exit). Probe: infra/tests/mqtt_probe.py in a python image
# with paho-mqtt. Passwords reach the probe via env only, never argv.
set -u

readonly BROKER_IMAGE=eclipse-mosquitto:2.0.22
readonly PY_IMAGE=python:3.12.8-slim
readonly PAHO=paho-mqtt==2.1.0
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
script=$here/../bin/mqtt-user.sh
conf_dir=$(cd "$here/../stack" 2>/dev/null && pwd)/mosquitto
run=mqtt-user-test-$$-$RANDOM
net=$run-net
vol=$run-data
broker=$run-broker
probe_img=$run-probe
tmp=$(mktemp -d)
fails=0
poller_pid=""
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; fails=$((fails + 1)); }

teardown() {
  # shellcheck disable=SC2086
  [ -n "$poller_pid" ] && kill $poller_pid 2>/dev/null
  docker rm -f -v "$broker" >/dev/null 2>&1
  docker volume rm -f "$vol" >/dev/null 2>&1
  docker network rm "$net" >/dev/null 2>&1
  docker rmi -f "$probe_img" >/dev/null 2>&1
  rm -rf "$tmp"
}
trap teardown EXIT

[ -x "$script" ] || { echo "FAIL: $script missing or not executable"; exit 1; }

mkdir "$tmp/img"
printf 'FROM %s\nRUN pip install --no-cache-dir %s\n' "$PY_IMAGE" "$PAHO" >"$tmp/img/Dockerfile"
docker build -q -t "$probe_img" "$tmp/img" >/dev/null || { echo "cannot build probe image"; exit 1; }
docker network create "$net" >/dev/null || { echo "cannot create network"; exit 1; }
docker volume create "$vol" >/dev/null
# Same initial state as the compose service: empty passwd, owner 1883, mode 600.
docker run --rm -v "$vol:/data" "$BROKER_IMAGE" sh -c '
  : > /data/passwd && chown 1883:1883 /data/passwd && chmod 600 /data/passwd' >/dev/null 2>&1 \
  || { echo "cannot seed passwd"; exit 1; }
docker run -d --name "$broker" --network "$net" \
  -v "$conf_dir/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro" \
  -v "$conf_dir/acl:/mosquitto/config/acl:ro" \
  -v "$vol:/mosquitto/data" "$BROKER_IMAGE" >/dev/null || { echo "broker did not start"; exit 1; }
for _ in $(seq 50); do docker logs "$broker" 2>&1 | grep -q running && break; sleep 0.2; done

readonly TCP="tcp://$broker:1883"
declare -A pw

# mu <args...>: run the script against the throwaway broker.
mu() { MQTT_CONTAINER=$broker bash "$script" "$@"; }
# add_user <user>: stores the printed password in pw[user].
add_user() { pw[$1]=$(mu add "$1" 2>/dev/null); }

# probe <user> <pass> <args...>: password via env (name-only -e).
probe() {
  local user=$1 pass=$2 opass=$3
  shift 3
  MQTT_PASS=$pass MQTT_OBS_PASS=$opass docker run --rm --network "$net" -e MQTT_PASS -e MQTT_OBS_PASS \
    -v "$here/mqtt_probe.py:/probe.py:ro" "$probe_img" python -I /probe.py --url "$TCP" --user "$user" "$@" >/dev/null 2>&1
}
can_publish() { # <user> <pass> <topic>   (observer: svc/telegraf)
  probe "$1" "$2" "${pw[svc/telegraf]}" --pub "$3" --observer svc/telegraf --expect allowed
}

test_bootstrap_and_publish() {
  add_user svc/telegraf
  add_user esp_c
  [ "${#pw[esp_c]}" -ge 32 ] && pass "password has 32+ chars" || fail "password has 32+ chars"
  can_publish esp_c "${pw[esp_c]}" esp_c/sensores && pass "esp_c publishes esp_c/sensores with printed password" \
    || fail "esp_c publishes esp_c/sensores with printed password"
}
test_rotation() {
  add_user esp_d
  local old=${pw[esp_d]}
  add_user esp_d
  [ "$old" != "${pw[esp_d]}" ] && pass "rotation yields a new password" || fail "rotation yields a new password"
  can_publish esp_d "$old" esp_d/sensores && fail "old password refused after rotation" \
    || pass "old password refused after rotation"
  can_publish esp_d "${pw[esp_d]}" esp_d/sensores && pass "new password accepted" || fail "new password accepted"
  can_publish esp_c "${pw[esp_c]}" esp_c/sensores && pass "other user unaffected by rotation" \
    || fail "other user unaffected by rotation"
  local n
  n=$(mu list | grep -c -x esp_d)
  [ "$n" = 1 ] && pass "rotated user listed once" || fail "rotated user listed once ($n)"
}
test_del() {
  mu del esp_c >/dev/null 2>&1 && pass "del esp_c exits 0" || fail "del esp_c exits 0"
  can_publish esp_c "${pw[esp_c]}" esp_c/sensores && fail "deleted user refused" || pass "deleted user refused"
  can_publish esp_d "${pw[esp_d]}" esp_d/sensores && pass "other user survives del" || fail "other user survives del"
  mu del esp_c >/dev/null 2>&1 && fail "del of unknown user exits non-zero" || pass "del of unknown user exits non-zero"
}
test_invalid_names() {
  local u rc
  for u in 'bad user' 'a:b' '../x' '' 'svc/other' 'svc/telegraf/x' "$(printf 'a%.0s' $(seq 41))"; do
    mu add "$u" >/dev/null 2>&1
    rc=$?
    [ "$rc" = 2 ] && pass "add '$u' exits 2" || fail "add '$u' exits 2 (got $rc)"
  done
  mu del 'a:b' >/dev/null 2>&1
  [ $? = 2 ] && pass "del 'a:b' exits 2" || fail "del 'a:b' exits 2"
  mu bogus >/dev/null 2>&1
  [ $? = 2 ] && pass "unknown command exits 2" || fail "unknown command exits 2"
}
test_service_names_accepted() {
  add_user svc/ota
  [ -n "${pw[svc/ota]}" ] && pass "svc/ota accepted" || fail "svc/ota accepted"
}
test_list_no_hashes() {
  local out
  out=$(mu list)
  if printf '%s\n' "$out" | grep -q -e '\$' -e ':'; then fail "list prints usernames only"; else pass "list prints usernames only"; fi
  printf '%s\n' "$out" | grep -qx svc/telegraf && pass "list shows svc/telegraf" || fail "list shows svc/telegraf"
}
test_file_perms() {
  local st
  st=$(docker exec "$broker" stat -c '%u:%g %a' /mosquitto/data/passwd)
  [ "$st" = "1883:1883 600" ] && pass "passwd stays 1883:1883 mode 600" || fail "passwd perms ($st)"
  docker exec "$broker" sh -c 'ls -A /mosquitto/data /dev/shm | grep -q "passwd\.new\|mqtt-user\."' \
    && fail "no temp file left in data dir or /dev/shm" || pass "no temp file left in data dir or /dev/shm"
}
test_no_password_in_ps() {
  # Two independent pollers (host ps; container ps via docker exec), iterations counted.
  : >"$tmp/ps.host" ; : >"$tmp/ps.ct"; rm -f "$tmp/stop"
  ( n=0; while [ ! -e "$tmp/stop" ]; do ps -eo args >>"$tmp/ps.host" 2>/dev/null; n=$((n + 1)); echo "$n" >"$tmp/it.host"; done ) &
  local hp=$!
  ( n=0; while [ ! -e "$tmp/stop" ]; do docker exec "$broker" ps -o args >>"$tmp/ps.ct" 2>/dev/null; n=$((n + 1)); echo "$n" >"$tmp/it.ct"; done ) &
  local cp=$!
  poller_pid="$hp $cp"
  local i all=()
  for i in 1 2 3 4 5 6; do
    add_user "esp_p$i"
    all+=("${pw[esp_p$i]}")
  done
  touch "$tmp/stop"
  wait "$hp" "$cp" 2>/dev/null
  poller_pid=""
  local ih ic leaked=0 p
  ih=$(cat "$tmp/it.host" 2>/dev/null || echo 0); ic=$(cat "$tmp/it.ct" 2>/dev/null || echo 0)
  for p in "${all[@]}"; do
    [ -n "$p" ] || leaked=1
    grep -qF -- "$p" "$tmp/ps.host" "$tmp/ps.ct" && leaked=1
  done
  [ "$leaked" = 0 ] && [ "$ih" -gt 10 ] && [ "$ic" -gt 3 ] \
    && pass "no password in ps (host $ih polls, container $ic polls)" \
    || fail "password seen in ps or pollers idle (leaked=$leaked host=$ih container=$ic)"
}
test_numeric_looking_ids() {
  add_user 100; add_user 1e2; add_user 0100
  local first=${pw[100]}
  add_user 100
  can_publish 1e2 "${pw[1e2]}" 1e2/sensores && pass "1e2 survives rotation of 100" || fail "1e2 survives rotation of 100"
  can_publish 0100 "${pw[0100]}" 0100/sensores && pass "0100 survives rotation of 100" || fail "0100 survives rotation of 100"
  can_publish 100 "$first" 100/sensores && fail "100 old password refused" || pass "100 old password refused"
  can_publish 100 "${pw[100]}" 100/sensores && pass "100 new password works" || fail "100 new password works"
  mu del 1e2 >/dev/null 2>&1
  can_publish 100 "${pw[100]}" 100/sensores && pass "del 1e2 leaves 100" || fail "del 1e2 leaves 100"
  mu list | grep -qx 0100 && pass "del 1e2 leaves 0100 listed" || fail "del 1e2 leaves 0100 listed"
  mu list | grep -qx 1e2 && fail "1e2 gone after del" || pass "1e2 gone after del"
}
test_concurrent_adds() {
  local i before after
  before=$(mu list | wc -l)
  for i in 1 2 3 4 5 6 7 8; do mu add "esp_k$i" >/dev/null 2>&1 & done
  wait
  after=$(mu list | wc -l)
  [ $((after - before)) = 8 ] && pass "8 concurrent adds all land" || fail "concurrent adds lost updates ($before -> $after)"
}
test_reload_failure_keeps_password() {
  mkdir "$tmp/shim"
  real=$(command -v docker)
  printf '#!/bin/sh\n[ "$1" = kill ] && exit 1\nexec %s "$@"\n' "$real" >"$tmp/shim/docker"
  chmod +x "$tmp/shim/docker"
  local out rc
  out=$(PATH="$tmp/shim:$PATH" MQTT_CONTAINER=$broker bash "$script" add esp_h 2>/dev/null)
  rc=$?
  [ "$rc" = 1 ] && [ "${#out}" -ge 32 ] && pass "HUP failure: exit 1 and password still printed" \
    || fail "HUP failure handling (rc=$rc len=${#out})"
}
test_missing_container() {
  MQTT_CONTAINER=$run-nonexistent bash "$script" list >/dev/null 2>&1
  [ $? = 1 ] && pass "missing container exits 1" || fail "missing container exits 1"
}

for t in test_bootstrap_and_publish test_rotation test_del test_invalid_names test_service_names_accepted \
  test_numeric_looking_ids test_concurrent_adds test_reload_failure_keeps_password \
  test_list_no_hashes test_file_perms test_no_password_in_ps test_missing_container; do
  echo "--- $t"
  "$t"
done

[ "$fails" -eq 0 ] && echo "all tests passed" || echo "$fails test(s) failed"
exit $((fails > 0))
