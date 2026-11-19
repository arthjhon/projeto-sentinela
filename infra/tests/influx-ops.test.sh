#!/usr/bin/env bash
# shellcheck disable=SC2015,SC2317  # `cond && pass || fail` (pass never fails); trap fn
# Test for infra/bin/influx-bootstrap.sh and infra/bin/influx-backup.sh against a
# throwaway InfluxDB container (labelled like a compose service of a unique
# test project; anonymous volume removed with --rm). Needs docker + jq and
# image influxdb:2.7.12.
set -u

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
bin=$(cd "$here/../bin" && pwd)
readonly IMAGE=influxdb:2.7.12
project=s4t-ops-$$
ctr=$project-influxdb
tmp=$(mktemp -d)
fails=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; fails=$((fails + 1)); }
teardown() { docker rm -f -v "$ctr" >/dev/null 2>&1; rm -rf "$tmp"; }
trap teardown EXIT

admin="test-admin-$RANDOM$RANDOM$RANDOM"
docker run -d --rm --name "$ctr" \
  --label "com.docker.compose.project=$project" --label com.docker.compose.service=influxdb \
  -e DOCKER_INFLUXDB_INIT_MODE=setup -e DOCKER_INFLUXDB_INIT_USERNAME=admin \
  -e DOCKER_INFLUXDB_INIT_PASSWORD=test-password-123 -e DOCKER_INFLUXDB_INIT_ORG=sentinela \
  -e DOCKER_INFLUXDB_INIT_BUCKET=iot -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN="$admin" \
  "$IMAGE" >/dev/null || { echo "cannot start influxdb"; exit 1; }
for _ in $(seq 60); do
  docker exec "$ctr" influx ping >/dev/null 2>&1 && \
    INFLUX_TOKEN=$admin docker exec -e INFLUX_TOKEN "$ctr" influx bucket list --org sentinela >/dev/null 2>&1 && break
  sleep 1
done

printf 'INFLUX_ADMIN_TOKEN=%s\nOTHER=x\n' "$admin" >"$tmp/env"; chmod 600 "$tmp/env"
export SENTINELA_PROJECT=$project

# ---- bootstrap, first run ----------------------------------------------------
out1=$(SENTINELA_ENV_FILE="$tmp/env" bash "$bin/influx-bootstrap.sh" </dev/null 2>&1); rc=$?
[ "$rc" -eq 0 ] && pass "bootstrap run 1 exit 0" || fail "bootstrap run 1 (exit $rc): $out1"
[ "$(grep -c '^===== NEW TOKEN' <<<"$out1")" -eq 4 ] && pass "4 new tokens printed" || fail "new tokens: $out1"
[[ $out1 != *"$admin"* ]] && pass "admin token not printed" || fail "admin token printed"
tok() { awk -v d="'$1'" '$0 ~ "^===== NEW TOKEN " d {getline; print; exit}' <<<"$out1"; }
t_tel=$(tok telegraf); t_wrk=$(tok worker); t_ngx=$(tok nginx-publico); t_bak=$(tok backup)
[ -n "$t_tel" ] && [ -n "$t_wrk" ] && [ -n "$t_ngx" ] && [ -n "$t_bak" ] && pass "tokens parsed" || fail "token parse"

ix() { INFLUX_TOKEN=$admin docker exec -e INFLUX_TOKEN -e INFLUX_ORG=sentinela "$ctr" influx "$@"; }
buckets=$(ix bucket list --json)
for b in externos qualidade; do
  r=$(jq -r --arg n "$b" '[.[] | select(.name == $n)][0].retentionRules[0].everySeconds // "missing"' <<<"$buckets")
  [ "$r" = 0 ] && pass "bucket $b infinite" || fail "bucket $b retention: $r"
done
# auth list renders permissions as "<action>:orgs/<org>/buckets/<id>": map ids to names.
perms() {
  ix auth list --json | jq -c --arg d "$1" --argjson b "$buckets" '
    ($b | map({(.id): .name}) | add) as $names
    | [.[] | select(.description == $d) | .permissions[]
       | capture("^(?<a>[a-z]+):orgs/[0-9a-f]+/buckets/(?<id>[0-9a-f]+)$") | "\(.a):\($names[.id])"] | sort'
}
[ "$(perms telegraf)" = '["write:iot"]' ] && pass "telegraf perms" || fail "telegraf perms $(perms telegraf)"
[ "$(perms worker)" = '["read:iot","write:externos","write:qualidade"]' ] && pass "worker perms" || fail "worker perms $(perms worker)"
[ "$(perms nginx-publico)" = '["read:iot"]' ] && pass "nginx-publico perms" || fail "nginx perms $(perms nginx-publico)"

