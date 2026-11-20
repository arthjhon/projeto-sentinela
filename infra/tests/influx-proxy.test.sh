#!/usr/bin/env bash
# shellcheck disable=SC2015,SC2317  # `cond && pass || fail` (pass never fails); trap fn
# Live route test for infra/nginx/sentinela-influx-proxy.conf (named InfluxQL
# queries under /influx/q/): a throwaway
# InfluxDB (2.7.12) plus an nginx (1.22.1, the Debian 12 version) that shares
# its network namespace (so the proxy's 127.0.0.1:8086 is the throwaway
# InfluxDB; nothing is published on the host and no host network is touched).
# nginx loads the REAL versioned files: sentinela.conf, sentinela-http.conf,
# sentinela-influx-proxy.conf. The proxy token is a real read-only (iot + externos) token
# created with the influx CLI (read iot + externos); it is written to a temp file only and never
# printed. Needs docker + jq. Containers and the anonymous volume are removed on exit.
set -u

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
nginx_dir=$(cd "$here/../nginx" && pwd)
readonly INFLUX_IMAGE=influxdb:2.7.12
readonly NGINX_IMAGE=nginx:1.22.1
id=s4t-proxy-$$
influx_ctr=$id-influxdb
nginx_ctr=$id-nginx
tmp=$(mktemp -d)
fails=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; fails=$((fails + 1)); }
teardown() {
  docker rm -f -v "$nginx_ctr" "$influx_ctr" >/dev/null 2>&1
  rm -rf "$tmp"
}
trap teardown EXIT

# The InfluxQL limits and GOMEMLIMIT come from the real compose file, and the
# container gets its real memory limit, so the OOM regression tests below prove
# what production would do.
compose=$here/../stack/compose.yml
limit_env=()
while IFS= read -r kv; do limit_env+=(-e "$kv"); done < <(
  sed -n -E 's/^[[:space:]]+((INFLUXD_(INFLUXQL|QUERY)_[A-Z_]+|GOMEMLIMIT)):[[:space:]]*"?([^"#]+)"?[[:space:]]*$/\1=\4/p' "$compose")
[ "${#limit_env[@]}" -ge 14 ] || { echo "cannot read limits from $compose"; exit 1; }
admin="test-admin-$RANDOM$RANDOM$RANDOM"
docker run -d --rm --name "$influx_ctr" -m 768m "${limit_env[@]}" \
  -e DOCKER_INFLUXDB_INIT_MODE=setup -e DOCKER_INFLUXDB_INIT_USERNAME=admin \
  -e DOCKER_INFLUXDB_INIT_PASSWORD=test-password-123 -e DOCKER_INFLUXDB_INIT_ORG=sentinela \
  -e DOCKER_INFLUXDB_INIT_BUCKET=iot -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN="$admin" \
  "$INFLUX_IMAGE" >/dev/null || { echo "cannot start influxdb"; exit 1; }
ix() { INFLUX_TOKEN=$admin docker exec -e INFLUX_TOKEN -e INFLUX_ORG=sentinela "$influx_ctr" influx "$@"; }
for _ in $(seq 60); do
  docker exec "$influx_ctr" influx ping >/dev/null 2>&1 && ix bucket list >/dev/null 2>&1 && break
  sleep 1
done

# Seed data, a second bucket, and the read-only (iot + externos) token.
iot_id=$(ix bucket list --json | jq -r '[.[] | select(.name == "iot")][0].id')
ix bucket create --name other --retention 0 >/dev/null
ix write -b iot 'sensores,topic=boia1 temperatura=25.5'
ix write -b other 'segredo,topic=x valor=1'
# 30 days of one device at 5 s, 3 fields (518k rows): the largest real query is its raw export.
python3 - "$(date +%s)" >"$tmp/seed.lp" <<'PY'
import sys
now = int(sys.argv[1]); n = 30 * 86400 // 5
for i in range(n):
    print(f"sensores,topic=esp_x/sensores temperatura={25 + i % 7 * 0.1},ph={7 + i % 5 * 0.01},turbidez={i % 50} {now - (n - i) * 5}")
