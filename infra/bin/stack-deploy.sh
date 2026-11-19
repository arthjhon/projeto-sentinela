#!/bin/bash
# Root deploy of the Sentinela data stack (InfluxDB + Telegraf + Mosquitto [+ worker]).
#
#   stack-deploy.sh <none|40-hex-worker-sha>
#
# Invoked by CI through a forced-command SSH key + a sudoers rule that allows
# only this script. CI never controls anything here except:
#   - the files it rsynced into $INCOMING (exactly EXPECTED_FILES), and
#   - the single argument (worker image tag; `none` keeps the deployed one).
#
# Live layout ($LIVE = /srv/sentinela/stack, root 750, only root writes):
#   .env                         root 600, never touched here
#   releases/<id>/               one immutable dir per deploy attempt:
#     compose.yml  telegraf/telegraf.conf  mosquitto/mosquitto.conf  mosquitto/acl
#     rendered.json (validated, 600)
#     DEPLOYED                   "<iso-time> <sha|none>", written only once healthy
#   current  -> releases/<id>    what was last started (moved by one rename)
#   .current -> releases/<id>    last-known-good: moved only after the health check
#   .previous -> releases/<id>   the last-known-good before that
#   compose.yml -> current/compose.yml, telegraf -> current/telegraf,
#   mosquitto -> current/mosquitto (static links; the bind paths
#                                $LIVE/telegraf/telegraf.conf, $LIVE/mosquitto/mosquitto.conf
#                                and $LIVE/mosquitto/acl stay fixed while `current` flips
#                                every file at once)
#   DEPLOYED -> .current/DEPLOYED
# Every pointer change is an atomic rename of a symlink: a crash at any point
# leaves .current/DEPLOYED naming a release that was healthy.
#
# Sequence (any failure before "point of no return" leaves live untouched):
#   1. argument check, trust checks, flock, log
#   2. incoming tree check: only EXPECTED_FILES/EXPECTED_DIRS, regular files,
#      nlink 1, no setuid/setgid/sticky, <= MAX_FILE_BYTES; no symlink, device,
#      fifo or socket anywhere
#   3. copy into a fresh root-owned staging dir under $LIVE/.staging, reading
#      each file with the privileges of $DEPLOY_USER (a symlink/hardlink swapped
#      in after step 2 can only reach what the deploy user could read anyway);
#      re-check the staged tree
#   4. raw compose check (strict, text level): ASCII only, no '\' (YAML escape)
#      and no '!' (YAML tag, e.g. !!binary), none of the words env_file,
#      label_file, include, extends. These make `docker compose config` read
#      host files as root at render time and inline them (env_file content is
#      dropped into `environment`, invisible to the validator).
#   5. render ONCE under `env -i` (PATH, HOME, WORKER_TAG only) with
#      `docker compose -p $PROJECT --project-directory $LIVE --env-file $LIVE/.env
#       -f <staged compose> config --format json [--no-env-resolution]` into a
#      root-only file. `--no-env-resolution` is used when the installed compose
#      supports it (then an env_file would survive as a key and be denied).
#   6. deploy-side policy on the JSON (stricter than the validator): no
#      env_file/label_file keys; every bind mount and secrets/configs file
#      source must be one of the live EXPECTED_FILES, bind mounts read_only.
#   7. root-installed validator ($VALIDATOR) on the same JSON
#   8. `pull` of the validated JSON (failure = nothing changed)
#   -- point of no return --
#   9. staged dir renamed to releases/<id>; `current` flipped to it
#  10. `up -d --remove-orphans` from the validated JSON (validated == executed),
#      force-recreate services whose bind content changed (a running container
#      keeps the old inode otherwise)
#  11. wait up to HEALTH_TIMEOUT s for every service: running, healthy when it
#      has a healthcheck, restart count stable over two polls; `unhealthy` = fail
#  12. OK -> write releases/<id>/DEPLOYED, .previous -> old .current,
#      .current -> releases/<id>. Fail -> `current` back to .current (re-rendered
#      and re-validated against the current policy and .env), `up` it, exit 1.
#  13. OK only: remove local tags of $WORKER_REPO (and nothing else) that no
#      release in current/.current/.previous names; `docker rmi` without -f, so an
#      image a container still uses stays. A pruning failure never fails the deploy.
#
# `none` keeps the deployed worker tag. With no deployed tag yet (first deploy)
# and a compose that references WORKER_TAG, `none` is denied before any render:
# the first deploy must name a 40-hex sha whose image is already in GHCR.
#
# Output: stdout (what CI sees) carries only fixed labels, counts, service names
# from the fixed list (influxdb, telegraf, mosquitto, worker) and file names from the
# incoming tree. Nothing derived from validator/policy output or from the
# rendered compose: a DENY is reported as "denied (N violation(s))". Compose
# output and full validator/policy messages (which can contain .env values)
# go only to $LOG (root 600). SIGPIPE/SIGHUP are ignored and stdout
# write errors are non-fatal, so a dropped SSH session cannot stop a deploy
# halfway.
#
# Exit: 0 deployed; 1 denied or failed (rolled back when possible); 2 usage.
#
# Testing: when NOT running as uid 0, SENTINELA_DEPLOY_ROOT=<abs dir> prefixes
# every path below and switches the compose project to sentinela-stack-test.
# In that mode the image prune of step 13 only runs when
# SENTINELA_TEST_WORKER_REPO names a test-only repository (never the real one,
# so a test run cannot delete a developer's local worker images). As root both
# are ignored (sudo's env_reset strips them anyway). See
# infra/tests/stack-deploy.test.sh.
trap '' PIPE HUP
set -uo pipefail
umask 077
export LC_ALL=C
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# ---- constants -------------------------------------------------------------
readonly PROJECT_NAME=sentinela-stack
readonly TEST_PROJECT_NAME=sentinela-stack-test
readonly DEPLOY_USER=sentinela-deploy
readonly INCOMING_PATH=/srv/sentinela/stack-incoming
readonly LIVE_PATH=/srv/sentinela/stack
readonly VALIDATOR_PATH=/usr/local/sbin/validate-compose.sh
readonly ALLOWED_IMAGES_PATH=/usr/local/etc/sentinela/allowed-images
readonly LOG_PATH=/var/log/sentinela-stack-deploy.log
readonly LOCK_PATH=/run/sentinela-stack-deploy.lock
readonly ROOT_HOME=/root
# The only files CI may ship (relative to incoming and to a release). Keep in sync with CI.
readonly EXPECTED_FILES=(compose.yml telegraf/telegraf.conf mosquitto/mosquitto.conf mosquitto/acl)
readonly EXPECTED_DIRS=(telegraf mosquitto)
readonly MAX_FILE_BYTES=1048576
readonly FORBIDDEN_WORDS_RE='env_file|label_file|include|extends'
readonly HEALTH_TIMEOUT=120
readonly HEALTH_POLL=5
readonly LOCK_TIMEOUT=600
readonly ARG_RE='^(none|[0-9a-f]{40})$'
readonly RELEASE_RE='^releases/[0-9]{8}T[0-9]{6}Z-[0-9]+$'
readonly WORKER_REPO_PROD=ghcr.io/arthjhon/sentinela-worker
readonly TEST_WORKER_REPO_RE='^sentinela-stack-test/[a-z0-9][a-z0-9_.-]{0,63}$'
readonly RUNBOOK_FIRST_DEPLOY='infra/README.md, "Primeiro deploy"'

