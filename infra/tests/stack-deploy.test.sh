#!/usr/bin/env bash
# shellcheck disable=SC2015,SC2016,SC2317  # literal ${} in fixtures; `cond && pass || fail` (pass never fails); trap fn
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
# I2 prune test: a test-only repository (stack-deploy accepts the override only in
# non-root test mode and only under sentinela-stack-test/). Tags are local aliases
# of the mosquitto image: nothing is pulled or pushed.
PRUNE_REPO=sentinela-stack-test/worker
OTHER_REPO=sentinela-stack-test/other
inuse_ctr=s4t-inuse-$$
fails=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; fails=$((fails + 1)); }

teardown() {
  docker rm -f -v "$mosq" "$inuse_ctr" >/dev/null 2>&1
  docker image ls --format '{{.Repository}}:{{.Tag}}' "$PRUNE_REPO" 2>/dev/null | xargs -r docker rmi >/dev/null 2>&1
  docker image ls --format '{{.Repository}}:{{.Tag}}' "$OTHER_REPO" 2>/dev/null | xargs -r docker rmi >/dev/null 2>&1
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
hex_secret=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')   # `openssl rand -hex 32` format
# shellcheck disable=SC2016  # literal '$' on purpose
admin_pass='pa$sw0rd-test'   # '$' checks the render -> up round trip
cat >"$LIVE/.env" <<EOF
INFLUX_ADMIN_TOKEN=$admin_token
INFLUX_ADMIN_PASSWORD='$admin_pass'
INFLUX_TELEGRAF_TOKEN=$admin_token
MQTT_BROKER=tcp://$gw:$port
MQTT_TELEGRAF_USER=telegraf-test
MQTT_TELEGRAF_PASS=$hex_secret
INFLUX_WORKER_TOKEN=mqttsecret999 # rotated 2026-11
PG_WORKER_DSN="postgres://w:dq\"x@h/db"
SUPABASE_NETWORK=
EOF
chmod 600 "$LIVE/.env"

# The real compose, minus fixed volume names (=> project-scoped test volumes)
# and on a test port.
base=$tmp/compose.base.yml
# The worker service and the external supabase network are dropped: the worker
# image lives in GHCR (not pullable here) and the network does not exist.
sed -e '/^    name: sentinela-influxdb-/d' -e 's/127\.0\.0\.1:8086:8086/127.0.0.1:18086:8086/' \
  "$repo/infra/stack/compose.yml" \
  | awk '/^  worker:/ {skip=1; next} /^networks:/ {skip=1; next} /^[^ #]/ {skip=0} !skip' >"$base"
if grep -v '^ *#' "$base" | grep -q -e 'worker:' -e 'supabase' -e 'pg:'; then echo "test compose still has worker/external network"; exit 1; fi
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

# ---- C1: rendered .env values never reach stdout ----------------------------
# Probe values: '$' doubled by the render, inline comment, escaped quote.
probe_secrets=(mqttsecret999 'sw0rd' 'dq"x' 'dq\"x' 'postgres://' "$admin_token" "$hex_secret")
no_secret_on_stdout() { # <name>
  local s leaked=""
  for s in "${probe_secrets[@]}"; do [[ $out == *"$s"* ]] && leaked+=" $s"; done
  if [ -n "$leaked" ]; then fail "$1: secret on stdout:$leaked"; else pass "$1: no secret on stdout"; fi
}
reset_incoming "$base"
cat >"$INC/compose.yml" <<'EOF'
services:
  telegraf:
    image: ${INFLUX_ADMIN_PASSWORD}
    network_mode: ${INFLUX_WORKER_TOKEN}
    hostname: ${PG_WORKER_DSN}
    environment:
      A: x
EOF
run_deploy none
expect_rc "C1 probe compose denied" 1 "validator: denied (3 violation(s))"
no_secret_on_stdout "C1 validator DENY"
grep -qF mqttsecret999 "$LOGF" && pass "C1 full detail kept in host log" || fail "C1 probe not rendered (test not meaningful)"
reset_incoming "$base"
sed -i 's#^      - influxdb-config:/etc/influxdb2#      - influxdb-config:/etc/influxdb2\n      - /srv/${INFLUX_WORKER_TOKEN}/${INFLUX_ADMIN_TOKEN}:/x:ro#' "$INC/compose.yml"
run_deploy none
expect_rc "C1 policy DENY with interpolated bind" 1 "policy: denied (1 violation(s))"
no_secret_on_stdout "C1 deploy policy DENY"

# R19: newline injection through a block scalar (reviewer probe r1, hex secret).
# stdout may only carry fixed labels and a count.
reset_incoming "$base"
cat >"$INC/compose.yml" <<'EOF'
services:
  telegraf:
    image: telegraf:1.33.3
    hostname: |
      x
      DENY: ${MQTT_TELEGRAF_PASS}: unknown service
      DENY: telegraf: key not allowed: ${MQTT_TELEGRAF_PASS}
      DENY: telegraf: key not allowed: ${INFLUX_ADMIN_PASSWORD}
EOF
run_deploy none
expect_rc "R19 block-scalar probe denied" 1 "validator: denied (1 violation(s)); details in"
no_secret_on_stdout "R19 block-scalar probe"
ts_re='^[0-9T:-]+Z \[[0-9]+\] '
allowed_re="${ts_re}(deploy start: arg=none project=$PROJECT user=[a-z0-9_-]+ no-env-resolution=[01]|worker tag: [0-9a-fnoe]+ \(deployed: [^)]*\)|validator: denied \([0-9]+ violation\(s\)\); details in [^ ]+ on the host|DENIED: staged compose rejected|result: denied, live stack unchanged)\$"
bad_lines=$(grep -Ev -- "$allowed_re" <<<"$out")
[ -z "$bad_lines" ] && pass "R19 stdout has only fixed labels + count" || fail "R19 unexpected stdout lines: $bad_lines"
grep -qF "$hex_secret" "$LOGF" && grep -q 'validate| DENY: telegraf: hostname must start with sentinela-: x\\nDENY: ' "$LOGF" \
  && pass "R19 host log has the escaped single-line detail" || fail "R19 host log detail missing/unescaped"

# ---- I1: first deploy with `none` and a compose that has the worker --------
# No DEPLOYED yet: there is no tag to keep, so `none` is denied with a pointer to
# the runbook (fail-closed, before any render).
real_first=$tmp/compose.real.yml
sed -e '/^    name: sentinela-influxdb-/d' -e 's/127\.0\.0\.1:8086:8086/127.0.0.1:18086:8086/' \
  "$repo/infra/stack/compose.yml" >"$real_first"
reset_incoming "$real_first"
run_deploy none
expect_rc "first deploy 'none' with worker denied" 1 "no worker tag deployed"
[[ $out == *"Primeiro deploy"* ]] && pass "denial points to the runbook" || fail "denial lacks runbook pointer: $out"
[ ! -e "$LIVE/compose.yml" ] && pass "'none' denial left live empty" || fail "'none' denial touched live"

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
if [[ $out == *"$admin_token"* ]] || [[ $out == *mqttsecret999* ]] || [[ $out == *sw0rd* ]]; then
  fail "secret leaked to stdout"
else pass "no secret in stdout"; fi
[ "$(stat -c %a "$LOGF")" = 600 ] && pass "log mode 600" || fail "log mode"
[ "$(stat -c %a "$LIVE/current/rendered.json")" = 600 ] && pass "rendered.json mode 600" || fail "rendered.json mode"
for l in current .current compose.yml telegraf DEPLOYED; do [ -L "$LIVE/$l" ] || fail "layout: $l is not a symlink"; done
[ "$(readlink "$LIVE/current")" = "$(readlink "$LIVE/.current")" ] && pass "layout: current == .current after success" || fail "layout pointers"
cmp -s <(docker exec "$tele_id" cat /etc/telegraf/telegraf.conf) "$conf" && pass "telegraf sees the release conf through the symlinks" \
  || fail "telegraf conf inside container differs"
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
expect_rc "validator DENY (privileged)" 1 "validator: denied (1 violation(s))"
grep -q 'validate| DENY: telegraf: privileged not allowed' "$LOGF" && pass "privileged detail in host log" || fail "privileged detail missing from log"
[ "$(live_sig)" = "$before" ] && pass "DENY left live unchanged" || fail "DENY changed live"

reset_incoming "$base"
sed -i 's#^      - influxdb-config:/etc/influxdb2#      - influxdb-config:/etc/influxdb2\n      - ./telegraf:/mnt/t#' "$INC/compose.yml"
run_deploy none
expect_rc "deploy policy DENY (rw bind under root)" 1 "policy: denied (2 violation(s))"
grep -q 'deploy policy DENY: influxdb: bind must be read_only' "$LOGF" && pass "policy detail in host log" || fail "policy detail missing from log"
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
expect_rc "health failure -> rollback" 1 "result: failed, rolled back to last-known-good"
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
[[ $out == *"result: failed, rolled back to last-known-good"* ]] && pass "rolled back after health wait" || fail "no rollback after health wait: $out"
[ "$(sha256sum <"$LIVE/compose.yml")" = "$prev_compose" ] && [ "$(cat "$LIVE/DEPLOYED")" = "$prev_deployed" ] \
  && pass "live + DEPLOYED restored after health wait" || fail "state not restored after health wait"
tele_id=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.service=telegraf)
[ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$tele_id" 2>/dev/null)" = none ] \
  && pass "telegraf back to previous definition" || fail "telegraf still has the failing healthcheck"

