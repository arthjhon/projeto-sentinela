#!/bin/bash
# Root deploy of the Sentinela data stack (InfluxDB + Telegraf [+ worker]).
#
#   stack-deploy.sh <none|40-hex-worker-sha>
#
# Invoked by CI through a forced-command SSH key + a sudoers rule that allows
# only this script. CI never controls anything here except:
#   - the files it rsynced into $INCOMING (exactly EXPECTED_FILES), and
#   - the single argument (worker image tag; `none` keeps the deployed one).
#
# Sequence (any failure before "point of no return" leaves live untouched):
#   1. argument check, flock, log
#   2. incoming tree check: only EXPECTED_FILES/EXPECTED_DIRS, regular files,
#      nlink 1, no setuid/setgid/sticky, <= MAX_FILE_BYTES; no symlink, device,
#      fifo or socket anywhere
#   3. copy into a fresh root-owned staging dir under $LIVE/.staging, reading
#      each file with the privileges of $DEPLOY_USER (no confused deputy:
#      a symlink/hardlink swapped in after step 2 can only reach what the
#      deploy user could read anyway); re-check the staged tree
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
#   9. snapshot live -> $LIVE/.previous; rename staged files into live
#  10. `up -d --remove-orphans` from the validated JSON (validated == executed),
#      force-recreate services whose bind sources changed (a file bind keeps
#      the old inode otherwise)
#  11. wait up to HEALTH_TIMEOUT s for every service: running, healthy when it
#      has a healthcheck, restart count stable over two polls; `unhealthy` = fail
#  12. OK -> write $LIVE/DEPLOYED "<iso-time> <sha|none>". Fail -> restore
#      .previous (re-rendered and re-validated against the current policy and
#      .env), `up` it, exit 1.
#
# Exit: 0 deployed; 1 denied or failed (rolled back when possible); 2 usage.
#
# Testing: when NOT running as uid 0, SENTINELA_DEPLOY_ROOT=<abs dir> prefixes
# every path below and switches the compose project to sentinela-stack-test.
# As root it is ignored (sudo's env_reset strips it anyway). See
# infra/tests/stack-deploy.test.sh.
#
# Never prints .env content: values of secret-looking keys are redacted from
# stdout and log; compose/validator raw output goes to the log file only.
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
# The only files CI may ship (relative to incoming and live). Keep in sync with CI.
readonly EXPECTED_FILES=(compose.yml telegraf/telegraf.conf)
readonly EXPECTED_DIRS=(telegraf)
readonly MAX_FILE_BYTES=1048576
readonly FORBIDDEN_WORDS_RE='env_file|label_file|include|extends'
readonly SECRET_KEY_RE='(TOKEN|PASS|SECRET|KEY|DSN|AUTH|CRED)'
readonly HEALTH_TIMEOUT=120
readonly HEALTH_POLL=5
readonly LOCK_TIMEOUT=600
readonly ARG_RE='^(none|[0-9a-f]{40})$'