PY
docker cp "$tmp/seed.lp" "$influx_ctr:/tmp/seed.lp"
ix write -b iot -p s -f /tmp/seed.lp
# A second device with a distinct ph (9.5), to check the device filter.
now=$(date +%s)
ix write -b iot -p s "sensores,topic=esp_y/sensores temperatura=20,ph=9.5,turbidez=5 $((now - 10))
sensores,topic=esp_y/sensores temperatura=20,ph=9.5,turbidez=5 $((now - 20))"
other_id=$(ix bucket list --json | jq -r '[.[] | select(.name == "other")][0].id')
wr_token=$(ix auth create --description worker --read-bucket "$iot_id" --write-bucket "$other_id" --json | jq -r '.token')
# externos (ANA data), with the explicit DBRP the bootstrap creates; the proxy token reads iot + externos.
ix bucket create --name externos --retention 0 >/dev/null
ext_id=$(ix bucket list --json | jq -r '[.[] | select(.name == "externos")][0].id')
ix v1 dbrp create --db externos --rp autogen --bucket-id "$ext_id" >/dev/null
# 2026-05-01T03:00:00Z = 1777604400. Two ANA points in the window (chuva 1.5 + 2.5 -> sum 4) and one buoy point.
ix write -b externos -p s "ana_telemetria,estacao=39770000 chuva=1.5,vazao=10,nivel=2 1777604400
ana_telemetria,estacao=39770000 chuva=2.5,vazao=20,nivel=4 1777605300
ana_telemetria,estacao=39760000 chuva=9,vazao=1,nivel=1 1777604400"
ix write -b iot -p s "sensores,topic=esp_x/sensores turbidez=30 1777604400
sensores,topic=esp_x/sensores turbidez=50 1777605300
sensores,topic=esp_y/sensores turbidez=999 1777604400"
ro_token=$(ix auth create --description nginx-publico --read-bucket "$iot_id" --read-bucket "$ext_id" --json | jq -r '.token')
[ -n "$ro_token" ] && [ "$ro_token" != null ] || { echo "cannot create read-only token"; exit 1; }

# The vhost's root dir does not exist here; only the proxy routes matter.
umask 022
# shellcheck disable=SC2016  # literal nginx variable
printf 'set $influx_token "%s";\n' "$ro_token" >"$tmp/token.conf"
docker run -d --rm --name "$nginx_ctr" --network "container:$influx_ctr" \
  -v "$nginx_dir/sentinela.conf:/etc/nginx/conf.d/sentinela.conf:ro" \
  -v "$nginx_dir/sentinela-http.conf:/etc/nginx/conf.d/sentinela-http.conf:ro" \
  -v "$nginx_dir/sentinela-influx-proxy.conf:/etc/nginx/sentinela.d/influx-proxy.conf:ro" \
  -v "$tmp/token.conf:/etc/nginx/sentinela-influx-token.conf:ro" \
  "$NGINX_IMAGE" >/dev/null || { echo "cannot start nginx"; exit 1; }
for _ in $(seq 30); do
  docker exec "$nginx_ctr" curl -s -o /dev/null http://127.0.0.1:8088/influx/health && break
  sleep 1
done

H='Host: sentinela.arthlabs.dev'
U=http://127.0.0.1:8088/influx
# req <curl args...>: prints "<status>\n<body>" of a request made from inside nginx's netns.
# Paced below the 5 r/s limit_req so the route checks do not trip it (the burst test at the end covers it).
req() { sleep 0.25; docker exec "$nginx_ctr" curl -s -w '\n%{http_code}' -H "$H" "$@"; }
code() { req "$@" | tail -n1; }
body() { req "$@" | sed '$d'; }

