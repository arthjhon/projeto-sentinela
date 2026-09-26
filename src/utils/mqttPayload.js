/**
 * Faz parse de um payload MQTT: JSON quando possível, senão devolve a string
 * crua. Antes desta função, useMqtt descartava (com warning) qualquer payload
 * não-JSON — e o firmware publica `<deviceId>/availability` como string pura
 * ("online"/"offline"), não JSON, então esse tópico nunca era guardado.
 */
export function parseMqttPayload(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