# ---- output (never fatal) -----------------------------------------------------
say() { printf '%s\n' "$*" 2>/dev/null || true; }
err() { printf '%s\n' "$*" >&2 2>/dev/null || true; }

# ---- path setup (test prefix only for non-root) ----------------------------
prefix=""
project=$PROJECT_NAME
docker_home=$ROOT_HOME
test_mode=0
worker_repo=$WORKER_REPO_PROD
if [ -n "${SENTINELA_DEPLOY_ROOT:-}" ]; then
  if [ "$(id -u)" -eq 0 ]; then
    err "stack-deploy: SENTINELA_DEPLOY_ROOT ignored when running as root"
  else
    case "$SENTINELA_DEPLOY_ROOT" in
      /*) ;;
      *) err "stack-deploy: SENTINELA_DEPLOY_ROOT must be absolute"; exit 2 ;;
    esac
    case "/$SENTINELA_DEPLOY_ROOT/" in
      */../*) err "stack-deploy: SENTINELA_DEPLOY_ROOT must not contain '..'"; exit 2 ;;
    esac
    prefix=${SENTINELA_DEPLOY_ROOT%/}
    project=$TEST_PROJECT_NAME
    docker_home=${HOME:-/nonexistent}
    test_mode=1
    # Test mode never prunes the real repository: only an explicit test-only one.
    worker_repo=""
    if [ -n "${SENTINELA_TEST_WORKER_REPO:-}" ]; then
      if ! [[ $SENTINELA_TEST_WORKER_REPO =~ $TEST_WORKER_REPO_RE ]]; then
        err "stack-deploy: SENTINELA_TEST_WORKER_REPO must match $TEST_WORKER_REPO_RE"; exit 2
      fi
      worker_repo=$SENTINELA_TEST_WORKER_REPO
    fi
  fi
fi
unset SENTINELA_DEPLOY_ROOT SENTINELA_TEST_WORKER_REPO
if [ "$test_mode" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then
  err "stack-deploy: must run as root (via sudo)"
  exit 2
fi
readonly prefix project docker_home test_mode worker_repo
readonly INCOMING=$prefix$INCOMING_PATH
readonly LIVE=$prefix$LIVE_PATH
readonly VALIDATOR=$prefix$VALIDATOR_PATH
readonly ALLOWED_IMAGES=$prefix$ALLOWED_IMAGES_PATH
readonly LOG=$prefix$LOG_PATH
readonly LOCK=$prefix$LOCK_PATH
readonly ENV_FILE=$LIVE/.env
readonly RELEASES=$LIVE/releases
readonly STAGING_ROOT=$LIVE/.staging
my_uid=$(id -u)
readonly my_uid

# ---- logging ----------------------------------------------------------------
log_ready=0
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
# log: stdout (CI) + host log. Callers pass only value-free text.
log() {
  local line
  line="$(ts) [$$] $*"
  say "$line"
  if [ "$log_ready" -eq 1 ]; then printf '%s\n' "$line" >>"$LOG" 2>/dev/null || true; fi
}
# log_host: host log only (may contain rendered values, i.e. .env content).
log_host() {
  [ "$log_ready" -eq 1 ] || return 0
  printf '%s\n' "$(ts) [$$]   $*" >>"$LOG" 2>/dev/null || true
}
log_host_file() { # <label> <file>
  [ "$log_ready" -eq 1 ] || return 0
  [ -s "$2" ] || return 0
  head -c 65536 -- "$2" | sed "s/^/$(ts) [$$]   $1| /" >>"$LOG" 2>/dev/null || true
}

stages=()
# shellcheck disable=SC2317  # invoked via trap
cleanup() {
  local d
  for d in "${stages[@]+"${stages[@]}"}"; do
    [ -n "$d" ] && [ -d "$d" ] && rm -rf --one-file-system -- "$d"
  done
  rm -f -- "$LIVE/.link.$$" 2>/dev/null
}
trap cleanup EXIT

# Denied before the point of no return: live untouched.
deny() {
  log "DENIED: $*"
  log "result: denied, live stack unchanged"
  exit 1
}

# ---- argument ---------------------------------------------------------------
mkdir -p -- "$(dirname -- "$LOG")" 2>/dev/null
if touch -- "$LOG" 2>/dev/null && [ -f "$LOG" ] && ! [ -L "$LOG" ]; then
  chmod 600 -- "$LOG" 2>/dev/null
  log_ready=1
fi
if [ "$#" -ne 1 ] || [ "${#1}" -gt 40 ] || ! [[ $1 =~ $ARG_RE ]]; then
  shown=$(printf '%q ' "$@" | head -c 120)
  log "REJECTED: usage: stack-deploy.sh <none|40-hex sha>; got $# arg(s): $shown"
  exit 2
fi
arg=$1

# ---- trust checks -----------------------------------------------------------
# stat fields: <uid> <octal mode> <type>
file_meta() { stat -c '%u %a %F' -- "$1" 2>/dev/null; }

# Root-owned (current uid in tests), not a symlink, no group/other write.
check_trusted() { # <path> <kind: file|dir>
  local p=$1 kind=$2 uid mode type
  [ -L "$p" ] && { log "FATAL: $p is a symlink"; exit 1; }
  read -r uid mode type <<<"$(file_meta "$p")" || true
  if [ -z "${uid:-}" ]; then log "FATAL: missing $p"; exit 1; fi
  case "$kind:$type" in
    file:"regular file" | file:"regular empty file" | dir:directory) ;;
    *) log "FATAL: $p is not a $kind ($type)"; exit 1 ;;
  esac
  [ "$uid" = "$my_uid" ] || { log "FATAL: $p not owned by uid $my_uid"; exit 1; }
  if (( 8#$mode & 8#022 )); then log "FATAL: $p is group/other writable ($mode)"; exit 1; fi
}

# check_link <name> <expected target|RELEASE>: absent, or a symlink with exactly
# that target (RELEASE: any releases/<id> that is a trusted directory).
check_link() {
  local p=$LIVE/$1 want=$2 got
  if ! [ -L "$p" ]; then
    [ -e "$p" ] && { log "FATAL: $p exists and is not a symlink (unexpected layout)"; exit 1; }
    return 0
  fi
  got=$(readlink -- "$p")
  if [ "$want" = RELEASE ]; then
    [[ $got =~ $RELEASE_RE ]] || { log "FATAL: $p points outside releases/"; exit 1; }
    check_trusted "$LIVE/$got" dir
  elif [ "$got" != "$want" ]; then
    log "FATAL: $p must point to $want"; exit 1
  fi
}

# The parent too: whoever can write it can swap $LIVE or $INCOMING.
check_trusted "$(dirname -- "$LIVE")" dir
check_trusted "$LIVE" dir
check_trusted "$VALIDATOR" file
check_trusted "$ALLOWED_IMAGES" file
check_trusted "$ENV_FILE" file
if (( 8#$(stat -c '%a' -- "$ENV_FILE") & 8#077 )); then
  log "FATAL: $ENV_FILE must be mode 600"
  exit 1
fi
for p in "$RELEASES" "$STAGING_ROOT"; do
  if [ -e "$p" ] || [ -L "$p" ]; then check_trusted "$p" dir; fi
done
check_link current RELEASE
check_link .current RELEASE
check_link .previous RELEASE
check_link compose.yml current/compose.yml
check_link telegraf current/telegraf
check_link mosquitto current/mosquitto
check_link DEPLOYED .current/DEPLOYED
command -v jq >/dev/null || { log "FATAL: jq not found"; exit 1; }
command -v docker >/dev/null || { log "FATAL: docker not found"; exit 1; }

# ---- lock -------------------------------------------------------------------
mkdir -p -- "$(dirname -- "$LOCK")"
exec 9>>"$LOCK" || { log "FATAL: cannot open lock $LOCK"; exit 1; }
if ! flock -w "$LOCK_TIMEOUT" 9; then
  log "FATAL: another deploy holds the lock for more than ${LOCK_TIMEOUT}s"
  exit 1
fi

# ---- .env (parsed, never sourced; only SUPABASE_NETWORK is read) -------------
env_value() { # <key>  -> last KEY=value, quotes stripped
  local line v=""
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ $line =~ ^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=(.*)$ ]]; then v=${BASH_REMATCH[2]}; fi
  done <"$ENV_FILE"
  v=${v%$'\r'}
  if [[ $v =~ ^\"(.*)\"[[:space:]]*$ ]] || [[ $v =~ ^\'(.*)\'[[:space:]]*$ ]]; then v=${BASH_REMATCH[1]}; fi
  printf '%s' "$v"
}
while IFS= read -r line || [ -n "$line" ]; do
  if [[ $line =~ ^[[:space:]]*(export[[:space:]]+)?(COMPOSE_|DOCKER_) ]]; then
    log "FATAL: $ENV_FILE must not set COMPOSE_* or DOCKER_* variables"
    exit 1
  fi
done <"$ENV_FILE"
supabase_net=$(env_value SUPABASE_NETWORK)
if [ -n "$supabase_net" ] && ! [[ $supabase_net =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]; then
  log "FATAL: SUPABASE_NETWORK in .env has an invalid value"
  exit 1
fi
readonly supabase_net

# deployed_tag <DEPLOYED file>: sets $dtag to none|sha, or "" when the file is
# absent. Malformed content is fatal (runs in this shell, so exit works).
dtag=""
deployed_tag() {
  dtag=""
  [ -f "$1" ] || return 0
  dtag=$(awk 'NR==1 {print $2}' "$1")
  if ! [[ $dtag =~ $ARG_RE ]]; then log "FATAL: malformed $1"; exit 1; fi
}

# ---- docker helpers ---------------------------------------------------------
# Every docker call runs with a scrubbed environment (no COMPOSE_*/DOCKER_*).
dk() { env -i PATH="$PATH" HOME="$docker_home" LC_ALL=C docker "$@"; }

