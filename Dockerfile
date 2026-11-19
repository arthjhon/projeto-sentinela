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
# O token do Influx NÃO entra aqui de propósito: o cliente só chama
# /influx/q/<nome>, atendido pelo nginx do host (ver nginx.conf).

RUN npm run build

# ── Stage 2: serve ────────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
# templates/: o entrypoint do nginx:alpine roda envsubst nos arquivos daqui no
# boot (hoje sem variáveis; nenhum segredo vai para a imagem).
COPY nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 80