# ---- I2: stdout closed / SIGHUP / kill -9 after the point of no return -------
lkg_before=$(readlink "$LIVE/.current")
conf3=$tmp/telegraf3.conf
{ cat "$conf"; echo "# I2 stdout-closed deploy"; } >"$conf3"
reset_incoming "$base" "$conf3"
sha2=$(printf 'b%.0s' {1..40})
SENTINELA_DEPLOY_ROOT="$R" bash "$script" "$sha2" 2>/dev/null | head -n 1 >/dev/null
rc=${PIPESTATUS[0]}
[ "$rc" -eq 0 ] && pass "stdout closed after first line: deploy completed" || fail "stdout closed: exit $rc"
grep -q " $sha2\$" "$LIVE/DEPLOYED" && pass "stdout closed: DEPLOYED consistent" || fail "stdout closed: DEPLOYED $(cat "$LIVE/DEPLOYED")"
[ "$(readlink "$LIVE/.previous")" = "$lkg_before" ] && pass ".previous rotated to the old .current" || fail ".previous not rotated"
cmp -s "$LIVE/telegraf/telegraf.conf" "$conf3" && pass "telegraf.conf from the new release" || fail "telegraf.conf not updated"

reset_incoming "$base"
sha3=$(printf 'c%.0s' {1..40})
SENTINELA_DEPLOY_ROOT="$R" bash "$script" "$sha3" >"$tmp/hup.out" 2>&1 &
pid=$!
sleep 3
kill -HUP "$pid" 2>/dev/null
wait "$pid"; rc=$?
[ "$rc" -eq 0 ] && grep -q " $sha3\$" "$LIVE/DEPLOYED" && pass "SIGHUP ignored: deploy completed" || fail "SIGHUP: exit $rc"