supports_no_env_resolution=0
if dk compose config --help 2>/dev/null | grep -q -- '--no-env-resolution'; then
  supports_no_env_resolution=1
fi
pull_policy=()
if dk compose pull --help 2>/dev/null | grep -q -- '--policy'; then
  pull_policy=(--policy missing)
fi

# run_logged <outdir> <label> <timeout> <cmd...>: output to the host log only.
run_logged() {
  local dir=$1 label=$2 to=$3 out rc
  shift 3
  out=$(mktemp "$dir/.$label.XXXXXX") || return 1
  timeout "$to" "$@" >"$out" 2>&1
  rc=$?
  log_host_file "$label" "$out"
  rm -f -- "$out"
  return "$rc"
}

# new_stage: sets $stage_dir (not echoed: must run in this shell so cleanup sees it).
stage_dir=""
new_stage() {
  if ! [ -d "$STAGING_ROOT" ]; then
    mkdir -m 700 -- "$STAGING_ROOT" || { log "FATAL: cannot create $STAGING_ROOT"; exit 1; }
  fi
  check_trusted "$STAGING_ROOT" dir
  stage_dir=$(mktemp -d "$STAGING_ROOT/deploy.XXXXXXXX") || { log "FATAL: mktemp failed"; exit 1; }
  stages+=("$stage_dir")
}

