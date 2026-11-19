#!/bin/bash
# One-off, idempotent InfluxDB bootstrap (Arthur runs it as root on the VM,
# after the first stack deploy). Creates what is missing, skips what exists:
#
#   buckets  externos, qualidade        (infinite retention; iot comes from setup)
#   dbrp     iot -> iot/autogen         (InfluxQL v1 mapping used by the /influx/
#                                        proxy; 2.7 also maps it virtually, the
#                                        explicit mapping is kept for other versions)
#   tokens   telegraf       write iot
#            worker         read iot; write externos, qualidade
#            nginx-publico  read iot
#            backup         operator (influx backup needs it; used only by the
#                           influx-backup timer, never by the worker)
#
#   sudo /usr/local/sbin/influx-bootstrap.sh
#
# Tokens are identified by their description. A NEW token is printed once,
# with a label saying where it goes; an existing token is never printed (to
# rotate one, see infra/README.md).
#
# Admin token source (never on argv): env INFLUX_ADMIN_TOKEN, else
# INFLUX_ADMIN_TOKEN parsed from $SENTINELA_ENV_FILE (default
# /srv/sentinela/stack/.env), else a no-echo prompt. It reaches the container as
# `docker exec -e INFLUX_TOKEN` (inherited from this process, not on argv).
# Container: the running service `influxdb` of compose project
# $SENTINELA_PROJECT (default sentinela-stack), or $SENTINELA_INFLUX_CONTAINER.
set -uo pipefail
umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

readonly ORG=sentinela
readonly ENV_FILE=${SENTINELA_ENV_FILE:-/srv/sentinela/stack/.env}
readonly PROJECT=${SENTINELA_PROJECT:-sentinela-stack}

die() { echo "influx-bootstrap: $*" >&2; exit 1; }
command -v jq >/dev/null || die "jq not found"
command -v docker >/dev/null || die "docker not found"

# ---- admin token -------------------------------------------------------------
token=${INFLUX_ADMIN_TOKEN:-}
unset INFLUX_ADMIN_TOKEN
if [ -z "$token" ] && [ -r "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ $line =~ ^[[:space:]]*(export[[:space:]]+)?INFLUX_ADMIN_TOKEN[[:space:]]*=(.*)$ ]]; then
      token=${BASH_REMATCH[2]}
    fi
  done <"$ENV_FILE"
  token=${token%$'\r'}
  if [[ $token =~ ^\"(.*)\"$ ]] || [[ $token =~ ^\'(.*)\'$ ]]; then token=${BASH_REMATCH[1]}; fi
fi
if [ -z "$token" ]; then
  [ -t 0 ] || die "no admin token (env INFLUX_ADMIN_TOKEN, $ENV_FILE or a terminal prompt)"
  read -r -s -p "InfluxDB admin token: " token
  echo
fi
[ -n "$token" ] || die "empty admin token"

# ---- container ---------------------------------------------------------------
ctr=${SENTINELA_INFLUX_CONTAINER:-}
if [ -z "$ctr" ]; then
  ids=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" \
    --filter label=com.docker.compose.service=influxdb --filter status=running)
  [ -n "$ids" ] || die "no running influxdb container in project $PROJECT"
  [ "$(printf '%s\n' "$ids" | wc -l)" -eq 1 ] || die "more than one influxdb container in project $PROJECT"
  ctr=$ids
fi

# influx <args...>: CLI inside the container; token via env, JSON output.
influx() {
  INFLUX_TOKEN=$token docker exec -e INFLUX_TOKEN -e INFLUX_ORG="$ORG" "$ctr" influx "$@" --json
}

buckets=$(influx bucket list) || die "cannot list buckets (wrong admin token or InfluxDB down)"
bucket_id() { jq -r --arg n "$1" '[.[] | select(.name == $n)][0].id // empty' <<<"$buckets"; }

[ -n "$(bucket_id iot)" ] || die "bucket iot missing (expected from DOCKER_INFLUXDB_INIT_BUCKET)"
for b in externos qualidade; do
  if [ -n "$(bucket_id "$b")" ]; then
    echo "bucket $b: exists"
  else
    influx bucket create --name "$b" --retention 0 >/dev/null || die "cannot create bucket $b"
    echo "bucket $b: created (infinite retention)"
  fi
done
buckets=$(influx bucket list) || die "cannot list buckets"
iot=$(bucket_id iot)
externos=$(bucket_id externos)
qualidade=$(bucket_id qualidade)
for b in iot externos qualidade; do
  ret=$(jq -r --arg n "$b" '[.[] | select(.name == $n)][0].retentionRules[0].everySeconds // 0' <<<"$buckets")
  [ "$ret" = 0 ] || echo "WARNING: bucket $b retention is ${ret}s (expected infinite)"
done

# Explicit DBRP for the InfluxQL proxy (db=iot). Create; a 422 "another DBRP
# mapping ... exists" means it is already there.
if out=$(influx v1 dbrp create --db iot --rp autogen --bucket-id "$iot" --default 2>&1); then
  echo "dbrp iot/autogen: created"
elif [[ $out == *"another DBRP mapping"* ]]; then
  echo "dbrp iot/autogen: exists"
else
  die "cannot create DBRP for iot: $out"
fi

# Descriptions only; the list (which contains tokens) never leaves this process.
auths=$(influx auth list | jq -c '[.[] | {description, status}]') || die "cannot list tokens"

# ensure_token <description> <destination hint> <create args...>
ensure_token() {
  local desc=$1 dest=$2 out tok
  shift 2
  if jq -e --arg d "$desc" 'any(.[]; .description == $d)' <<<"$auths" >/dev/null; then
    echo "token $desc: exists (not shown; to rotate, see infra/README.md)"
    return 0
  fi
  out=$(influx auth create --description "$desc" "$@") || die "cannot create token $desc"
  tok=$(jq -r '.token // empty' <<<"$out")
  [ -n "$tok" ] || die "token $desc created but not returned"
  echo
  echo "===== NEW TOKEN '$desc' (shown once) -> $dest ====="
  printf '%s\n' "$tok"
  echo "===== END '$desc' ====="
  echo
}

ensure_token telegraf "INFLUX_TELEGRAF_TOKEN in /srv/sentinela/stack/.env" \
  --write-bucket "$iot"
ensure_token worker "INFLUX_WORKER_TOKEN in /srv/sentinela/stack/.env" \
  --read-bucket "$iot" --write-bucket "$externos" --write-bucket "$qualidade"
# shellcheck disable=SC2016  # literal nginx variable in the hint
ensure_token nginx-publico '/etc/nginx/sentinela-influx-token.conf as: set $influx_token "<token>";' \
  --read-bucket "$iot"
ensure_token backup "/usr/local/etc/sentinela/influx-backup.token (root 600)" \
  --operator

echo "done."
