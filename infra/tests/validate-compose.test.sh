#!/usr/bin/env bash
# Test for infra/bin/validate-compose.sh. Needs docker (compose v2) + jq.
# Each fixture is rendered with `docker compose config --format json` using a
# temp --project-directory (relative binds resolve under it) and the validator
# is told that dir is ALLOWED_BIND_ROOT.
set -u

readonly SHELLCHECK_IMAGE="koalaman/shellcheck:v0.10.0"
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
script="$here/../bin/validate-compose.sh"
fx="$here/fixtures"
allowed="$fx/allowed-images"
tmp=$(mktemp -d)
fails=0
trap 'rm -rf "$tmp"' EXIT

export ALLOWED_BIND_ROOT="$tmp/proj"
export SUPABASE_NETWORK="sentinela-pg"
mkdir -p "$ALLOWED_BIND_ROOT"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; fails=$((fails + 1)); }

render() { # <compose file> <out json>
  docker compose -p "${RENDER_PROJECT:-sentinela-stack}" --project-directory "$ALLOWED_BIND_ROOT" -f "$1" config --format json >"$2"
}

# expect <name> <want-exit> <want-substring|-> <json> [allowed-file]
expect() {
  local name=$1 want=$2 sub=$3 json=$4 af=${5:-$allowed} out rc
  out=$(bash "$script" "$json" "$af" 2>&1)
  rc=$?
  if [ "$rc" -ne "$want" ]; then
    fail "$name (exit $rc, want $want): $out"
  elif [ "$sub" != "-" ] && [[ $out != *"$sub"* ]]; then
    fail "$name (output lacks '$sub'): $out"
  else
    pass "$name"
  fi
}

# fixture <file-name-without-ext> <want-exit> <substring>
fixture() {
  local j="$tmp/$1.json"
  if ! render "$fx/$1.yml" "$j"; then fail "$1 (docker compose config failed)"; return; fi
  expect "$1" "$2" "$3" "$j"
}

if [ ! -f "$script" ]; then fail "validator missing: $script"; fi

fixture ok 0 "OK"
fixture privileged 1 "privileged"
fixture cap_add 1 "cap_add"
fixture devices 1 "devices"
fixture host_network 1 "network_mode"
fixture netmode_service 1 "network_mode"
fixture pid_host 1 "pid"
fixture ipc_host 1 "ipc"
fixture userns_host 1 "userns_mode"
fixture docker_sock 1 "docker.sock"
fixture docker_sock_long 1 "docker.sock"
fixture bind_outside 1 "bind outside $ALLOWED_BIND_ROOT"
fixture bind_sibling 1 "bind outside $ALLOWED_BIND_ROOT"
fixture bind_traversal 1 "bind outside $ALLOWED_BIND_ROOT"
fixture foreign_image 1 "image not allowed"
fixture image_latest 1 "image not allowed"
fixture image_notag 1 "image not allowed"
fixture worker_bad_tag 1 "image not allowed"
fixture extra_service 1 "unknown service"
fixture telegraf_extra_mount 1 "telegraf extra mount"
fixture volumes_from 1 "volumes_from"
fixture cgroup_parent 1 "cgroup_parent"
fixture sysctls 1 "sysctls"
fixture port_public 1 "port"
fixture port_all 1 "port"
fixture secopt_unconfined 1 "security_opt"
fixture secopt_nnp_false 1 "security_opt"
fixture secopt_label 1 "security_opt"
fixture foreign_network 1 "network"
fixture worker_digest 0 "OK"
fixture deploy_ok 0 "OK"
fixture vol_adopt 1 "volume name must be"
fixture net_host_name 1 "network name"
fixture net_other_project 1 "network name must be"
fixture deploy_gpu 1 "deploy"
fixture logging_syslog 1 "logging driver"
fixture alias_external 1 "attachment options not allowed"
fixture container_name 1 "container_name"
fixture ipam 1 "ipam"
fixture label_docker 1 "label not allowed"
fixture external_ok 0 "OK"
fixture external_no_capdrop 1 "cap_drop"
# C1 (R30): only the worker may join the external (sentinela-pg) network.
fixture external_influxdb 1 "influxdb: only service worker may join an external network"
fixture external_telegraf 1 "telegraf: only service worker may join an external network"
fixture hostname_db 1 "hostname must start"
fixture hostname_kong 1 "hostname must start"
fixture domainname 1 "must start with sentinela-"
fixture mac_external 1 "attachment options not allowed"
fixture attach_driver_opts 1 "attachment options not allowed"
fixture vol_sentinela_dev 1 "volume name must be"
fixture vol_other_project 1 "volume name must be"
fixture logging_opts_nodriver 1 "logging.options"
fixture net_vol_labels 1 "com.docker"
# Newline injection through a block scalar: one escaped DENY line, nothing forged.
if render "$fx/hostname_newline.yml" "$tmp/hostname_newline.json"; then
  out=$(bash "$script" "$tmp/hostname_newline.json" "$allowed" 2>&1); rc=$?
  if [ "$rc" -eq 1 ] && [ "$(wc -l <<<"$out")" -eq 1 ] && [[ $out == 'DENY: telegraf: hostname must start with sentinela-: x\nDENY: forged'* ]]; then
    pass "hostname_newline (single escaped DENY line)"
  else
    fail "hostname_newline (exit $rc): $out"
  fi
else
  fail "hostname_newline (docker compose config failed)"
fi

# C3: a free project name (rendered without -p) must be refused.
RENDER_PROJECT=supabase fixture project_name 1 "project name must be"