api() { local n=$1; shift; req -G "$U/q/$n" "$@"; }   # GET /influx/q/<n> with --data-urlencode args
st() { tail -n1; }
bd() { sed '$d'; }
# check <name> <jq filter over the JSON body> <curl-args for api...>: status 200 + filter true
check() {
  local name=$1 filter=$2 ep=$3 out
  shift 3
  out=$(api "$ep" "$@")
  [ "$(st <<<"$out")" = 200 ] && jq -e "$filter" <<<"$(bd <<<"$out")" >/dev/null 2>&1 \
    && pass "$name" || fail "$name: $(head -c 300 <<<"$out")"
}
# status <expected> <name> <curl args...>
status() {
  local want=$1 name=$2 c
  shift 2
  c=$(code "$@")
  [ "$c" = "$want" ] && pass "$name -> $want" || fail "$name -> $c (want $want)"
}
alive() { [ "$(docker inspect -f '{{.State.Running}} {{.State.OOMKilled}}' "$influx_ctr")" = 'true false' ] \
  && [ "$(code "$U/health")" = 200 ]; }

# ---- each named endpoint returns the expected values on seeded data ---------------------
check "history ph 1h: mean series, epoch ms" \
  '.results[0].series[0].columns == ["time","mean"] and (.results[0].series[0].values | length > 50) and .results[0].series[0].values[0][0] > 1000000000000' \
  history --data-urlencode campo=ph --data-urlencode periodo=1h
check "history temperatura 24h" '.results[0].series[0].values | length > 100' history --data-urlencode campo=temperatura --data-urlencode periodo=24h
check "history turbidez 7d" '.results[0].series[0].values | length > 100' history --data-urlencode campo=turbidez --data-urlencode periodo=7d
check "history ph 30d, 6h buckets" '.results[0].series[0].values | length | . >= 119 and . <= 122' history --data-urlencode campo=ph --data-urlencode periodo=30d
check "history ph 1h device=esp_y only sees esp_y (mean 9.5)" \
  '[.results[0].series[0].values[][1]] | all(. == 9.5)' history --data-urlencode campo=ph --data-urlencode periodo=1h --data-urlencode device=esp_y
check "history ph 1h device=esp_x excludes esp_y" \
  '[.results[0].series[0].values[][1]] | all(. < 8)' history --data-urlencode campo=ph --data-urlencode periodo=1h --data-urlencode device=esp_x
check "ultimas esp_x 24h: 50 rows, newest first, columns order" \
  '.results[0].series[0] | .columns == ["time","turbidez","ph","temperatura"] and (.values | length == 50) and .values[0][0] > .values[1][0]' \
  ultimas --data-urlencode device=esp_x --data-urlencode periodo=24h
check "ultimas esp_x 30d: 50 rows" '.results[0].series[0].values | length == 50' ultimas --data-urlencode device=esp_x --data-urlencode periodo=30d
check "leituras-24h: count of ph in 24h" '.results[0].series[0].values[0][1] | . >= 17000 and . <= 17400' leituras-24h
# shellcheck disable=SC2016  # jq variable
check "primeira: oldest ph is 7 and ~30 days old" \
  '.results[0].series[0].values[0] as $v | $v[1] == 7 and ($v[0] < ((now - 29 * 86400) * 1000))' primeira
check "export esp_x 1h: columns, ~720 rows, newest first (ORDER BY time DESC)" \
  '.results[0].series[0] | .columns == ["time","temperatura","ph","turbidez"] and (.values | length | . >= 700 and . <= 740) and (.values[0][0] > .values[1][0]) and (.values[0][0] > ((now - 30) * 1000))' \
  export --data-urlencode device=esp_x --data-urlencode periodo=1h