# set_link <name> <target>: atomically (re)point $LIVE/<name> (rename over it).
set_link() {
  local tmp=$LIVE/.link.$$
  rm -f -- "$tmp"
  ln -s -- "$2" "$tmp" && mv -f -T -- "$tmp" "$LIVE/$1"
}
link_target() { [ -L "$LIVE/$1" ] && readlink -- "$LIVE/$1"; }

# ---- tree checks ------------------------------------------------------------
in_list() { local x=$1; shift; local e; for e in "$@"; do [ "$e" = "$x" ] && return 0; done; return 1; }

# check_tree <dir> <label>: 0 ok, 1 rejected (reasons logged). Names printed
# are file names from the incoming tree (CI's own data, not .env values).
check_tree() {
  local d=$1 label=$2 bad=0 rec type nlink mode size rel f
  if ! [ -d "$d" ] || [ -L "$d" ]; then log "$label: $d missing or not a directory"; return 1; fi
  while IFS= read -r -d '' rec; do
    read -r type nlink mode size <<<"${rec%%/*}"
    rel=${rec#*/}
    case "$type" in
      d)
        if ! in_list "$rel" "${EXPECTED_DIRS[@]}"; then log "$label: unexpected directory: $(printf '%q' "$rel")"; bad=1
        elif (( 8#$mode & 8#7000 )); then log "$label: special mode bits on directory $rel ($mode)"; bad=1; fi ;;
      f)
        if ! in_list "$rel" "${EXPECTED_FILES[@]}"; then log "$label: unexpected file: $(printf '%q' "$rel")"; bad=1
        elif [ "$nlink" -ne 1 ]; then log "$label: hardlinked file: $rel (nlink $nlink)"; bad=1
        elif (( 8#$mode & 8#7000 )); then log "$label: setuid/setgid/sticky file: $rel ($mode)"; bad=1
        elif [ "$size" -gt "$MAX_FILE_BYTES" ]; then log "$label: file too large: $rel ($size bytes)"; bad=1; fi ;;
      l) log "$label: symlink not allowed: $(printf '%q' "$rel")"; bad=1 ;;
      *) log "$label: special file not allowed (type $type): $(printf '%q' "$rel")"; bad=1 ;;
    esac
  done < <(find -P "$d" -mindepth 1 -printf '%y %n %m %s/%P\0' 2>/dev/null)
  for f in "${EXPECTED_FILES[@]}"; do
    if ! [ -f "$d/$f" ] || [ -L "$d/$f" ]; then log "$label: missing $f"; bad=1; fi
  done
  return "$bad"
}

# read_untrusted <path>: file content on stdout, read with the deploy user's
# privileges (as root) so a link swapped in after the check cannot make root
# read anything that user could not. Bounded size and time (fifo/device).
read_untrusted() {
  if [ "$my_uid" -eq 0 ]; then
    local gid
    gid=$(id -g -- "$DEPLOY_USER") || { log "deploy user $DEPLOY_USER not found"; return 1; }
    timeout 30 setpriv --reuid="$DEPLOY_USER" --regid="$gid" --clear-groups \
      --no-new-privs -- head -c "$((MAX_FILE_BYTES + 1))" -- "$1"
  else
    timeout 30 head -c "$((MAX_FILE_BYTES + 1))" -- "$1"
  fi
}

# fill_stage <stage> <source dir> <untrusted 0|1>: copy EXPECTED_FILES to <stage>/in.
fill_stage() {
  local stage=$1 src=$2 untrusted=$3 f
  mkdir -m 755 -- "$stage/in" || return 1
  for f in "${EXPECTED_DIRS[@]}"; do mkdir -m 755 -- "$stage/in/$f" || return 1; done
  for f in "${EXPECTED_FILES[@]}"; do
    if [ "$untrusted" -eq 1 ]; then
      read_untrusted "$src/$f" >"$stage/in/$f" || { log "copy failed: $f"; return 1; }
    else
      cp -P -- "$src/$f" "$stage/in/$f" || { log "copy failed: $f"; return 1; }
    fi
    chmod 644 -- "$stage/in/$f" || return 1
  done
  chmod 600 -- "$stage/in/compose.yml"
}

# ---- compose checks ---------------------------------------------------------
raw_check() { # <compose file>
  local f=$1 n
  n=$(tr -d '\11\12\40-\176' <"$f" | wc -c)
  [ "$n" -eq 0 ] || { log "raw compose: only printable ASCII, tab and LF allowed ($n other bytes)"; return 1; }
  # shellcheck disable=SC1003  # a literal backslash
  if grep -q -F -e '\' -e '!' -- "$f"; then
    log "raw compose: '\\' (YAML escapes) and '!' (YAML tags) are not allowed"
    return 1
  fi
  if grep -q -i -E -e "$FORBIDDEN_WORDS_RE" -- "$f"; then
    log "raw compose: forbidden word (env_file, label_file, include, extends), also in comments: line $(grep -n -i -E -e "$FORBIDDEN_WORDS_RE" -- "$f" | head -1 | cut -d: -f1)"
    return 1
  fi
}

render() { # <stage> <compose> <out json> <tag-or-empty>
  local stage=$1 compose=$2 out=$3 tag=$4 args rc
  args=(compose -p "$project" --project-directory "$LIVE" --env-file "$ENV_FILE" -f "$compose" config --format json)
  [ "$supports_no_env_resolution" -eq 1 ] && args+=(--no-env-resolution)
  ( cd -- "$stage" && timeout 60 env -i PATH="$PATH" HOME="$docker_home" LC_ALL=C WORKER_TAG="$tag" \
      docker "${args[@]}" >"$out" 2>"$stage/render.err" )
  rc=$?
  log_host_file render "$stage/render.err"
  [ "$rc" -eq 0 ] || { log "render failed (exit $rc; details in $LOG on the host)"; return 1; }
  chmod 600 -- "$out"
}

# svc_label <name>: a service name for stdout, only from the fixed list the
# validator allows (anything else prints as "?"; nothing from the rendered
# compose reaches stdout verbatim).
svc_label() { case "$1" in influxdb | telegraf | mosquitto | worker) printf '%s' "$1" ;; *) printf '?' ;; esac; }