# Several violations are all reported, not just the first.
cat >"$tmp/multi.json" <<'JSON'
{"services":{"influxdb":{"image":"influxdb:2.7.12","privileged":true,"cap_add":["ALL"]}}}
JSON
out=$(bash "$script" "$tmp/multi.json" "$allowed" 2>&1)
n=$(grep -c '^DENY: influxdb: ' <<<"$out")
if [ "$n" -ge 2 ]; then pass "multiple violations reported"; else fail "multiple violations reported: $out"; fi

# Top-level volume tricks: local driver bind-mounting the host, and secrets from host files.
cat >"$tmp/vol.json" <<'JSON'
{"services":{"influxdb":{"image":"influxdb:2.7.12","volumes":[{"type":"volume","source":"v","target":"/x","volume":{}}]}},
 "volumes":{"v":{"driver":"local","driver_opts":{"type":"none","o":"bind","device":"/etc"}}}}
JSON
expect "volume driver_opts bind" 1 "volumes.v" "$tmp/vol.json"
cat >"$tmp/secret.json" <<JSON
{"services":{"influxdb":{"image":"influxdb:2.7.12"}},"secrets":{"s":{"file":"/etc/shadow"}}}
JSON
expect "secret from host file" 1 "secrets/configs.s" "$tmp/secret.json"
cat >"$tmp/unk.json" <<'JSON'
{"services":{"influxdb":{"image":"influxdb:2.7.12","some_future_key":{"a":1}}}}
JSON
expect "unknown service key" 1 "some_future_key" "$tmp/unk.json"
cat >"$tmp/netlist.json" <<'JSON'
{"services":{"influxdb":{"image":"influxdb:2.7.12","networks":["pg"]}},"networks":{"pg":{"external":true,"name":"sentinela-pg"}}}
JSON
expect "non-map service networks" 1 "networks must be a map" "$tmp/netlist.json"

# Regex anchors: a trailing newline in the tag must not slip past `$`.
printf '%s\n' '{"services":{"worker":{"image":"ghcr.io/arthjhon/sentinela-worker:0123456789abcdef0123456789abcdef01234567\n"}}}' >"$tmp/nl.json"
expect "image with trailing newline" 1 "image not allowed" "$tmp/nl.json"
cat >"$tmp/prop.json" <<JSON
{"services":{"influxdb":{"image":"influxdb:2.7.12","volumes":[{"type":"bind","source":"$ALLOWED_BIND_ROOT/a","target":"/x","bind":{"propagation":"rshared"}}]}}}
JSON
expect "bind propagation" 1 "propagation" "$tmp/prop.json"

# Fail closed on bad input: exit 2, never 0.
: >"$tmp/empty.json"
echo '{not json' >"$tmp/bad.json"
echo '{}' >"$tmp/noservices.json"
echo '{"services":{}}' >"$tmp/emptyservices.json"
echo '[]' >"$tmp/array.json"
echo '{"services":"x"}' >"$tmp/svcstr.json"
echo '{"services":{"influxdb":"x"}}' >"$tmp/svcval.json"
expect "empty json" 2 "-" "$tmp/empty.json"
expect "malformed json" 2 "-" "$tmp/bad.json"
expect "no services" 2 "-" "$tmp/noservices.json"
expect "empty services" 2 "-" "$tmp/emptyservices.json"
expect "array json" 2 "-" "$tmp/array.json"
expect "services not object" 2 "-" "$tmp/svcstr.json"
expect "service not object" 2 "-" "$tmp/svcval.json"
expect "missing json file" 2 "-" "$tmp/nope.json"
expect "missing allowed file" 2 "-" "$tmp/multi.json" "$tmp/nope-allowed"
bash "$script" >/dev/null 2>&1; rc=$?
if [ "$rc" -eq 2 ]; then pass "no args"; else fail "no args (exit $rc)"; fi
bash "$script" "$tmp/multi.json" >/dev/null 2>&1; rc=$?
if [ "$rc" -eq 2 ]; then pass "one arg"; else fail "one arg (exit $rc)"; fi
(ALLOWED_BIND_ROOT="relative/path" bash "$script" "$tmp/multi.json" "$allowed" >/dev/null 2>&1); rc=$?
if [ "$rc" -eq 2 ]; then pass "relative ALLOWED_BIND_ROOT rejected"; else fail "relative ALLOWED_BIND_ROOT (exit $rc)"; fi

# Real production compose, dummy env, real allowed-images: must be OK.
real="$here/../stack/compose.yml"
if INFLUX_ADMIN_PASSWORD=x INFLUX_ADMIN_TOKEN=x INFLUX_TELEGRAF_TOKEN=x MQTT_BROKER=tcp://h:1883 \
  MQTT_TELEGRAF_USER=u MQTT_TELEGRAF_PASS=p INFLUX_WORKER_TOKEN=x PG_WORKER_DSN=postgres://x \
  WORKER_TAG=0123456789abcdef0123456789abcdef01234567 render "$real" "$tmp/real.json"; then
  expect "real infra/stack/compose.yml" 0 "OK" "$tmp/real.json" "$here/../stack/allowed-images"
else
  fail "real compose failed to render"
fi

# Static analysis, pinned image.
if docker run --rm -v "$here/..:/mnt:ro" -w /mnt "$SHELLCHECK_IMAGE" bin/validate-compose.sh tests/validate-compose.test.sh; then
  pass "shellcheck"
else
  fail "shellcheck"
fi

echo
if [ "$fails" -eq 0 ]; then echo "ALL PASS"; else echo "$fails FAILED"; exit 1; fi
