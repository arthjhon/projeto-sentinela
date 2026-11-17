# Infra — Sentinela

## MQTT ACL (pré-requisito)

Antes de subir a stack de dados, o broker HiveMQ Cloud precisa separar as permissões por
credencial (spec §7.3). A configuração é manual, no Access Management do cluster; o script
abaixo apenas verifica o resultado.

### O que o painel publica hoje

Levantado com `rg -n "\.publish\(" src` (o único ponto de publicação é o wrapper
`publish` do hook; a única página que o chama é a de OTA):

- `src/hooks/useMqtt.js:126` — `clientRef.current.publish(topic, msg)` (wrapper genérico)
- `src/pages/admin/OtaPage.jsx:219` — `publish(cmdTopic, cmd)`, com
  `cmdTopic = <deviceId>/ota/command` (`OtaPage.jsx:215`)

Não há publicação de ping no código atual.

### Credenciais

- **Credencial do browser (existente):** perde publish em `+/sensores`, `+/status` e
  `+/availability`. Mantém publish em `+/ota/command` (e subscribe como hoje).
- **Credencial do Telegraf (nova):** somente subscribe em `+/sensores` e `+/status`,
  sem nenhum publish.

As credenciais ficam fora do git (cofre/variáveis de ambiente).

### Verificação

```bash
read -rs MQTT_PASS; export MQTT_PASS   # fora do histórico do shell e do argv
infra/bin/mqtt-acl-check.sh <broker_host> <user> <device_id>
```

A senha é lida da variável de ambiente obrigatória `MQTT_PASS` (sem ela, exit 2).

Publica `{"ph":0}` em `<device_id>/sensores` com MQTT v5 / QoS 1 (porta 8883, TLS) e
interpreta a resposta do broker:

| Saída | Exit | Significado |
| --- | --- | --- |
| `ACL OK: publish rejected` | 0 | o broker negou o publish (esperado para a credencial do browser) |
| `ACL FAIL: publish accepted` | 1 | o broker aceitou o publish |
| `error: ...` | 2 | uso incorreto ou falha de conexão/autenticação (resultado inconclusivo) |

Sanidade: rodar com a credencial do device deve imprimir `ACL FAIL`. Atenção: o teste com a
credencial do device publica de fato uma leitura `{"ph":0}` no tópico do device informado;
use um `device_id` de teste.

Usa `mosquitto_pub` do PATH ou, se ausente, a imagem `eclipse-mosquitto:2.0.22` via docker.
O `mosquitto_pub` não recebe a senha na linha de comando: ela vai num arquivo de
configuração temporário com modo 600, removido ao sair; no fallback docker o arquivo é
montado somente leitura no container. O script em si também não recebe a senha por
argumento. Limitação: o arquivo existe brevemente em disco.

Teste local do script (broker mosquitto descartável, sem tocar em broker real):

```bash
infra/tests/mqtt-acl-check.test.sh
```