# Deploy-side policy, on top of the validator: binds and file-backed
# secrets/configs only from the live EXPECTED_FILES, binds read-only, and no
# file-reading keys survived the render. jq emits "<scope>\t<rule>\t<detail>".
extra_policy() { # <json>
  local json=$1 files out f scope rule detail n
  files=$(for f in "${EXPECTED_FILES[@]}"; do printf '%s\n' "$LIVE/$f"; done | jq -R . | jq -cs .)
  # shellcheck disable=SC2016  # jq program
  out=$(jq -r --argjson files "$files" '
    (.services // {} | to_entries[] | .key as $n | .value as $v
      | ((["env_file", "label_file", "extends"][] as $k | select($v[$k] != null) | [$n, "\($k) not allowed", ""]),
         (($v.volumes // [])[] | select(.type == "bind")
           | (.source as $s | if ($files | index($s)) == null then [$n, "bind source not allowed", $s] else empty end),
             (if .read_only != true then [$n, "bind must be read_only", .source] else empty end)))),
    (((.secrets // {}) + (.configs // {})) | to_entries[] | select(.value.file != null)
      | select(.value.file as $f | ($files | index($f)) == null) | ["secrets/configs." + .key, "file source not allowed", .value.file]),
    (["include", "extends"][] as $k | select(has($k)) | ["(top-level)", "\($k) not allowed", ""])
    | map(tostring | gsub("[\t\n]"; " ")) | join("\t")
  ' "$json" 2>&1) || { log "deploy policy: cannot evaluate rendered JSON"; return 1; }
  [ -n "$out" ] || return 0
  n=0
  while IFS=$'\t' read -r scope rule detail; do
    n=$((n + 1))
    log_host "deploy policy DENY: $scope: $rule: $detail"
  done <<<"$out"
  log "policy: denied ($n violation(s)); details in $LOG on the host"
  return 1
}

validate() { # <stage> <json>
  local stage=$1 json=$2 rc n
  timeout 60 env -i PATH="$PATH" LC_ALL=C ALLOWED_BIND_ROOT="$LIVE" EXPECTED_PROJECT="$project" \
    SUPABASE_NETWORK="$supabase_net" /bin/bash "$VALIDATOR" "$json" "$ALLOWED_IMAGES" \
    >"$stage/validate.out" 2>&1
  rc=$?
  log_host_file validate "$stage/validate.out"
  case "$rc" in
    0) log "validator: OK"; return 0 ;;
    1)
      # Only a count: the messages embed rendered values (.env content).
      n=$(grep -c '^DENY: ' "$stage/validate.out")
      log "validator: denied ($n violation(s)); details in $LOG on the host"
      return 1 ;;
    *) log "validator: bad input (exit $rc)"; return 1 ;;
  esac
}

# prepare <stage> <source dir> <untrusted 0|1> <tag>: copy, check, render,
# validate. Leaves $stage/in (the release content) and $stage/rendered.json.
prepare() {
  local stage=$1 src=$2 untrusted=$3 tag=$4
  fill_stage "$stage" "$src" "$untrusted" || return 1
  check_tree "$stage/in" staged || return 1
  raw_check "$stage/in/compose.yml" || return 1
  if [ -z "$tag" ] && grep -q -F -e 'WORKER_TAG' -- "$stage/in/compose.yml"; then
    log "no worker tag deployed: 'none' has no tag to keep; the first worker deploy must pass the 40-hex sha of an image already in GHCR (runbook: $RUNBOOK_FIRST_DEPLOY)"
    return 1
  fi
  render "$stage" "$stage/in/compose.yml" "$stage/rendered.json" "$tag" || return 1
  extra_policy "$stage/rendered.json" || return 1
  validate "$stage" "$stage/rendered.json" || return 1
}

# changed_bind_services <release dir> <json>: services whose bind source would
# get different content when `current` moves to <release dir>.
changed_bind_services() {
  local rel=$1 json=$2 f changed=()
  for f in "${EXPECTED_FILES[@]}"; do
    if ! cmp -s -- "$rel/$f" "$LIVE/$f"; then changed+=("$LIVE/$f"); fi
  done
  [ "${#changed[@]}" -gt 0 ] || return 0
  jq -r --argjson ch "$(printf '%s\n' "${changed[@]}" | jq -R . | jq -cs .)" '
    .services | to_entries[]
    | select(any((.value.volumes // [])[]; .type == "bind" and (.source as $s | $ch | index($s)) != null))
    | .key' "$json"
}

# ensure_static_links: the fixed paths that resolve through `current`/.current.
ensure_static_links() {
  [ -L "$LIVE/compose.yml" ] || set_link compose.yml current/compose.yml || return 1
  [ -L "$LIVE/telegraf" ] || set_link telegraf current/telegraf || return 1
  [ -L "$LIVE/mosquitto" ] || set_link mosquitto current/mosquitto || return 1
  [ -L "$LIVE/DEPLOYED" ] || set_link DEPLOYED .current/DEPLOYED || return 1
}

# Remove releases nothing points to (keeps current, .current, .previous).
prune_releases() {
  local keep=() t d
  for t in current .current .previous; do
    t=$(link_target "$t") && keep+=("${t#releases/}")
  done
  while IFS= read -r -d '' d; do
    d=${d##*/}
    in_list "$d" "${keep[@]+"${keep[@]}"}" || rm -rf --one-file-system -- "${RELEASES:?}/$d"
  done < <(find -P "$RELEASES" -mindepth 1 -maxdepth 1 -print0 2>/dev/null)
}

# prune_worker_images: after a successful deploy, untag local images of
# $worker_repo (exactly that repository, 40-hex tags only) that no release in
# current/.current/.previous names in its DEPLOYED. `docker rmi` without -f: an
# image a container (running or stopped) still uses is kept. Never a global prune,
# never another repository. Best effort: every failure is logged, none is fatal.
prune_worker_images() {
  local keep=() t d tag tags n=0 failed=0
  if [ -z "$worker_repo" ]; then log_host "image prune: skipped (test mode without a test repository)"; return 0; fi
  for t in current .current .previous; do
    d=$(link_target "$t") || continue
    [[ $d =~ $RELEASE_RE ]] || continue
    tag=$(awk 'NR==1 {print $2}' "$LIVE/$d/DEPLOYED" 2>/dev/null) || continue
    [[ $tag =~ ^[0-9a-f]{40}$ ]] && keep+=("$tag")
  done
  if ! tags=$(timeout 60 env -i PATH="$PATH" HOME="$docker_home" LC_ALL=C \
                docker image ls --format '{{.Tag}}' -- "$worker_repo" 2>/dev/null); then
    log "image prune: cannot list worker images (ignored)"
    return 0
  fi
  for tag in $tags; do
    [[ $tag =~ ^[0-9a-f]{40}$ ]] || continue
    in_list "$tag" "${keep[@]+"${keep[@]}"}" && continue
    if timeout 60 env -i PATH="$PATH" HOME="$docker_home" LC_ALL=C \
         docker rmi -- "$worker_repo:$tag" >/dev/null 2>&1; then
      n=$((n + 1))
    else
      failed=$((failed + 1))
      log_host "image prune: kept $worker_repo:$tag (rmi refused, e.g. still used by a container)"
    fi
  done
  log "image prune: removed $n unreferenced worker tag(s), $failed kept (in use or error)"
  return 0
}

compose_up() { # <release dir> <json> <recreate services...>
  local rel=$1 json=$2
  shift 2
  ( cd -- "$rel" && run_logged "$rel" up 600 \
      env -i PATH="$PATH" HOME="$docker_home" LC_ALL=C \
      docker compose -p "$project" --project-directory "$rel" -f "$json" up -d --remove-orphans ) \
    || { log "compose up failed (details in $LOG on the host)"; return 1; }
  if [ "$#" -gt 0 ]; then
    local s labels=""
    for s in "$@"; do labels+=" $(svc_label "$s")"; done
    log "force-recreate (bind source changed):$labels"
    ( cd -- "$rel" && run_logged "$rel" recreate 300 \
        env -i PATH="$PATH" HOME="$docker_home" LC_ALL=C \
        docker compose -p "$project" --project-directory "$rel" -f "$json" up -d --no-deps --force-recreate "$@" ) \
      || { log "compose force-recreate failed"; return 1; }
  fi
}

compose_pull() { # <stage> <json>
  local stage=$1 json=$2
  ( cd -- "$stage" && run_logged "$stage" pull 600 \
      env -i PATH="$PATH" HOME="$docker_home" LC_ALL=C \
      docker compose -p "$project" --project-directory "$stage" -f "$json" pull --quiet "${pull_policy[@]+"${pull_policy[@]}"}" )
}

# wait_healthy <json>: 0 when every service is running (+healthy when it has a
# healthcheck) with stable restart counts over two polls; 1 on timeout or unhealthy.
wait_healthy() {
  local json=$1 deadline prev="" sig ok svc ids id st health rc report
  deadline=$((SECONDS + HEALTH_TIMEOUT))
  mapfile -t svcs < <(jq -r '.services | keys[]' "$json")
  while :; do
    ok=1; sig=""; report=""
    for svc in "${svcs[@]}"; do
      ids=$(dk ps -a -q --filter "label=com.docker.compose.project=$project" \
        --filter "label=com.docker.compose.service=$svc" --filter "label=com.docker.compose.oneoff=False")
      if [ -z "$ids" ]; then ok=0; report+=" $(svc_label "$svc")=missing"; continue; fi
      for id in $ids; do
        read -r st health rc <<<"$(dk inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.RestartCount}}' "$id" 2>/dev/null)"
        report+=" $(svc_label "$svc")=${st:-?}/${health:-?}/restarts:${rc:-?}"
        if [ "${health:-}" = unhealthy ]; then
          log "health: $(svc_label "$svc") is unhealthy;$report"
          return 1
        fi
        if [ "${st:-}" != running ] || { [ "${health:-}" != none ] && [ "${health:-}" != healthy ]; }; then ok=0; fi
        sig+="$id:${rc:-?} "
      done
    done
    if [ "$ok" -eq 1 ]; then
      if [ "$sig" = "$prev" ]; then log "health: all services up;$report"; return 0; fi
      prev=$sig
    else
      prev=""
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      log "health: timeout after ${HEALTH_TIMEOUT}s;$report"
      return 1
    fi
    sleep "$HEALTH_POLL"
  done
}

# Back to the last-known-good release (.current), never to whatever is live.
rollback() {
  local stage tag lkg recreate=()
  log "ROLLBACK: starting"
  if ! lkg=$(link_target .current) || ! [ -f "$LIVE/$lkg/DEPLOYED" ]; then
    log "ROLLBACK: no last-known-good release (first deploy); failed containers left as they are"
    return 1
  fi
  deployed_tag "$LIVE/$lkg/DEPLOYED"
  tag=$dtag
  [ "$tag" = none ] && tag=""
  new_stage
  stage=$stage_dir
  # The release is root-written; it is still re-checked, re-rendered and
  # re-validated against the current .env and policy.
  if ! prepare "$stage" "$LIVE/$lkg" 0 "$tag"; then
    log "ROLLBACK: last-known-good no longer passes validation; NOT starting it. Manual action needed."
    return 1
  fi
  mapfile -t recreate < <(changed_bind_services "$LIVE/$lkg" "$stage/rendered.json")
  mv -f -T -- "$stage/rendered.json" "$LIVE/$lkg/rendered.json" || { log "ROLLBACK: cannot store rendered config"; return 1; }
  set_link current "$lkg" || { log "ROLLBACK: cannot move current"; return 1; }
  compose_up "$LIVE/$lkg" "$LIVE/$lkg/rendered.json" "${recreate[@]+"${recreate[@]}"}" || { log "ROLLBACK: up failed"; return 1; }
  if ! wait_healthy "$LIVE/$lkg/rendered.json"; then log "ROLLBACK: last-known-good is not healthy either"; return 1; fi
  prune_releases
  log "ROLLBACK: last-known-good running ($(cat -- "$LIVE/$lkg/DEPLOYED"))"
}

# ---- main -------------------------------------------------------------------
log "deploy start: arg=$arg project=$project user=$(id -un) no-env-resolution=$supports_no_env_resolution"

# Stale staging from an interrupted run (we hold the lock).
find -P "$STAGING_ROOT" -mindepth 1 -maxdepth 1 -exec rm -rf --one-file-system -- {} + 2>/dev/null
rm -f -- "$LIVE"/.link.* 2>/dev/null

cur=$(link_target current) || cur=""
lkg=$(link_target .current) || lkg=""
if [ -n "$cur" ] && [ "$cur" != "$lkg" ]; then
  log "warning: an earlier deploy did not finish (current != .current); proceeding"
fi
current_tag=""
if [ -n "$lkg" ]; then deployed_tag "$LIVE/$lkg/DEPLOYED"; current_tag=$dtag; fi
if [ "$arg" = none ]; then tag=${current_tag:-none}; else tag=$arg; fi
render_tag=$tag
[ "$render_tag" = none ] && render_tag=""
log "worker tag: $tag (deployed: ${current_tag:-<none yet>})"

if [ -L "$INCOMING" ] || ! [ -d "$INCOMING" ]; then deny "incoming $INCOMING missing or a symlink"; fi
check_tree "$INCOMING" incoming || deny "incoming tree rejected"

new_stage
stage=$stage_dir
prepare "$stage" "$INCOMING" 1 "$render_tag" || deny "staged compose rejected"
log "staged compose validated"

compose_pull "$stage" "$stage/rendered.json" || deny "image pull failed (details in $LOG on the host)"
log "images present"

# ---- point of no return ----
if ! [ -d "$RELEASES" ]; then mkdir -m 700 -- "$RELEASES" || deny "cannot create $RELEASES"; fi
rel_name=$(date -u +%Y%m%dT%H%M%SZ)-$$
rel=$RELEASES/$rel_name
if ! { mv -T -- "$stage/in" "$rel" && mv -T -- "$stage/rendered.json" "$rel/rendered.json"; }; then
  deny "cannot create release $rel_name"
fi
json=$rel/rendered.json
mapfile -t recreate < <(changed_bind_services "$rel" "$json")
ensure_static_links || { log "FATAL: cannot create static links"; rollback; exit 1; }
set_link current "releases/$rel_name" || { log "FATAL: cannot move current"; rollback; exit 1; }
log "current -> releases/$rel_name"

if compose_up "$rel" "$json" "${recreate[@]+"${recreate[@]}"}" && wait_healthy "$json"; then
  if ! { printf '%s %s\n' "$(ts)" "$tag" >"$rel/DEPLOYED.new" && chmod 644 -- "$rel/DEPLOYED.new" \
          && mv -f -T -- "$rel/DEPLOYED.new" "$rel/DEPLOYED"; }; then
    log "FATAL: cannot write DEPLOYED"; rollback; exit 1
  fi
  old=$(link_target .current) || old=""
  if [ -n "$old" ] && [ "$old" != "releases/$rel_name" ]; then set_link .previous "$old"; fi
  set_link .current "releases/$rel_name" || { log "FATAL: cannot move .current"; exit 1; }
  prune_releases
  prune_worker_images || true
  log "result: deployed $(cat -- "$rel/DEPLOYED")"
  exit 0
fi

log "deploy failed: rolling back"
if rollback; then log "result: failed, rolled back to last-known-good"; else log "result: failed, rollback incomplete"; fi
exit 1