check "export esp_x 30d: ~518k rows (the seed spans exactly 30 d)" '.results[0].series[0].values | length | . >= 518000 and . <= 518400' export --data-urlencode device=esp_x --data-urlencode periodo=30d
check "export esp_y: only its 2 rows" '.results[0].series[0].values | length == 2' export --data-urlencode device=esp_y --data-urlencode periodo=24h
check "export unknown device: empty result, not an error" '.results[0] | has("error") | not' export --data-urlencode device=nao_existe --data-urlencode periodo=24h
status 200 "/influx/health" "$U/health"
check "ana 39770000 7d: 15m buckets from T03:00Z, other station excluded" \
  '.results[0].series[0] | .columns == ["time","chuva","vazao","nivel"] and .values == [[1777604400000,1.5,10,2],[1777605300000,2.5,20,4]]' \
  ana --data-urlencode estacao=39770000 --data-urlencode inicio=2026-05-01 --data-urlencode duracao=7d
check "ana 39770000 30d: 1h bucket from T03:00Z, chuva summed (4), vazao/nivel means" \
  '.results[0].series[0].values == [[1777604400000,4,15,3]]' \
  ana --data-urlencode estacao=39770000 --data-urlencode inicio=2026-05-01 --data-urlencode duracao=30d
check "ana 39770000 180d: first 6h bucket on 03:00Z, other station excluded" \
  '.results[0].series[0].values | length == 1 and .[0][0] == 1777604400000 and .[0][1] == 4' \
  ana --data-urlencode estacao=39770000 --data-urlencode inicio=2026-05-01 --data-urlencode duracao=180d
check "ana outside the window: no series, no error" '.results[0] | has("error") | not' \
  ana --data-urlencode estacao=39770000 --data-urlencode inicio=2026-06-01 --data-urlencode duracao=7d
check "turbidez-janela esp_x 7d: 15m buckets (esp_y excluded)" \
  '.results[0].series[0].values == [[1777604400000,30],[1777605300000,50]]' \
  turbidez-janela --data-urlencode device=esp_x --data-urlencode inicio=2026-05-01 --data-urlencode duracao=7d
check "turbidez-janela esp_x 30d: mean 40" \
  '.results[0].series[0].values == [[1777604400000,40]]' \
  turbidez-janela --data-urlencode device=esp_x --data-urlencode inicio=2026-05-01 --data-urlencode duracao=30d

# ---- invalid / missing parameters -> 400 ------------------------------------------------
for qs in "" "campo=ph" "periodo=1h" "campo=foo&periodo=1h" "campo=ph&periodo=2h" "campo=ph&periodo=1h&device=bad%27id" \
          "campo=ph&periodo=1h&device=a%22b" "campo=ph&periodo=1h&device=a%5Cb" "campo=ph&periodo=1h&device=a%2Fb" \
          "campo=ph&periodo=1h&device=a%3Bb" "campo=ph&periodo=1h&device=a+b" "campo=ph&periodo=1h&device=$(printf 'a%.0s' $(seq 41))" \
          "campo=ph,ph&periodo=1h" "campo=ph%22)%20FROM%20%22sensores%22%3B%20DROP%20MEASUREMENT%20%22sensores&periodo=1h" \
          "campo=ph&periodo=30d%20OR%201%3D1"; do
  status 400 "history ?$qs" "$U/q/history?$qs"
done
for qs in "" "device=esp_x" "periodo=24h" "device=esp_x&periodo=7d" "device=esp_x&periodo=1h" "device=&periodo=24h" "device=%27%20OR%20%271%27%3D%271&periodo=24h" "device=a%22b&periodo=24h"; do
  status 400 "ultimas ?$qs" "$U/q/ultimas?$qs"
done
for qs in "" "device=esp_x" "periodo=1h" "device=esp_x&periodo=90d" "device=esp_x&periodo=all" "device=x%27&periodo=1h" "device=*&periodo=1h" "device=esp_x&periodo=1h%3BDROP"; do
  status 400 "export ?$qs" "$U/q/export?$qs"
done

