#!/usr/bin/env bash
# Compose policy validator: the security boundary of the root deploy.
#
#   validate-compose.sh <config.json> <allowed-images-file>
#
# <config.json> is the output of `docker compose config --format json`, rendered
# with `--project-directory "$ALLOWED_BIND_ROOT"` so relative binds resolve there.
# Exit 0 + "OK" (allowed), exit 1 + one "DENY: <service>: <reason>" line per
# violation (denied; control characters in values are JSON-escaped), exit 2
# (bad input: fail closed, nothing may be deployed).
#
# Env:
#   ALLOWED_BIND_ROOT  absolute dir bind sources must live under (default /srv/sentinela/stack)
#   SUPABASE_NETWORK   the only external network a stack may join (unset = none)
#   EXPECTED_PROJECT   compose project name the config must carry (default sentinela-stack);
#                      the deploy renders with `-p $EXPECTED_PROJECT`
#
# Everything not explicitly allowed is denied: services, service keys, mount
# types, networks, images. Requires bash + jq only.
set -u

fail_input() { echo "validate-compose: $*" >&2; exit 2; }

[ "$#" -eq 2 ] || fail_input "usage: validate-compose.sh <config.json> <allowed-images-file>"
config=$1
allowed_file=$2
if ! [ -f "$config" ] || ! [ -r "$config" ]; then fail_input "cannot read config: $config"; fi
if ! [ -f "$allowed_file" ] || ! [ -r "$allowed_file" ]; then fail_input "cannot read allowed-images: $allowed_file"; fi
command -v jq >/dev/null 2>&1 || fail_input "jq not found"

project=${EXPECTED_PROJECT:-sentinela-stack}
case "$project" in
  *[!a-z0-9_-]* | "") fail_input "EXPECTED_PROJECT must match [a-z0-9_-]+: '$project'" ;;
esac
root=${ALLOWED_BIND_ROOT:-/srv/sentinela/stack}
while [ "${root%/}" != "$root" ]; do root=${root%/}; done
case "$root" in
  /?*) ;;
  *) fail_input "ALLOWED_BIND_ROOT must be an absolute path other than /: '$root'" ;;
