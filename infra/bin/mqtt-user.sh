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
# the container. The passwd file is rewritten into a temp file in the same dir and
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

reload() { docker kill -s HUP "$ct" >/dev/null || die "could not signal the broker (SIGHUP)"; }

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
    # stdin: "user:password" (plaintext, hashed in place by mosquitto_passwd -U).
    printf '%s:%s\n' "$user" "$password" | docker exec -i "$ct" sh -c '
      set -e
      umask 077
      p='"$PASSWD"'
      n=$p.new.$$
      trap "rm -f $n $n.h" EXIT
      cat > "$n.h"
      mosquitto_passwd -U "$n.h" >/dev/null 2>&1
      { if [ -e "$p" ]; then awk -F: -v u="$1" "\$1 != u" "$p"; fi; cat "$n.h"; } > "$n"
      chown 1883:1883 "$n"
      chmod 600 "$n"
      mv "$n" "$p"' _ "$user" || die "could not update $PASSWD"
    reload
    printf '%s\n' "$password"
    ;;
  del)
    docker exec "$ct" sh -c '
      set -e
      umask 077
      p='"$PASSWD"'
      n=$p.new.$$
      trap "rm -f $n" EXIT
      awk -F: -v u="$1" "\$1 == u { f = 1 } END { exit !f }" "$p" || exit 3
      awk -F: -v u="$1" "\$1 != u" "$p" > "$n"
      chown 1883:1883 "$n"
      chmod 600 "$n"
      mv "$n" "$p"' _ "$user"
    rc=$?
    [ "$rc" -eq 3 ] && die "user '$user' not found"
    [ "$rc" -eq 0 ] || die "could not update $PASSWD"
    reload
    echo "removed $user" >&2
    ;;
esac
