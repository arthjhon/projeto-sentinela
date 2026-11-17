#!/usr/bin/env bash
# shellcheck disable=SC2015,SC2317  # `cond && pass || fail` (pass never fails); trap fn
# Test for infra/bin/stack-deploy.sh, run as a normal user with local docker.
# Uses SENTINELA_DEPLOY_ROOT (test prefix) => compose project sentinela-stack-test.
# Volumes are project-scoped (sentinela-stack-test_*): the `name:` lines of the
# real compose (sentinela-influxdb-*) are stripped, so the workstation's real
# volumes are never touched. Needs: docker (compose v2), jq, images
# influxdb:2.7.12, telegraf:1.33.3, eclipse-mosquitto:2.0.22.
set -u

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)
script="$repo/infra/bin/stack-deploy.sh"
readonly PROJECT=sentinela-stack-test
readonly MOSQ_IMAGE=eclipse-mosquitto:2.0.22
tmp=$(mktemp -d)
R=$tmp/root
INC=$R/srv/sentinela/stack-incoming
LIVE=$R/srv/sentinela/stack
LOGF=$R/var/log/sentinela-stack-deploy.log
mosq=s4t-mosq-$$
fails=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; fails=$((fails + 1)); }

teardown() {
  docker rm -f "$mosq" >/dev/null 2>&1
  docker compose -p "$PROJECT" down --remove-orphans >/dev/null 2>&1
  # Explicit, test-only names (never `down -v`, never the real sentinela-influxdb-*).
  docker volume rm "${PROJECT}_influxdb-data" "${PROJECT}_influxdb-config" >/dev/null 2>&1
  docker network rm "${PROJECT}_default" >/dev/null 2>&1
  rm -rf "$tmp"
}
trap teardown EXIT
teardown_pre() {
  docker compose -p "$PROJECT" down --remove-orphans >/dev/null 2>&1
  docker volume rm "${PROJECT}_influxdb-data" "${PROJECT}_influxdb-config" >/dev/null 2>&1
}
teardown_pre

# ---- fixture tree ----------------------------------------------------------
mkdir -p "$INC/telegraf" "$LIVE" "$R/usr/local/sbin" "$R/usr/local/etc/sentinela" "$R/var/log" "$R/run"
chmod 755 "$R/srv/sentinela"
chmod 750 "$LIVE"
install -m 755 "$repo/infra/bin/validate-compose.sh" "$R/usr/local/sbin/validate-compose.sh"
install -m 644 "$repo/infra/stack/allowed-images" "$R/usr/local/etc/sentinela/allowed-images"

gw=$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}')
port=$((20000 + RANDOM % 9000))
docker run -d --name "$mosq" -p "$gw:$port:1883" "$MOSQ_IMAGE" \
  sh -c "printf 'listener 1883\nallow_anonymous true\n' > /tmp/m.conf; exec mosquitto -c /tmp/m.conf" >/dev/null \
  || { echo "cannot start test broker"; exit 1; }

admin_token="test-admin-token-$RANDOM$RANDOM$RANDOM"
# shellcheck disable=SC2016  # literal '$' on purpose
admin_pass='pa$sw0rd-test'   # '$' checks the render -> up round trip
cat >"$LIVE/.env" <<EOF
INFLUX_ADMIN_TOKEN=$admin_token
INFLUX_ADMIN_PASSWORD='$admin_pass'
INFLUX_TELEGRAF_TOKEN=$admin_token
MQTT_BROKER=tcp://$gw:$port
MQTT_TELEGRAF_USER=telegraf-test
MQTT_TELEGRAF_PASS=test-mqtt-pass-123
SUPABASE_NETWORK=
EOF
chmod 600 "$LIVE/.env"

# The real compose, minus fixed volume names (=> project-scoped test volumes)
# and on a test port.
base=$tmp/compose.base.yml
sed -e '/^    name: sentinela-influxdb-/d' -e 's/127\.0\.0\.1:8086:8086/127.0.0.1:18086:8086/' \
  "$repo/infra/stack/compose.yml" >"$base"
