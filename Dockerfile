# ── Stage 1: build ───────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Variáveis injetadas em tempo de build pelo docker-compose
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_MQTT_BROKER_URL
ARG VITE_MQTT_USER
ARG VITE_MQTT_PASS
# Identificadores públicos (não segredos): o cliente precisa deles para montar
# a query Flux. O token do Influx NÃO entra aqui de propósito — ele é injetado
# em runtime pelo nginx (ver nginx.conf), fora do bundle.
ARG VITE_INFLUX_ORG
ARG VITE_INFLUX_BUCKET

RUN npm run build

# ── Stage 2: serve ────────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
# templates/ (e não conf.d/): o entrypoint do nginx:alpine roda envsubst nos
# arquivos daqui no boot, injetando INFLUXDB_URL e INFLUXDB_READ_TOKEN em
# runtime. Em conf.d/ o token teria de ser assado na imagem.
COPY nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 80