A="estacao=39770000&inicio=2026-05-01&duracao=7d"
for qs in "" "inicio=2026-05-01&duracao=7d" "estacao=39770000&duracao=7d" "estacao=39770000&inicio=2026-05-01" \
          "estacao=39770001&inicio=2026-05-01&duracao=7d" "estacao=39770000%27&inicio=2026-05-01&duracao=7d" \
          "estacao=39770000&inicio=2026-5-1&duracao=7d" "estacao=39770000&inicio=2026-13-01&duracao=7d" \
          "estacao=39770000&inicio=2026-05-32&duracao=7d" "estacao=39770000&inicio=1999-05-01&duracao=7d" \
          "estacao=39770000&inicio=2026-05-01%27&duracao=7d" "estacao=39770000&inicio=2026-05-01T00:00&duracao=7d" \
          "estacao=39770000&inicio=2026-05-01&duracao=365d" "estacao=39770000&inicio=2026-05-01&duracao=1d" \
          "estacao=39770000&inicio=2026-05-01&duracao=7d%20OR%201%3D1"; do
  status 400 "ana ?$qs" "$U/q/ana?$qs"
done
for qs in "" "inicio=2026-05-01&duracao=7d" "device=esp_x&duracao=7d" "device=esp_x&inicio=2026-05-01" \
          "device=&inicio=2026-05-01&duracao=7d" "device=a%27b&inicio=2026-05-01&duracao=7d" \
          "device=esp_x&inicio=2026-5-1&duracao=7d" "device=esp_x&inicio=2026-05-01&duracao=365d"; do
  status 400 "turbidez-janela ?$qs" "$U/q/turbidez-janela?$qs"
done

# ---- free-form q and everything else are gone ------------------------------------------
status 404 "GET /influx/query?q=..." "$U/query?db=iot&q=SHOW%20MEASUREMENTS"
status 404 "POST /influx/api/v2/query (Flux)" -X POST "$U/api/v2/query?org=sentinela" -H 'Content-Type: application/vnd.flux' --data 'from(bucket:"iot")|>range(start:-1h)'
status 404 "GET /influx/api/v2/buckets" "$U/api/v2/buckets"
status 404 "POST /influx/write" -X POST "$U/write?db=iot" --data 'sensores,topic=x temperatura=1'
status 404 "/influx/q/ (no name)" "$U/q/"
status 404 "/influx/q/outra" "$U/q/outra?campo=ph&periodo=1h"
status 404 "/influx/q/history/ (trailing slash)" "$U/q/history/?campo=ph&periodo=1h"
# --path-as-is: without it curl normalizes the `..` client-side and the proxy never sees it
status 404 "/influx/q/history/../query (--path-as-is)" --path-as-is "$U/q/history/../query?q=SHOW%20DATABASES"
for ep in "history?campo=ph&periodo=1h" "ultimas?device=esp_x&periodo=24h" "leituras-24h" "primeira" "export?device=esp_x&periodo=1h" \
          "ana?$A" "turbidez-janela?device=esp_x&inicio=2026-05-01&duracao=7d"; do
  status 403 "POST /influx/q/$ep" -X POST "$U/q/$ep"
  status 403 "HEAD /influx/q/$ep" -I "$U/q/$ep"
  status 403 "OPTIONS /influx/q/$ep" -X OPTIONS "$U/q/$ep"
done
status 403 "POST /influx/health" -X POST "$U/health"

