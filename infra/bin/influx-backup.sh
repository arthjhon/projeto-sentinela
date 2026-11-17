#!/bin/bash
# Daily InfluxDB backup, run as root by influx-backup.service (timer 03:30).
#
# `influx backup` runs inside the influxdb container (docker exec), into a
# temp dir there; the result is streamed out as ONE tar file and never
# extracted on the host (the container is not trusted to produce a safe tree).
#
#   /srv/sentinela/backups/influx/<UTC yyyymmddThhmmssZ>/influx-backup.tar
#                                                       /SHA256SUMS
# Keeps the newest KEEP backups. The operator token is read from TOKEN_FILE
# (root, mode 600) and passed as `docker exec -e INFLUX_TOKEN` (never argv).
#
# Overrides (tests only; the unit sets none): SENTINELA_BACKUP_DIR,
# SENTINELA_BACKUP_TOKEN_FILE, SENTINELA_PROJECT, SENTINELA_INFLUX_CONTAINER.
set -uo pipefail
umask 077
export LC_ALL=C
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

readonly BACKUP_DIR=${SENTINELA_BACKUP_DIR:-/srv/sentinela/backups/influx}
readonly TOKEN_FILE=${SENTINELA_BACKUP_TOKEN_FILE:-/usr/local/etc/sentinela/influx-backup.token}
readonly PROJECT=${SENTINELA_PROJECT:-sentinela-stack}
readonly KEEP=7
readonly NAME_RE='^[0-9]{8}T[0-9]{6}Z$'

log() { printf '%s influx-backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

# ---- token file: regular, ours, mode 600 ------------------------------------
[ -L "$TOKEN_FILE" ] && die "$TOKEN_FILE is a symlink"
[ -f "$TOKEN_FILE" ] || die "$TOKEN_FILE missing"
read -r t_uid t_mode <<<"$(stat -c '%u %a' -- "$TOKEN_FILE")"
[ "$t_uid" = "$(id -u)" ] || die "$TOKEN_FILE must be owned by uid $(id -u)"
[ "$t_mode" = 600 ] || [ "$t_mode" = 400 ] || die "$TOKEN_FILE must be mode 600 (is $t_mode)"
token=$(head -c 4096 -- "$TOKEN_FILE" | tr -d '\r\n')
[ -n "$token" ] || die "$TOKEN_FILE is empty"

# ---- container ----------------------------------------------------------------
ctr=${SENTINELA_INFLUX_CONTAINER:-}
if [ -z "$ctr" ]; then
  ctr=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" \
    --filter label=com.docker.compose.service=influxdb --filter status=running)
  [ -n "$ctr" ] || die "no running influxdb container in project $PROJECT"
  [ "$(printf '%s\n' "$ctr" | wc -l)" -eq 1 ] || die "more than one influxdb container"
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
# shellcheck disable=SC2016  # runs in the container's sh
INFLUX_TOKEN=$token docker exec -e INFLUX_TOKEN -e BK="/tmp/sentinela-backup-$ts" "$ctr" sh -c '
  set -e
  trap "rm -rf \"$BK\"" EXIT
  rm -rf "$BK"
  influx backup "$BK" >&2
  tar -C "$BK" -cf - .
' >"$work/influx-backup.tar" || die "influx backup failed"
unset token

# Sanity: a readable tar with a manifest (listing only, never extracted here).
members=$(tar -tf "$work/influx-backup.tar") || die "backup tar is unreadable"
grep -q '\.manifest$' <<<"$members" || die "backup has no manifest"
( cd -- "$work" && sha256sum influx-backup.tar >SHA256SUMS ) || die "checksum failed"
mv -T -- "$work" "$BACKUP_DIR/$ts" || die "cannot finalize $BACKUP_DIR/$ts"
trap - EXIT
log "ok: $BACKUP_DIR/$ts ($(stat -c %s -- "$BACKUP_DIR/$ts/influx-backup.tar") bytes)"

# ---- retention: newest $KEEP complete backups ------------------------------------
mapfile -t all < <(find -P "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
  | grep -E "$NAME_RE" | sort)
excess=$(( ${#all[@]} - KEEP ))
for (( i = 0; i < excess; i++ )); do
  rm -rf --one-file-system -- "${BACKUP_DIR:?}/${all[$i]}" && log "removed old backup ${all[$i]}"
done