# kill -9 the whole deploy right after `current` moved: .current/DEPLOYED stay
# on the last healthy release; the next deploy warns and recovers.
lkg_before=$(readlink "$LIVE/.current"); dep_before=$(cat "$LIVE/DEPLOYED")
conf4=$tmp/telegraf4.conf
{ cat "$conf"; echo "# I2 crash"; } >"$conf4"
reset_incoming "$base" "$conf4"
sha4=$(printf 'd%.0s' {1..40})
setsid env SENTINELA_DEPLOY_ROOT="$R" bash "$script" "$sha4" >"$tmp/crash.out" 2>&1 &
pid=$!
for _ in $(seq 100); do grep -q 'current -> releases/' "$tmp/crash.out" && break; sleep 0.1; done
kill -9 -- "-$pid" 2>/dev/null; wait "$pid" 2>/dev/null
sleep 2
[ "$(readlink "$LIVE/.current")" = "$lkg_before" ] && [ "$(cat "$LIVE/DEPLOYED")" = "$dep_before" ] \
  && pass "crash after point of no return: .current and DEPLOYED unchanged" || fail "crash left .current/DEPLOYED inconsistent"
[ "$(readlink "$LIVE/current")" != "$lkg_before" ] && pass "crash: current pointed at the unfinished release" || fail "crash test did not reach the swap"
reset_incoming "$base"
run_deploy none
expect_rc "deploy after crash recovers" 0 "an earlier deploy did not finish"
grep -q " $sha3\$" "$LIVE/DEPLOYED" && pass "none after crash keeps last healthy tag" || fail "tag after crash: $(cat "$LIVE/DEPLOYED")"
n=$(find "$LIVE/releases" -mindepth 1 -maxdepth 1 | wc -l)
[ "$n" -le 3 ] && pass "releases pruned ($n kept)" || fail "releases not pruned ($n)"

