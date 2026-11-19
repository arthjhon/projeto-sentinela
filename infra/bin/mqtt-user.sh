#!/usr/bin/env bash
# Provision MQTT credentials in the running mosquitto container.
#
#   mqtt-user.sh add <user>   generate a 40-char password, store its hash (adds or
#                             rotates), reload the broker, print the password ONCE
#   mqtt-user.sh del <user>   remove the user, reload the broker
#   mqtt-user.sh list         print usernames only (never hashes)
#
# <user> is a device id (^[A-Za-z0-9_-]{1,40}$) or exactly svc/telegraf | svc/ota.
# Run on the VM as an operator with Docker access (sudo). Needs only bash + docker.
#
# The password never appears in any argv: it is generated here and fed to the
# container through `docker exec -i` stdin; hashing (mosquitto_passwd -U) runs inside
# the container (plaintext only in tmpfs). The passwd file is rewritten into a temp file in the same dir and
# `mv`d over, so a concurrent SIGHUP never reads a half-written file; owner 1883,
# mode 600 after every operation.
#
# Env: MQTT_CONTAINER overrides the container (default: the compose service
# `mosquitto` of project `sentinela-stack`, found by labels).
# Exit: 0 ok, 1 runtime error (no container, unknown user on del), 2 usage/invalid user.
set -uo pipefail
umask 077
export LC_ALL=C

readonly PASSWD=/mosquitto/data/passwd

die() { echo "mqtt-user: $*" >&2; exit "${2:-1}"; }
usage() { echo "usage: mqtt-user.sh add <user> | del <user> | list" >&2; exit 2; }

valid_user() {
  [[ $1 =~ ^[A-Za-z0-9_-]{1,40}$ ]] || [ "$1" = svc/telegraf ] || [ "$1" = svc/ota ]
}

resolve_container() {
  if [ -n "${MQTT_CONTAINER:-}" ]; then
    docker inspect -f '{{.State.Running}}' "$MQTT_CONTAINER" 2>/dev/null | grep -qx true \
      || die "container '$MQTT_CONTAINER' is not running"
    ct=$MQTT_CONTAINER
    return
  fi
  local ids
  ids=$(docker ps -q \
    --filter label=com.docker.compose.project=sentinela-stack \
    --filter label=com.docker.compose.service=mosquitto) || die "docker ps failed"
  [ -n "$ids" ] || die "no running mosquitto container in project sentinela-stack"
  [ "$(printf '%s\n' "$ids" | wc -l)" -eq 1 ] || die "more than one mosquitto container matched"
  ct=$ids
}

gen_password() {
  local p
  p=$(head -c 96 /dev/urandom | base64 -w0 | tr -dc 'A-Za-z0-9' | head -c 40)
  [ "${#p}" -eq 40 ] || die "could not generate a password"
  printf '%s' "$p"
}

reload() { docker kill -s HUP "$ct" >/dev/null; }

cmd=${1:-}
case $cmd in
  add | del)
    [ $# -eq 2 ] || usage
    user=$2
    valid_user "$user" || die "invalid user '$user' (device id [A-Za-z0-9_-]{1,40}, svc/telegraf or svc/ota)" 2
    ;;
  list) [ $# -eq 1 ] || usage ;;
  *) usage ;;
esac

command -v docker >/dev/null || die "docker not found"
ct=""
resolve_container

case $cmd in
  list)
    docker exec "$ct" cut -d: -f1 "$PASSWD" || die "could not read $PASSWD"
    ;;
  add)
    password=$(gen_password) || exit 1
    # stdin: "user:password" (plaintext). It is hashed by mosquitto_passwd -U in a tmpfs
    # file (/dev/shm); only the hashed result touches the data volume. awk compares as
    # strings ($1 "") because ids like 100 / 1e2 / 0100 would compare equal as numbers.
    # flock serialises concurrent runs; the line-count guard refuses a bad rewrite.
    printf '%s:%s\n' "$user" "$password" | docker exec -i "$ct" sh -c '
      set -e
      umask 077
      p='"$PASSWD"'
      n=$p.new.$$
      h=/dev/shm/mqtt-user.$$
      trap "rm -f $n $h" EXIT
      exec 9> "$p.lock"
      flock 9
      cat > "$h"
      mosquitto_passwd -U "$h" >/dev/null 2>&1
      old=$(wc -l < "$p")
      if awk -F: -v u="$1" "(\$1 \"\") == u { f = 1 } END { exit !f }" "$p"; then want=$old; else want=$((old + 1)); fi
      { awk -F: -v u="$1" "(\$1 \"\") != u" "$p"; cat "$h"; } > "$n"
      [ "$(wc -l < "$n")" -eq "$want" ] || { echo "line count mismatch, refusing" >&2; exit 4; }
      chown 1883:1883 "$n"
      chmod 600 "$n"
      mv "$n" "$p"' _ "$user" || die "could not update $PASSWD"
    if ! reload; then
      # The hash is already live; never lose the only copy of the password.
      printf '%s\n' "$password"
      echo "mqtt-user: password stored but broker NOT reloaded; run: docker kill -s HUP $ct" >&2
      exit 1
    fi
    printf '%s\n' "$password"
    ;;
  del)
    docker exec "$ct" sh -c '
      set -e
      umask 077
      p='"$PASSWD"'
      n=$p.new.$$
      trap "rm -f $n" EXIT
      exec 9> "$p.lock"
      flock 9
      awk -F: -v u="$1" "(\$1 \"\") == u { f = 1 } END { exit !f }" "$p" || exit 3
      old=$(wc -l < "$p")
      awk -F: -v u="$1" "(\$1 \"\") != u" "$p" > "$n"
      [ "$(wc -l < "$n")" -eq $((old - 1)) ] || { echo "line count mismatch, refusing" >&2; exit 4; }
      chown 1883:1883 "$n"
      chmod 600 "$n"
      mv "$n" "$p"' _ "$user"
    rc=$?
    [ "$rc" -eq 3 ] && die "user '$user' not found"
    [ "$rc" -eq 0 ] || die "could not update $PASSWD"
    reload || die "user removed but broker NOT reloaded; run: docker kill -s HUP $ct"
    echo "removed $user" >&2
    ;;
esac