esac
case "/$root/" in
  */../*) fail_input "ALLOWED_BIND_ROOT must not contain '..'" ;;
esac

# Structural sanity first: anything odd is bad input, not a policy decision.
jq -e '
  type == "object"
  and (.services | type == "object" and length > 0)
  and (.services | to_entries | all(.value | type == "object"))
' "$config" >/dev/null 2>&1 || fail_input "config is not a valid non-empty compose JSON document"

# shellcheck disable=SC2016  # jq program, not shell
program='
# ---- helpers ---------------------------------------------------------------
def present: . != null and . != false and . != "" and . != [] and . != {};
def extra_keys($o; $ok):
  if ($o | type) == "object" then [$o | to_entries[] | select((.value | present) and ((.key as $k | $ok | index($k)) == null)) | .key] else [] end;
def deny($c; $m): if $c then $m else empty end;
# Output escaping: messages interpolate rendered values (which can hold .env
# content and, via YAML block scalars, raw newlines). Every control character
# (C0/C1, incl. \n \r) is written as its JSON escape, so one violation is
# always exactly one output line and no value can forge a "DENY:" line.
def esc: gsub("(?<c>[\\p{Cc}])"; .c | tojson | .[1:-1]);
# Inside $root, with no ".." segment (blocks traversal). The trailing slash
# keeps /srv/sentinela/stack-incoming from matching /srv/sentinela/stack.
def under_root($p):
  ($p | type == "string") and ($p | startswith($root + "/"))
  and (($p | split("/") | any(. == "..")) | not);

($allowed | split("\n")
  | map(gsub("\r"; "") | gsub("^\\s+|\\s+$"; ""))
  | map(select(length > 0 and (startswith("#") | not)))) as $entries

# Rule list ONE: services permitted at all.
| ["influxdb", "telegraf", "worker"] as $svc_allowed

# Rule list TWO: keys denied outright (value present = violation).
| ["devices", "device_cgroup_rules", "gpus", "runtime", "build", "volumes_from",
   "cgroup_parent", "sysctls", "use_api_socket", "post_start", "pre_stop",
   "cap_add", "userns_mode", "uts", "cgroup", "pid", "privileged"] as $svc_denied

# Rule list THREE: keys allowed on a service. Any other present key is denied,
# so a compose feature added tomorrow is denied by default.
| ["image", "restart", "ports", "volumes", "environment", "mem_limit", "healthcheck",
   "depends_on", "command", "entrypoint", "networks", "security_opt", "labels",
   "user", "working_dir", "expose", "tmpfs", "read_only", "cap_drop", "extra_hosts",
   "dns", "ulimits", "stop_grace_period", "stop_signal", "logging", "deploy", "init",
   "mem_reservation", "memswap_limit", "cpus", "pids_limit", "hostname",
   "container_name", "platform", "pull_policy", "tty", "stdin_open", "annotations",
   "shm_size", "group_add", "domainname", "network_mode", "ipc", "profiles"] as $svc_keys

# Rule list FOUR: the only security_opt values permitted (no *=unconfined,
# apparmor=/seccomp=/label=/systempaths= tweaks, no-new-privileges:false).
| ["no-new-privileges", "no-new-privileges:true", "no-new-privileges=true"] as $secopt_ok

# Rule list FIVE: fixed volume names allowed besides <project>_<key>.
| ["sentinela-influxdb-data", "sentinela-influxdb-config"] as $vol_names

# Image policy: exact entry, or the worker pattern line (40-hex tag or sha256 digest).
| "ghcr.io/arthjhon/sentinela-worker:<sha>" as $worker_line
| "^ghcr\\.io/arthjhon/sentinela-worker(:[0-9a-f]{40}|@sha256:[0-9a-f]{64})\\z" as $worker_re
| ($entries | map(select(. != $worker_line))) as $exact
| ($entries | index($worker_line) != null) as $worker_ok
| (.networks // {}) as $top_networks

| (
  # ---- per-service rules ----
  (.services | to_entries[]) as $e | $e.key as $n | $e.value as $v
  | (
      # R1: only whitelisted services.
      deny(($svc_allowed | index($n)) == null; "unknown service"),

      # R2: denied keys (privileged, cap_add, devices, volumes_from, sysctls, ...).
      ($svc_denied[] as $k | deny($v[$k] | present; "\($k) not allowed")),

      # R3: any key outside the allowlist (future compose features).
      ($v | keys[] as $k
        | deny(($svc_keys | index($k)) == null and ($svc_denied | index($k)) == null
               and ($v[$k] | present); "key not allowed: \($k)")),

      # R4: network_mode may only be none/bridge (blocks host, service:*, container:*).
      deny(($v.network_mode | present) and (["none", "bridge"] | index($v.network_mode)) == null;
           "network_mode not allowed: \($v.network_mode)"),

      # R5: ipc must not be host, service:* or container:*.
      deny(($v.ipc | present) and ($v.ipc | tostring | test("^(host$|service:|container:)"));
           "ipc not allowed: \($v.ipc)"),

      # R6: security_opt: allowlist only.
      (($v.security_opt // [])[] as $o
        | deny(($secopt_ok | index($o)) == null; "security_opt not allowed: \($o)")),

      # R7: published ports only on 127.0.0.1 (empty host_ip means 0.0.0.0).
      (($v.ports // [])[] as $p
        | deny(($p.host_ip // "") != "127.0.0.1";
               "port \($p.published // $p.target) published on \(if ($p.host_ip // "") == "" then "0.0.0.0" else $p.host_ip end), only 127.0.0.1 allowed")),

      # R8: mounts: bind/volume/tmpfs only; never docker.sock; binds under root.
      (($v.volumes // [])[] as $m
        | deny(["bind", "volume", "tmpfs"] | index($m.type) == null;
               "mount type not allowed: \($m.type)"),
          deny(($m.source // "") | test("docker\\.sock"); "docker.sock mount: \($m.source)"),
          deny($m.type == "bind" and (under_root($m.source // "") | not);
               "bind outside \($root): \($m.source // "")"),
          # Mount propagation (rshared etc.) can leak mounts across the host namespace.
          deny(($m.bind.propagation // "") | present; "bind propagation not allowed: \($m.bind.propagation)")),

      # R9: telegraf may mount only its read-only config.
      (if $n == "telegraf" then
         (($v.volumes // [])[] as $m
          | deny(($m.type == "bind" and $m.source == ($root + "/telegraf/telegraf.conf")
                  and $m.target == "/etc/telegraf/telegraf.conf" and $m.read_only == true) | not;
                 "telegraf extra mount: \($m.source // $m.target)"))
       else empty end),

      # R15: container_name must be namespaced (no "db"/"kong" impersonation on shared nets).
      deny(($v.container_name | present) and (($v.container_name | startswith("sentinela-")) | not);
           "container_name must start with sentinela-: \($v.container_name)"),

      # R16: attachments to an external (shared) network must be empty: no aliases,
      # static IPs, mac_address, driver_opts, priorities (DNS/ARP/sysctl tricks).
      (($v.networks // {}) | if type == "object" then to_entries[] else empty end
        | .key as $nk | .value as $att
        | select($top_networks[$nk].external | present)
        | deny(($att | present); "attachment options not allowed on external network \($nk)")),

      # R23: a service on an external network must drop NET_RAW (ARP spoofing of Supabase).
      deny((($v.networks // {}) | if type == "object" then keys else [] end
              | any(. as $nk | $top_networks[$nk].external | present))
           and ((($v.cap_drop // []) | any(. == "ALL" or . == "NET_RAW")) | not);
           "service on external network must cap_drop ALL or NET_RAW"),

      # R24: hostname/domainname are registered as DNS names on every attached network.
      (["hostname", "domainname"][] as $f
        | deny(($v[$f] | present) and (($v[$f] | startswith("sentinela-")) | not);
               "\($f) must start with sentinela-: \($v[$f])")),

      # R25: no fixed MAC address.
      deny($v.mac_address | present; "mac_address not allowed"),

      # R17: no com.docker.* labels (spoofing compose project/service identity).
      (if ($v.labels | type) == "array" then "labels must be a map"
       else (($v.labels // {}) | keys[] | select(startswith("com.docker.")) | "label not allowed: \(.)") end),

      # R18: log driver only json-file/local (others run inside dockerd on the host).
      deny(($v.logging.driver | present) and (["json-file", "local"] | index($v.logging.driver)) == null;
           "logging driver not allowed: \($v.logging.driver)"),
      # logging.options only with an explicit safe driver (otherwise daemon default applies).
      deny(($v.logging.options | present) and ((["json-file", "local"] | index($v.logging.driver // "")) == null);
           "logging.options requires driver json-file or local"),

      # R19: deploy limited to resource limits/reservations and restart policy (no devices etc.).
      (($v.deploy // {}) as $d
        | (extra_keys($d; ["resources", "restart_policy", "replicas"])[] | "deploy key not allowed: \(.)"),
          (extra_keys($d.resources; ["limits", "reservations"])[] | "deploy.resources key not allowed: \(.)"),
          (extra_keys($d.resources.limits; ["cpus", "memory", "pids"])[] | "deploy.resources.limits key not allowed: \(.)"),
          (extra_keys($d.resources.reservations; ["cpus", "memory"])[] | "deploy.resources.reservations key not allowed: \(.)")),

      # R10: images: tag required, never latest, must match allowed-images.
      (if ($v.image | type) != "string" then "image missing"
       else
         $v.image as $i
         | (($i | split("@")[0] | split("/") | last) | contains(":")) as $tagged
         | ($i | contains("@")) as $digest
         | if ($tagged or $digest) | not then "image not allowed (no tag): \($i)"
           elif ($i | split("@")[0] | split("/") | last | endswith(":latest")) then "image not allowed (latest): \($i)"
           elif ($exact | index($i)) != null then empty
           elif $worker_ok and ($i | test($worker_re)) then empty
           else "image not allowed: \($i)" end
       end)
    )
  | "DENY: \($n): \(.)"
),
(
  # ---- top-level rules ----
  # R11: only known top-level sections (x-* extensions are inert).
  (keys[] | select(. as $k | (["name", "services", "networks", "volumes", "configs", "secrets"] | index($k)) == null
                   and (startswith("x-") | not)) | "DENY: (top-level): key not allowed: \(.)"),

  # R20: project name must be the expected one (else networks/volumes/orphans collide with Supabase).
  deny(.name != $project; "DENY: (top-level): project name must be \($project), got \(.name)"),

  # R12: external networks: only $SUPABASE_NETWORK; no exotic drivers/options.
  ((.networks // {}) | to_entries[] | .key as $k | .value as $net
    | (deny(($net.external | present) and ($supabase == "" or $net.name != $supabase);
            "external network not allowed: \($net.name // $k)"),
       deny(($net.driver | present) and $net.driver != "bridge"; "network driver not allowed: \($net.driver)"),
       deny($net.driver_opts | present; "network driver_opts not allowed"),
       # R21: non-external networks: fixed project-scoped name (blocks name: host / foreign nets); no ipam.
       deny(($net.external | present | not) and $net.name != ($project + "_" + $k);
            "network name must be \($project)_\($k), got \($net.name)"),
       deny(["host", "bridge", "none"] | index($net.name) != null; "network name not allowed: \($net.name)"),
       deny($net.ipam | present; "network ipam not allowed"),
       deny(($net.labels // {}) | keys | any(startswith("com.docker.")); "com.docker.* label not allowed"))
    | "DENY: networks.\($k): \(.)"),

  # R13: named volumes: no external, no driver tricks (local+driver_opts can bind the host).
  ((.volumes // {}) | to_entries[] | .key as $k | .value as $vol
    | (deny($vol.external | present; "external volume not allowed"),
       deny(($vol.driver | present) and $vol.driver != "local"; "volume driver not allowed: \($vol.driver)"),
       deny($vol.driver_opts | present; "volume driver_opts not allowed"),
       deny(($vol.labels // {}) | keys | any(startswith("com.docker.")); "com.docker.* label not allowed"),
       # R22: volume name scoped to this project (blocks adopting Supabase volumes via name:).
       deny(($vol.name // "") as $vn | ($vn == ($project + "_" + $k) or ($vol_names | index($vn)) != null) | not;
            "volume name must be \($project)_\($k) or a listed volume, got \($vol.name)"))
    | "DENY: volumes.\($k): \(.)"),

  # R14: secrets/configs: file sources must live under root (else they read host files).
  ((.configs // {}) + (.secrets // {}) | to_entries[] | .key as $k | .value as $s
    | (deny($s.external | present; "external not allowed"),
       deny(($s.file | present) and (under_root($s.file) | not); "file outside \($root): \($s.file)"))
    | "DENY: secrets/configs.\($k): \(.)")
)
| esc
'

out=$(jq -r --arg root "$root" --arg supabase "${SUPABASE_NETWORK:-}" --arg project "$project" \
  --rawfile allowed "$allowed_file" "$program" "$config" 2>&1)
rc=$?
[ "$rc" -eq 0 ] || fail_input "jq evaluation failed: $out"

if [ -n "$out" ]; then
  printf '%s\n' "$out"
  exit 1
fi
echo OK