# ---- client-controlled inputs never reach InfluxDB -------------------------------------
# Every one of these must return the NAMED query result (history columns time,mean)
# and change nothing: free-form q, u/p credentials, db/rp/epoch/chunked, repeated and
# case-variant params, a request body.
H1="campo=ph&periodo=1h"
inert() { # name, extra query string
  local out
  out=$(req "$U/q/history?$H1&$2")
  [ "$(st <<<"$out")" = 200 ] && jq -e '.results[0].series[0].columns == ["time","mean"]' <<<"$(bd <<<"$out")" >/dev/null 2>&1 \
    && pass "ignored: $1" || fail "$1 changed the result: $(head -c 250 <<<"$out")"
}
inert "q=SHOW DATABASES" "q=SHOW%20DATABASES"
inert "q with SELECT * FROM sensores x200 (OOM shape)" "q=SELECT%20*%20FROM%20$(printf 'sensores,%.0s' $(seq 200))sensores"
inert "q with ;-chained statements" "q=SELECT%20*%20FROM%20sensores%3BSELECT%20*%20FROM%20sensores"
inert "q=DROP MEASUREMENT + u/p write token" "u=x&p=$wr_token&q=DROP%20MEASUREMENT%20sensores"
inert "u/p admin token" "u=admin&p=$admin"
inert "db=other, rp, epoch=ns, chunked, pretty" "db=other&rp=x&epoch=ns&chunked=true&chunk_size=1&pretty=true"
inert "DB/Q uppercase variants" "DB=other&Q=SHOW%20DATABASES"
out=$(req "$U/q/ana?$A&db=iot&q=SHOW%20DATABASES&epoch=ns")
[ "$(st <<<"$out")" = 200 ] && jq -e '.results[0].series[0].columns == ["time","chuva","vazao","nivel"] and .results[0].series[0].values[0][0] == 1777604400000' <<<"$(bd <<<"$out")" >/dev/null 2>&1 \
  && pass "ignored on ana: db/q/epoch from the client" || fail "ana honoured client params: $(head -c 250 <<<"$out")"
m=$(api primeira | bd | jq -r '.results[0].series[0].values[0][1]')
c=$(api leituras-24h | bd | jq -r '.results[0].series[0].values[0][1]')
[ "$m" = 7 ] && [ "$c" -ge 17000 ] && pass "data intact after the DROP/u-p attempts" || fail "data changed (first=$m count=$c)"
out=$(req "$U/q/history?$H1" -H 'Authorization: Token bogus-client-token')
[ "$(st <<<"$out")" = 200 ] && pass "client Authorization overwritten (bogus token still 200)" || fail "client Authorization honoured: $(st <<<"$out")"
out=$(req "$U/q/history?$H1" -H "Authorization: Token $admin")
[[ $(bd <<<"$out") == *'"mean"'* ]] && pass "client admin Authorization replaced by the proxy token" || fail "admin Authorization: $out"
b=$(body -X GET "$U/q/history?$H1" --form-string 'q=SHOW DATABASES' --form-string "p=$admin")
[[ $b == *'"mean"'* && $b != *_internal* ]] && pass "small multipart body ignored" || fail "body used: $b"
status 413 "body over 1k" -X GET "$U/q/history?$H1" --form-string "q=$(head -c 3000 /dev/zero | tr '\0' a)"
hdr=$(docker exec "$nginx_ctr" curl -s -D - -o /dev/null -H "$H" "$U/q/history?$H1")
for ep in "history?$H1" "ultimas?device=esp_x&periodo=24h" "leituras-24h" "primeira" "export?device=esp_y&periodo=1h" \
          "ana?$A" "turbidez-janela?device=esp_x&inicio=2026-05-01&duracao=7d"; do
  sleep 0.25
  h=$(docker exec "$nginx_ctr" curl -s -D - -o /dev/null -H "$H" "$U/q/$ep")
  [ "$(grep -ci '^cache-control: no-store' <<<"$h")" = 1 ] && pass "Cache-Control: no-store on /influx/q/${ep%%\?*}" || fail "Cache-Control on /influx/q/${ep%%\?*}: $(head -n1 <<<"$h")"
done
grep -qiE '^x-influxdb-|^x-platform-error-code' <<<"$hdr" && fail "InfluxDB headers exposed" || pass "X-Influxdb-* / X-Platform-Error-Code hidden"
b=$(body "$U/q/history?campo=ph&periodo=1h&device=esp_y")
[[ $b != *segredo* ]] && pass "other bucket never reachable" || fail "other bucket leaked"