if grep -q 'sentinela-influxdb-' "$base"; then echo "test compose still names real volumes"; exit 1; fi
conf=$repo/infra/stack/telegraf/telegraf.conf

reset_incoming() { # <compose file> [telegraf.conf]
  rm -rf "$INC"
  mkdir -p "$INC/telegraf"
  cp "$1" "$INC/compose.yml"
  cp "${2:-$conf}" "$INC/telegraf/telegraf.conf"
}

run_deploy() { # <args...> -> sets out, rc
  out=$(SENTINELA_DEPLOY_ROOT="$R" bash "$script" "$@" 2>&1)
  rc=$?
}

live_sig() { # fingerprint of live state
  { cat "$LIVE/compose.yml" "$LIVE/telegraf/telegraf.conf" "$LIVE/DEPLOYED" 2>/dev/null
    docker ps -q --filter "label=com.docker.compose.project=$PROJECT" | sort; } | sha256sum
}

expect_rc() { # <name> <want-rc> <want-substring|->
  if [ "$rc" -ne "$2" ]; then fail "$1 (exit $rc, want $2): $out"
  elif [ "$3" != "-" ] && [[ $out != *"$3"* ]]; then fail "$1 (output lacks '$3'): $out"
  else pass "$1"; fi
}

# ---- bad arguments (nothing touched) ----------------------------------------
reset_incoming "$base"
for a in "" "foo" "NONE" "$(printf 'a%.0s' {1..41})" "$(printf 'A%.0s' {1..40})" "none;id" $'none\n'; do
  run_deploy "$a"
  expect_rc "bad arg $(printf '%q' "$a")" 2 "REJECTED"
done
run_deploy none none
expect_rc "two args" 2 "REJECTED"
run_deploy
expect_rc "no args" 2 "REJECTED"
[ ! -e "$LIVE/compose.yml" ] && pass "bad args left live empty" || fail "bad args touched live"

# ---- trust checks on root-side files ------------------------------------------
reset_incoming "$base"
chmod 775 "$R/usr/local/sbin/validate-compose.sh"
run_deploy none
expect_rc "group-writable validator refused" 1 "group/other writable"
chmod 755 "$R/usr/local/sbin/validate-compose.sh"
chmod 775 "$R/srv/sentinela"
run_deploy none
expect_rc "group-writable /srv/sentinela refused" 1 "group/other writable"
chmod 755 "$R/srv/sentinela"
chmod 640 "$LIVE/.env"
run_deploy none
expect_rc ".env not 600 refused" 1 "must be mode 600"
chmod 600 "$LIVE/.env"

# ---- incoming tree rejections (before first deploy) -------------------------
reset_incoming "$base"
ln -sf "$conf" "$INC/telegraf/telegraf.conf.tmp" && mv -T "$INC/telegraf/telegraf.conf.tmp" "$INC/telegraf/telegraf.conf"
run_deploy none
expect_rc "symlink in incoming" 1 "symlink not allowed"

reset_incoming "$base"
cp "$repo/infra/stack/.env.example" "$INC/.env.example"
run_deploy none
expect_rc "unexpected file" 1 "unexpected file"

reset_incoming "$base"
mkfifo "$INC/telegraf/pipe"
run_deploy none
expect_rc "fifo in incoming" 1 "special file not allowed"

reset_incoming "$base"
ln "$INC/compose.yml" "$tmp/hardlink"
run_deploy none
expect_rc "hardlinked file" 1 "hardlinked file"
rm -f "$tmp/hardlink"

reset_incoming "$base"
chmod g+s "$INC/compose.yml" 2>/dev/null; chmod u+s "$INC/compose.yml"
run_deploy none
expect_rc "setuid file" 1 "setuid/setgid/sticky"

reset_incoming "$base"
rm "$INC/telegraf/telegraf.conf"
run_deploy none
expect_rc "missing expected file" 1 "missing telegraf/telegraf.conf"