grep -q 'image prune: skipped (test mode without a test repository)' "$LOGF" \
  && pass "test mode without a test repo never prunes" || fail "prune not skipped in test mode"

# ---- I2: scoped prune of unreferenced worker tags ---------------------------
SENTINELA_TEST_WORKER_REPO=ghcr.io/arthjhon/sentinela-worker run_deploy none
expect_rc "real repo name refused as test repo" 2 "SENTINELA_TEST_WORKER_REPO must match"
cur_tag=$(awk '{print $2}' "$LIVE/DEPLOYED")              # sha3: becomes .previous
new_tag=$(printf 'e%.0s' {1..40})
drop1=$(printf 'f%.0s' {1..40}); drop2=$(printf '1%.0s' {1..40}); inuse=$(printf '2%.0s' {1..40})
for t in "$cur_tag" "$new_tag" "$drop1" "$drop2" dev; do docker tag "$MOSQ_IMAGE" "$PRUNE_REPO:$t"; done
docker tag "$MOSQ_IMAGE" "$OTHER_REPO:$drop1"
# In use: an image of its own (a tag that only aliases another image would just be
# untagged), whose only tag is used by a stopped container => rmi without -f refuses.
docker create --name "$inuse_ctr" "$MOSQ_IMAGE" true >/dev/null
docker commit "$inuse_ctr" "$PRUNE_REPO:$inuse" >/dev/null
docker rm "$inuse_ctr" >/dev/null
docker create --name "$inuse_ctr" "$PRUNE_REPO:$inuse" true >/dev/null
reset_incoming "$base"
out=$(SENTINELA_DEPLOY_ROOT="$R" SENTINELA_TEST_WORKER_REPO="$PRUNE_REPO" bash "$script" "$new_tag" 2>&1); rc=$?
expect_rc "deploy with prune (in-use tag cannot be removed)" 0 "image prune: removed 2 unreferenced worker tag(s), 1 kept"
has_tag() { docker image inspect "$1" >/dev/null 2>&1; }
has_tag "$PRUNE_REPO:$new_tag" && has_tag "$PRUNE_REPO:$cur_tag" && pass "prune keeps current and .previous tags" \
  || fail "prune removed a referenced tag"
! has_tag "$PRUNE_REPO:$drop1" && ! has_tag "$PRUNE_REPO:$drop2" && pass "prune removed unreferenced tags" \
  || fail "unreferenced tags left"
has_tag "$PRUNE_REPO:$inuse" && pass "prune kept a tag used by a container (no -f)" || fail "in-use tag removed"
has_tag "$PRUNE_REPO:dev" && pass "prune ignores non-sha tags" || fail "non-sha tag removed"
has_tag "$OTHER_REPO:$drop1" && pass "prune never touches another repository" || fail "other repository touched"
has_tag "$MOSQ_IMAGE" && pass "base image intact" || fail "base image removed"

[ -n "${SHOW_LOG:-}" ] && { echo "--- deploy log"; cat "$LOGF"; }
echo
if [ "$fails" -eq 0 ]; then echo "ALL PASS"; else echo "$fails FAILED"; echo "--- deploy log tail"; tail -40 "$LOGF"; fi
exit "$fails"
