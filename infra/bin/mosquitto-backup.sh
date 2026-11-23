#!/bin/bash
# Daily backup of the broker volume (sentinela-mosquitto-data), run as root by
# mosquitto-backup.service (timer 03:40).
#
# The volume is the ONLY copy of the MQTT credentials (`passwd`: hashes of
# svc/telegraf, svc/ota and every board's snt-NNNN). Losing it means
# re-provisioning every board over USB. `mosquitto.db` (retained messages and
# sessions) goes along; it is rebuilt by the boards if lost.
#
# The files are read inside the mosquitto container (docker exec) and streamed
# out as ONE tar, never extracted on the host:
#
#   /srv/sentinela/backups/mosquitto/<UTC yyyymmddThhmmssZ>/mosquitto-data.tar
#                                                           /SHA256SUMS
# Keeps the newest KEEP backups. The tar holds password hashes: same care as a
# .env (root, 700/600).
#
# Overrides (tests only; the unit sets none): SENTINELA_BACKUP_DIR,
# SENTINELA_PROJECT, SENTINELA_MOSQUITTO_CONTAINER.
set -uo pipefail
umask 077
export LC_ALL=C
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

readonly BACKUP_DIR=${SENTINELA_BACKUP_DIR:-/srv/sentinela/backups/mosquitto}
readonly PROJECT=${SENTINELA_PROJECT:-sentinela-stack}
readonly KEEP=14
readonly NAME_RE='^[0-9]{8}T[0-9]{6}Z$'

log() { printf '%s mosquitto-backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

# ---- container ----------------------------------------------------------------
ctr=${SENTINELA_MOSQUITTO_CONTAINER:-}
if [ -z "$ctr" ]; then
  ctr=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" \
    --filter label=com.docker.compose.service=mosquitto --filter status=running)
  [ -n "$ctr" ] || die "no running mosquitto container in project $PROJECT"
  [ "$(printf '%s\n' "$ctr" | wc -l)" -eq 1 ] || die "more than one mosquitto container"
fi

# ---- destination ----------------------------------------------------------------
[ -L "$BACKUP_DIR" ] && die "$BACKUP_DIR is a symlink"
[ -d "$BACKUP_DIR" ] || die "$BACKUP_DIR missing (create it: install -d -m 700 $BACKUP_DIR)"
exec 9>>"$BACKUP_DIR/.lock" || die "cannot open lock"
flock -n 9 || die "another backup is running"
find -P "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -name '.partial-*' -exec rm -rf --one-file-system -- {} +

ts=$(date -u +%Y%m%dT%H%M%SZ)
work=$BACKUP_DIR/.partial-$ts
mkdir -m 700 -- "$work" || die "cannot create $work"
cleanup() { rm -rf --one-file-system -- "$work"; }
trap cleanup EXIT

log "backup of container $ctr -> $BACKUP_DIR/$ts"
# passwd is replaced atomically (mv) by mqtt-user.sh under passwd.lock; taking the
# same lock (shared) avoids copying it mid-rotation. mosquitto.db is written by the
# broker to a temp file and renamed, so a plain read is consistent. passwd is
# mandatory; mosquitto.db may not exist yet on a fresh broker.
# shellcheck disable=SC2016  # runs in the container's sh
docker exec "$ctr" sh -c '
  set -e
  cd /mosquitto/data
  [ -f passwd ] || { echo "passwd missing in /mosquitto/data" >&2; exit 3; }
  files=passwd
  [ -f mosquitto.db ] && files="$files mosquitto.db"
  if command -v flock >/dev/null 2>&1 && [ -f passwd.lock ]; then
    exec flock -s passwd.lock tar -cf - $files
  fi
  exec tar -cf - $files
' >"$work/mosquitto-data.tar" || die "reading /mosquitto/data failed"

# Sanity: readable tar holding a non-empty passwd (listing only, never extracted here).
members=$(tar -tvf "$work/mosquitto-data.tar") || die "backup tar is unreadable"
awk '$NF == "passwd" && $3 > 0 { ok = 1 } END { exit !ok }' <<<"$members" \
  || die "backup has no non-empty passwd"
( cd -- "$work" && sha256sum mosquitto-data.tar >SHA256SUMS ) || die "checksum failed"
mv -T -- "$work" "$BACKUP_DIR/$ts" || die "cannot finalize $BACKUP_DIR/$ts"
trap - EXIT
log "ok: $BACKUP_DIR/$ts ($(stat -c %s -- "$BACKUP_DIR/$ts/mosquitto-data.tar") bytes)"

# ---- retention: newest $KEEP complete backups ------------------------------------
mapfile -t all < <(find -P "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
  | grep -E "$NAME_RE" | sort)
excess=$(( ${#all[@]} - KEEP ))
for (( i = 0; i < excess; i++ )); do
  rm -rf --one-file-system -- "${BACKUP_DIR:?}/${all[$i]}" && log "removed old backup ${all[$i]}"
done