# ---- raw compose check ------------------------------------------------------
reset_incoming "$base"
sed -i 's/^    mem_limit: 128m/    mem_limit: 128m\n    env_file: \/etc\/hostname/' "$INC/compose.yml"
run_deploy none
expect_rc "env_file rejected (raw)" 1 "forbidden word"

reset_incoming "$base"
printf '    ? !!binary ZW52X2ZpbGU=\n    : /etc/hostname\n' >>"$INC/compose.yml"
run_deploy none
expect_rc "!!binary key rejected (raw)" 1 "YAML tags"

reset_incoming "$base"
printf '# include: elsewhere\n' >>"$INC/compose.yml"
run_deploy none
expect_rc "include (even in comment) rejected" 1 "forbidden word"
[ ! -e "$LIVE/compose.yml" ] && pass "rejections left live empty" || fail "rejection touched live"

# ---- happy path (first deploy) ----------------------------------------------
reset_incoming "$base"
run_deploy none
expect_rc "happy path: first deploy" 0 "result: deployed"
if [[ $(cat "$LIVE/DEPLOYED" 2>/dev/null) =~ ^[0-9T:-]+Z\ none$ ]]; then pass "DEPLOYED written (none)"; else fail "DEPLOYED: $(cat "$LIVE/DEPLOYED" 2>&1)"; fi
cmp -s "$LIVE/compose.yml" "$base" && cmp -s "$LIVE/telegraf/telegraf.conf" "$conf" \
  && pass "live files installed" || fail "live files differ from incoming"
[ "$(stat -c %a "$LIVE/telegraf/telegraf.conf")" = 644 ] && pass "telegraf.conf mode 644" || fail "telegraf.conf mode"
influx_id=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.service=influxdb)
[ "$(docker inspect -f '{{.State.Health.Status}}' "$influx_id" 2>/dev/null)" = healthy ] && pass "influxdb healthy" || fail "influxdb not healthy"
tele_id=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.service=telegraf)
[ "$(docker inspect -f '{{.State.Status}}' "$tele_id" 2>/dev/null)" = running ] && pass "telegraf running" || fail "telegraf not running"
if docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$influx_id" | grep -qxF "DOCKER_INFLUXDB_INIT_PASSWORD=$admin_pass"; then
  pass "'\$' in .env value survives render -> up"
else fail "INIT_PASSWORD changed by re-interpolation"; fi
if [[ $out == *"$admin_token"* ]] || grep -qF "$admin_token" "$LOGF" || grep -qF "test-mqtt-pass-123" "$LOGF"; then
  fail "secret leaked to stdout/log"
else pass "no secret in stdout/log"; fi
[ "$(stat -c %a "$LOGF")" = 600 ] && pass "log mode 600" || fail "log mode"
[ "$(stat -c %a "$LIVE/.deployed.json")" = 600 ] && pass ".deployed.json mode 600" || fail ".deployed.json mode"
[ -z "$(ls -A "$LIVE/.staging")" ] && pass "staging cleaned" || fail "staging left behind"

# ---- explicit sha, then none keeps it ---------------------------------------
sha=$(printf 'a%.0s' {1..40})
run_deploy "$sha"
expect_rc "deploy with sha" 0 "result: deployed"
grep -q " $sha\$" "$LIVE/DEPLOYED" && pass "DEPLOYED has sha" || fail "DEPLOYED: $(cat "$LIVE/DEPLOYED")"
grep -q ' none$' "$LIVE/.previous/DEPLOYED" && pass ".previous holds prior DEPLOYED" || fail ".previous missing"
run_deploy none
expect_rc "deploy none keeps tag" 0 "worker tag: $sha"
grep -q " $sha\$" "$LIVE/DEPLOYED" && pass "DEPLOYED still has sha" || fail "DEPLOYED lost sha"

# ---- validator DENY: nothing changes in live --------------------------------
[ -f "$LIVE/DEPLOYED" ] || fail "no live deployment before DENY tests"
before=$(live_sig)
reset_incoming "$base"
sed -i 's/^    mem_limit: 128m/    mem_limit: 128m\n    privileged: true/' "$INC/compose.yml"
run_deploy none
expect_rc "validator DENY (privileged)" 1 "validator: DENY: telegraf: privileged not allowed"
[ "$(live_sig)" = "$before" ] && pass "DENY left live unchanged" || fail "DENY changed live"