# ---- cost: concurrency caps, InfluxDB survives ------------------------------------------
codes=$(for _ in 1 2 3 4; do
  docker exec "$nginx_ctr" curl -s -o /dev/null -w '%{http_code}\n' -H "$H" -G "$U/q/export" --data-urlencode device=esp_x --data-urlencode periodo=30d &
done; wait)
n200=$(grep -c '^200$' <<<"$codes"); n429=$(grep -c '^429$' <<<"$codes")
[ "$n200" -ge 1 ] && [ "$n429" -ge 1 ] && [ $((n200 + n429)) -eq 4 ] && pass "4 simultaneous 30d exports: $n200 x 200, $n429 x 429 (limit_conn 1)" || fail "export limit_conn: $(tr '\n' ' ' <<<"$codes")"
alive && pass "InfluxDB alive, not OOM-killed, after the exports" || fail "InfluxDB died under exports"
codes=$(for _ in $(seq 8); do
  docker exec "$nginx_ctr" curl -s -o /dev/null -w '%{http_code}\n' -H "$H" -G "$U/q/history" --data-urlencode campo=ph --data-urlencode periodo=30d &
done; wait)
n200=$(grep -c '^200$' <<<"$codes"); n429=$(grep -c '^429$' <<<"$codes")
[ "$n200" -ge 1 ] && [ $((n200 + n429)) -eq 8 ] && pass "8 simultaneous 30d histories: $n200 x 200, $n429 x 429, no 5xx" || fail "history concurrency: $(tr '\n' ' ' <<<"$codes")"
alive && pass "InfluxDB alive at the end" || fail "InfluxDB died"
# ---- export LIMIT: a topic inflated from outside cannot OOM InfluxDB ---------------------
# Telegraf accepts +/sensores and the device MQTT credential is public, so any topic's
# volume can be inflated. 4.2M rows in 30 days (> the 2.07M rows that took 564 MiB; the
# unbounded 4.67M-row export was OOM-killed at 768m) must come back capped at 600000.
python3 - "$(date +%s)" >"$tmp/flood.lp" <<'PY'
import sys
now = int(sys.argv[1]) * 10**9; n = 4_200_000; step = 30 * 86400 * 10**9 // n
for i in range(n):
    print(f"sensores,topic=flood/sensores temperatura=1,ph=7,turbidez=1 {now - (n - i) * step + step}")
PY
docker cp "$tmp/flood.lp" "$influx_ctr:/tmp/flood.lp" && ix write -b iot -p ns -f /tmp/flood.lp
rm -f "$tmp/flood.lp"
sleep 1
out=$(api export --data-urlencode device=flood --data-urlencode periodo=30d)
n=$(bd <<<"$out" | jq '.results[0].series[0].values | length')
[ "$(st <<<"$out")" = 200 ] && [ "$n" -gt 0 ] && [ "$n" -le 600000 ] \
  && pass "export of a 4.2M-row topic capped at $n rows (<= 600000)" || fail "flood export: status $(st <<<"$out"), rows $n"
alive && pass "InfluxDB alive, not OOM-killed, after the flooded-topic export" || fail "InfluxDB died on the flooded-topic export"

# ---- limit_req: 30 rapid GETs exceed 5 r/s + burst 10 -> some 429 (limit_req_status) ------
# Last on purpose: the burst empties the zone's bucket; nothing else runs after it.
sleep 3
codes=$(docker exec "$nginx_ctr" sh -c 'for _ in $(seq 30); do curl -s -o /dev/null -w "%{http_code}\n" -H "$0" "$1"; done' "$H" "$U/health")
n200=$(grep -c '^200$' <<<"$codes"); n429=$(grep -c '^429$' <<<"$codes")
[ "$n200" -ge 5 ] && [ "$n429" -ge 1 ] && [ $((n200 + n429)) -eq 30 ] && pass "limit_req: 30 rapid GETs -> $n200 x 200, $n429 x 429" || fail "limit_req burst: $(sort <<<"$codes" | uniq -c | tr '\n' ' ')"

docker exec "$nginx_ctr" nginx -t >/dev/null 2>&1 && pass "nginx -t" || fail "nginx -t"

echo
if [ "$fails" -eq 0 ]; then echo "ALL PASS"; else echo "$fails FAILED"; fi
exit "$fails"