dbrp=$(ix v1 dbrp list --db iot --json | sed -n '/^\]/q;p')
[ "$(jq -r '[.[] | select(.database == "iot" and .retention_policy == "autogen" and .virtual == false and .default == true)] | length' <<<"$dbrp]" 2>/dev/null)" = 1 ] \
  && pass "explicit DBRP iot/autogen" || fail "dbrp: $dbrp"
[[ $out1 == *"dbrp iot/autogen: created"* ]] && pass "bootstrap run 1 created the DBRP" || fail "dbrp not created on run 1"

q() { INFLUX_TOKEN=$1 docker exec -e INFLUX_TOKEN -e INFLUX_ORG=sentinela "$ctr" influx query "from(bucket:\"$2\") |> range(start:-1m)" >/dev/null 2>&1; }
q "$t_ngx" iot && pass "nginx token reads iot" || fail "nginx token cannot read iot"
q "$t_ngx" qualidade && fail "nginx token reads qualidade" || pass "nginx token denied on qualidade"

# ---- bootstrap, second run (idempotent, prints no token) ------------------------
out2=$(SENTINELA_ENV_FILE="$tmp/env" bash "$bin/influx-bootstrap.sh" </dev/null 2>&1); rc=$?
[ "$rc" -eq 0 ] && pass "bootstrap run 2 exit 0" || fail "bootstrap run 2 (exit $rc): $out2"
grep -q 'NEW TOKEN' <<<"$out2" && fail "run 2 created tokens" || pass "run 2 created nothing"
leak=0; for t in "$admin" "$t_tel" "$t_wrk" "$t_ngx" "$t_bak"; do [[ $out2 == *"$t"* ]] && leak=1; done
[ "$leak" -eq 0 ] && pass "run 2 prints no existing token" || fail "run 2 leaked a token"
[ "$(grep -c ': exists' <<<"$out2")" -eq 7 ] && pass "run 2 reports 7 existing objects" || fail "run 2: $out2"
[ "$(ix auth list --json | jq length)" -eq 5 ] && pass "no duplicate tokens" || fail "duplicate tokens"

# ---- backup ---------------------------------------------------------------------
bdir=$tmp/backups; mkdir -m 700 "$bdir"
for i in 0 1 2 3 4 5 6 7; do mkdir "$bdir/2020010${i}T000000Z"; done
mkdir "$bdir/.partial-stale"; mkdir "$bdir/keep-me"
printf '%s\n' "$t_bak" >"$tmp/backup.token"; chmod 644 "$tmp/backup.token"
export SENTINELA_BACKUP_DIR=$bdir SENTINELA_BACKUP_TOKEN_FILE=$tmp/backup.token
out=$(bash "$bin/influx-backup.sh" 2>&1); rc=$?
[ "$rc" -ne 0 ] && [[ $out == *"must be mode 600"* ]] && pass "backup refuses token file 644" || fail "token mode check: $out"
chmod 600 "$tmp/backup.token"
out=$(bash "$bin/influx-backup.sh" 2>&1); rc=$?
[ "$rc" -eq 0 ] && pass "backup exit 0" || fail "backup (exit $rc): $out"
[[ $out != *"$t_bak"* ]] && pass "backup does not print token" || fail "backup printed token"
new=$(find "$bdir" -mindepth 1 -maxdepth 1 -type d -name '2026*' -o -mindepth 1 -maxdepth 1 -type d -name '20[3-9]*' | head -1)
if [ -n "$new" ] && (cd "$new" && sha256sum -c --quiet SHA256SUMS) && tar -tf "$new/influx-backup.tar" | grep -q '\.manifest$'; then
  pass "backup tar + checksum + manifest"
else fail "backup content in '$new'"; fi
n=$(find "$bdir" -mindepth 1 -maxdepth 1 -type d -regextype posix-extended -regex '.*/[0-9]{8}T[0-9]{6}Z' | wc -l)
[ "$n" -eq 7 ] && pass "retention keeps 7" || fail "retention: $n dirs"
[ ! -e "$bdir/20200100T000000Z" ] && [ ! -e "$bdir/20200101T000000Z" ] && [ -e "$bdir/20200102T000000Z" ] \
  && pass "oldest two removed" || fail "wrong dirs removed: $(ls "$bdir")"
[ ! -e "$bdir/.partial-stale" ] && [ -d "$bdir/keep-me" ] && pass "stale partial removed, foreign dir kept" || fail "cleanup scope"
docker exec "$ctr" sh -c 'ls /tmp | grep -q sentinela-backup' && fail "temp left in container" || pass "container temp cleaned"

echo
if [ "$fails" -eq 0 ]; then echo "ALL PASS"; else echo "$fails FAILED"; fi
exit "$fails"