reset_incoming "$base"
sed -i 's#^      - influxdb-config:/etc/influxdb2#      - influxdb-config:/etc/influxdb2\n      - ./telegraf:/mnt/t#' "$INC/compose.yml"
run_deploy none
expect_rc "deploy policy DENY (rw bind under root)" 1 "bind source not allowed"
[ "$(live_sig)" = "$before" ] && pass "policy DENY left live unchanged" || fail "policy DENY changed live"

# ---- health failure -> rollback ---------------------------------------------
prev_compose=$(sha256sum <"$LIVE/compose.yml")
prev_deployed=$(cat "$LIVE/DEPLOYED")
bad=$tmp/compose.bad.yml
sed -e 's/test: \["CMD", "influx", "ping"\]/test: ["CMD", "false"]/' \
    -e 's/interval: 10s/interval: 2s/' -e 's/retries: 6/retries: 1/' -e 's/start_period: 15s/start_period: 0s/' \
    "$base" >"$bad"
grep -q '"CMD", "false"' "$bad" || fail "could not build failing healthcheck fixture"
conf2=$tmp/telegraf.conf
{ cat "$conf"; echo "# changed for the rollback test"; } >"$conf2"
reset_incoming "$bad" "$conf2"
run_deploy none
expect_rc "health failure -> rollback" 1 "result: failed, rolled back to previous"
[ -f "$LIVE/compose.yml" ] && [ "$(sha256sum <"$LIVE/compose.yml")" = "$prev_compose" ] && pass "live compose restored" || fail "live compose not restored"
cmp -s "$LIVE/telegraf/telegraf.conf" "$conf" && pass "live telegraf.conf restored" || fail "telegraf.conf not restored"
[ -n "$prev_deployed" ] && [ "$(cat "$LIVE/DEPLOYED")" = "$prev_deployed" ] && pass "DEPLOYED unchanged after rollback" || fail "DEPLOYED changed"
influx_id=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.service=influxdb)
[ "$(docker inspect -f '{{.State.Health.Status}}' "$influx_id" 2>/dev/null)" = healthy ] && pass "influxdb healthy after rollback" || fail "influxdb not healthy after rollback"
grep -q 'force-recreate (bind source changed): telegraf' "$LOGF" && pass "telegraf recreated on conf change" || fail "no telegraf recreate logged"

# ---- up succeeds but a service turns unhealthy -> health wait fails -> rollback
sed 's/^    mem_limit: 128m/    mem_limit: 128m\n    healthcheck:\n      test: ["CMD", "false"]\n      interval: 2s\n      retries: 1/' \
  "$base" >"$tmp/compose.unhealthy.yml"
reset_incoming "$tmp/compose.unhealthy.yml"
run_deploy none
expect_rc "unhealthy after up -> rollback" 1 "health: telegraf is unhealthy"
[[ $out == *"result: failed, rolled back to previous"* ]] && pass "rolled back after health wait" || fail "no rollback after health wait: $out"
[ "$(sha256sum <"$LIVE/compose.yml")" = "$prev_compose" ] && [ "$(cat "$LIVE/DEPLOYED")" = "$prev_deployed" ] \
  && pass "live + DEPLOYED restored after health wait" || fail "state not restored after health wait"
tele_id=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.service=telegraf)
[ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$tele_id" 2>/dev/null)" = none ] \
  && pass "telegraf back to previous definition" || fail "telegraf still has the failing healthcheck"

[ -n "${SHOW_LOG:-}" ] && { echo "--- deploy log"; cat "$LOGF"; }
echo
if [ "$fails" -eq 0 ]; then echo "ALL PASS"; else echo "$fails FAILED"; echo "--- deploy log tail"; tail -40 "$LOGF"; fi
exit "$fails"