# ---- path setup (test prefix only for non-root) ----------------------------
prefix=""
project=$PROJECT_NAME
docker_home=$ROOT_HOME
test_mode=0
if [ -n "${SENTINELA_DEPLOY_ROOT:-}" ]; then
  if [ "$(id -u)" -eq 0 ]; then
    echo "stack-deploy: SENTINELA_DEPLOY_ROOT ignored when running as root" >&2
  else
    case "$SENTINELA_DEPLOY_ROOT" in
      /*) ;;
      *) echo "stack-deploy: SENTINELA_DEPLOY_ROOT must be absolute" >&2; exit 2 ;;
    esac
    case "/$SENTINELA_DEPLOY_ROOT/" in
      */../*) echo "stack-deploy: SENTINELA_DEPLOY_ROOT must not contain '..'" >&2; exit 2 ;;
    esac
    prefix=${SENTINELA_DEPLOY_ROOT%/}
    project=$TEST_PROJECT_NAME
    docker_home=${HOME:-/nonexistent}
    test_mode=1
  fi
fi
unset SENTINELA_DEPLOY_ROOT
if [ "$test_mode" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then
  echo "stack-deploy: must run as root (via sudo)" >&2
  exit 2
fi
readonly prefix project docker_home test_mode
readonly INCOMING=$prefix$INCOMING_PATH
readonly LIVE=$prefix$LIVE_PATH
readonly VALIDATOR=$prefix$VALIDATOR_PATH
readonly ALLOWED_IMAGES=$prefix$ALLOWED_IMAGES_PATH
readonly LOG=$prefix$LOG_PATH
readonly LOCK=$prefix$LOCK_PATH
readonly ENV_FILE=$LIVE/.env
readonly DEPLOYED_FILE=$LIVE/DEPLOYED
readonly PREVIOUS=$LIVE/.previous
readonly STAGING_ROOT=$LIVE/.staging
my_uid=$(id -u)
readonly my_uid

# ---- logging ----------------------------------------------------------------
secrets=()
redact() {
  local s=$1 v
  for v in "${secrets[@]+"${secrets[@]}"}"; do
    s=${s//"$v"/[REDACTED]}
  done
  printf '%s' "$s"
}
log_ready=0
log() {
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) [$$] $(redact "$*")"
  printf '%s\n' "$line"
  if [ "$log_ready" -eq 1 ]; then printf '%s\n' "$line" >>"$LOG"; fi
}
# Command output: log file only (may echo compose internals), redacted.
log_file_only() { # <label> <file>
  [ "$log_ready" -eq 1 ] || return 0
  [ -s "$2" ] || return 0
  local content
  content=$(head -c 65536 -- "$2")
  printf '%s\n' "$(redact "$content")" | sed "s/^/$(date -u +%Y-%m-%dT%H:%M:%SZ) [$$]   $1| /" >>"$LOG"
}

stages=()
# shellcheck disable=SC2317  # invoked via trap
cleanup() {
  local d
  for d in "${stages[@]+"${stages[@]}"}"; do
    [ -n "$d" ] && [ -d "$d" ] && rm -rf --one-file-system -- "$d"
  done
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
for p in "$LIVE/telegraf" "$PREVIOUS" "$STAGING_ROOT" "$DEPLOYED_FILE"; do
  if [ -e "$p" ] || [ -L "$p" ]; then
    case "$p" in
      "$DEPLOYED_FILE") check_trusted "$p" file ;;
      *) check_trusted "$p" dir ;;
    esac
  fi
done
command -v jq >/dev/null || { log "FATAL: jq not found"; exit 1; }
command -v docker >/dev/null || { log "FATAL: docker not found"; exit 1; }

# ---- lock -------------------------------------------------------------------
mkdir -p -- "$(dirname -- "$LOCK")"
exec 9>>"$LOCK" || { log "FATAL: cannot open lock $LOCK"; exit 1; }
if ! flock -w "$LOCK_TIMEOUT" 9; then
  log "FATAL: another deploy holds the lock for more than ${LOCK_TIMEOUT}s"
  exit 1
fi

# ---- .env (parsed, never sourced) --------------------------------------------
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
  if [[ $line =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*= ]]; then
    key=${BASH_REMATCH[2]}
    if [[ ${key^^} =~ $SECRET_KEY_RE ]]; then
      val=$(env_value "$key")
      [ "${#val}" -ge 4 ] && secrets+=("$val")
    fi
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

# run_logged <stage> <label> <timeout> <cmd...>: output to log file only.
run_logged() {
  local stage=$1 label=$2 to=$3 out rc
  shift 3
  out="$stage/$label.out"
  timeout "$to" "$@" >"$out" 2>&1
  rc=$?
  log_file_only "$label" "$out"
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

# ---- tree checks ------------------------------------------------------------
in_list() { local x=$1; shift; local e; for e in "$@"; do [ "$e" = "$x" ] && return 0; done; return 1; }

# check_tree <dir> <label>: 0 ok, 1 rejected (reasons logged).
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
  log_file_only render "$stage/render.err"
  [ "$rc" -eq 0 ] || { log "render failed (exit $rc; details in $LOG on the host)"; return 1; }
  chmod 600 -- "$out"
}

# Deploy-side policy, on top of the validator: binds and file-backed
# secrets/configs only from the live EXPECTED_FILES, binds read-only, and no
# file-reading keys survived the render.
extra_policy() { # <json>
  local json=$1 files out f
  files=$(for f in "${EXPECTED_FILES[@]}"; do printf '%s\n' "$LIVE/$f"; done | jq -R . | jq -cs .)
  # shellcheck disable=SC2016  # jq program
  out=$(jq -r --argjson files "$files" '
    (.services // {} | to_entries[] | .key as $n | .value as $v
      | ((["env_file", "label_file", "extends"][] as $k | select($v[$k] != null) | "\($n): \($k) not allowed"),
         (($v.volumes // [])[] | select(.type == "bind")
           | (.source as $s | if ($files | index($s)) == null then "\($n): bind source not allowed: \($s)" else empty end),
             (if .read_only != true then "\($n): bind must be read_only: \(.source)" else empty end)))),
    (((.secrets // {}) + (.configs // {})) | to_entries[] | select(.value.file != null)
      | select(.value.file as $f | ($files | index($f)) == null) | "secrets/configs \(.key): file source not allowed: \(.value.file)"),
    (["include", "extends"][] as $k | select(has($k)) | "(top-level): \($k) not allowed")
  ' "$json" 2>&1) || { log "deploy policy: cannot evaluate rendered JSON"; return 1; }
  if [ -n "$out" ]; then
    while IFS= read -r f; do log "DENY (deploy policy): $f"; done <<<"$out"
    return 1
  fi
}

validate() { # <stage> <json>
  local stage=$1 json=$2 rc
  timeout 60 env -i PATH="$PATH" LC_ALL=C ALLOWED_BIND_ROOT="$LIVE" EXPECTED_PROJECT="$project" \
    SUPABASE_NETWORK="$supabase_net" /bin/bash "$VALIDATOR" "$json" "$ALLOWED_IMAGES" \
    >"$stage/validate.out" 2>&1
  rc=$?
  log_file_only validate "$stage/validate.out"
  case "$rc" in
    0) log "validator: OK"; return 0 ;;
    1) while IFS= read -r l; do log "validator: $l"; done <"$stage/validate.out"; return 1 ;;
    *) log "validator: bad input (exit $rc)"; return 1 ;;
  esac
}

# prepare <stage> <source dir> <untrusted 0|1> <tag>: copy, check, render,
# validate. Leaves $stage/rendered.json on success.
prepare() {
  local stage=$1 src=$2 untrusted=$3 tag=$4
  fill_stage "$stage" "$src" "$untrusted" || return 1
  check_tree "$stage/in" staged || return 1
  raw_check "$stage/in/compose.yml" || return 1
  render "$stage" "$stage/in/compose.yml" "$stage/rendered.json" "$tag" || return 1
  extra_policy "$stage/rendered.json" || return 1
  validate "$stage" "$stage/rendered.json" || return 1
}

# Services whose bind source content will change with this swap.
changed_bind_services() { # <stage> <json>
  local stage=$1 json=$2 f changed=()
  for f in "${EXPECTED_FILES[@]}"; do
    if ! cmp -s -- "$stage/in/$f" "$LIVE/$f"; then changed+=("$LIVE/$f"); fi
  done
  [ "${#changed[@]}" -gt 0 ] || return 0
  printf '%s\n' "${changed[@]}" | jq -R . | jq -cs . >"$stage/changed.json"
  jq -r --slurpfile ch "$stage/changed.json" '
    .services | to_entries[]
    | select(any((.value.volumes // [])[]; .type == "bind" and (.source as $s | $ch[0] | index($s)) != null))
    | .key' "$json"
}

install_live() { # <stage>: rename staged files into live (same filesystem).
  local stage=$1 f
  for f in "${EXPECTED_DIRS[@]}"; do
    if ! [ -d "$LIVE/$f" ]; then mkdir -m 755 -- "$LIVE/$f" || return 1; fi
    check_trusted "$LIVE/$f" dir
  done
  for f in "${EXPECTED_FILES[@]}"; do
    if [ -L "$LIVE/$f" ] || { [ -e "$LIVE/$f" ] && ! [ -f "$LIVE/$f" ]; }; then
      log "FATAL: live $f is not a regular file"; return 1
    fi
    mv -f -T -- "$stage/in/$f" "$LIVE/$f" || return 1
  done
}

snapshot_previous() {
  local f
  if ! [ -f "$DEPLOYED_FILE" ]; then log "no DEPLOYED yet: nothing to snapshot (first deploy)"; return 0; fi
  rm -rf --one-file-system -- "$PREVIOUS.new"
  mkdir -m 700 -- "$PREVIOUS.new" || return 1
  for f in "${EXPECTED_DIRS[@]}"; do mkdir -m 700 -- "$PREVIOUS.new/$f" || return 1; done
  for f in "${EXPECTED_FILES[@]}" DEPLOYED; do
    if ! [ -f "$LIVE/$f" ] || [ -L "$LIVE/$f" ]; then log "snapshot: live $f missing"; return 1; fi
    cp -P -- "$LIVE/$f" "$PREVIOUS.new/$f" || return 1
  done
  rm -rf --one-file-system -- "$PREVIOUS"
  mv -T -- "$PREVIOUS.new" "$PREVIOUS" || return 1
  log "snapshot: live saved to $PREVIOUS ($(cat -- "$PREVIOUS/DEPLOYED"))"
}

compose_up() { # <stage> <json> <recreate services...>
  local stage=$1 json=$2
  shift 2
  ( cd -- "$stage" && run_logged "$stage" up 600 \
      env -i PATH="$PATH" HOME="$docker_home" LC_ALL=C \
      docker compose -p "$project" --project-directory "$stage" -f "$json" up -d --remove-orphans ) \
    || { log "compose up failed (details in $LOG on the host)"; return 1; }
  if [ "$#" -gt 0 ]; then
    log "force-recreate (bind source changed): $*"
    ( cd -- "$stage" && run_logged "$stage" recreate 300 \
        env -i PATH="$PATH" HOME="$docker_home" LC_ALL=C \
        docker compose -p "$project" --project-directory "$stage" -f "$json" up -d --no-deps --force-recreate "$@" ) \
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
      if [ -z "$ids" ]; then ok=0; report+=" $svc=missing"; continue; fi
      for id in $ids; do
        read -r st health rc <<<"$(dk inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.RestartCount}}' "$id" 2>/dev/null)"
        report+=" $svc=${st:-?}/${health:-?}/restarts:${rc:-?}"
        if [ "${health:-}" = unhealthy ]; then
          log "health: $svc is unhealthy;$report"
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

rollback() {
  local stage tag recreate=()
  log "ROLLBACK: starting"
  if ! [ -d "$PREVIOUS" ] || ! [ -f "$PREVIOUS/DEPLOYED" ]; then
    log "ROLLBACK: no previous version (first deploy); failed containers left as they are"
    return 1
  fi
  deployed_tag "$PREVIOUS/DEPLOYED"
  tag=$dtag
  [ "$tag" = none ] && tag=""
  new_stage
  stage=$stage_dir
  # .previous is root-written; it is still re-checked, re-rendered and
  # re-validated against the current .env and policy.
  if ! prepare "$stage" "$PREVIOUS" 0 "$tag"; then
    log "ROLLBACK: previous version no longer passes validation; NOT starting it. Manual action needed."
    return 1
  fi
  mapfile -t recreate < <(changed_bind_services "$stage" "$stage/rendered.json")
  install_live "$stage" || { log "ROLLBACK: restoring files failed"; return 1; }
  compose_up "$stage" "$stage/rendered.json" "${recreate[@]+"${recreate[@]}"}" || { log "ROLLBACK: up failed"; return 1; }
  if ! wait_healthy "$stage/rendered.json"; then log "ROLLBACK: previous version is not healthy either"; return 1; fi
  cp -- "$stage/rendered.json" "$LIVE/.deployed.json"
  log "ROLLBACK: previous version running ($(cat -- "$DEPLOYED_FILE"))"
}

# ---- main -------------------------------------------------------------------
log "deploy start: arg=$arg project=$project user=$(id -un) no-env-resolution=$supports_no_env_resolution"

# Stale staging from an interrupted run (we hold the lock).
find -P "$STAGING_ROOT" -mindepth 1 -maxdepth 1 -exec rm -rf --one-file-system -- {} + 2>/dev/null

deployed_tag "$DEPLOYED_FILE"
current_tag=$dtag
if [ "$arg" = none ]; then tag=${current_tag:-none}; else tag=$arg; fi
render_tag=$tag
[ "$render_tag" = none ] && render_tag=""
log "worker tag: $tag (deployed: ${current_tag:-<none yet>})"

if [ -L "$INCOMING" ] || ! [ -d "$INCOMING" ]; then deny "incoming $INCOMING missing or a symlink"; fi
check_tree "$INCOMING" incoming || deny "incoming tree rejected"

new_stage
stage=$stage_dir
prepare "$stage" "$INCOMING" 1 "$render_tag" || deny "staged compose rejected"
json=$stage/rendered.json
log "staged compose validated"

compose_pull "$stage" "$json" || deny "image pull failed (details in $LOG on the host)"
log "images present"

mapfile -t recreate < <(changed_bind_services "$stage" "$json")

# ---- point of no return ----
snapshot_previous || deny "snapshot of live failed"
install_live "$stage" || { log "FATAL: installing staged files failed"; rollback; exit 1; }
log "live files updated"

if compose_up "$stage" "$json" "${recreate[@]+"${recreate[@]}"}" && wait_healthy "$json"; then
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$tag" >"$DEPLOYED_FILE.new" \
    && chmod 644 -- "$DEPLOYED_FILE.new" && mv -f -T -- "$DEPLOYED_FILE.new" "$DEPLOYED_FILE"
  cp -- "$json" "$LIVE/.deployed.json"
  log "result: deployed $(cat -- "$DEPLOYED_FILE")"
  exit 0
fi

log "deploy failed: rolling back"
if rollback; then log "result: failed, rolled back to previous"; else log "result: failed, rollback incomplete"; fi
exit 1
