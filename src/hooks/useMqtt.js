import { useEffect, useRef, useState } from 'react';
import mqtt from 'mqtt';

// Configurações do broker HiveMQ Cloud.
// Adicione estas variáveis ao seu .env.local:
//   VITE_MQTT_BROKER_URL=wss://be2e9cb2203e45e3a2e11013afc84924.s1.eu.hivemq.cloud:8884/mqtt
//   VITE_MQTT_USER=esp32
//   VITE_MQTT_PASS=Admin2023
const BROKER_URL = import.meta.env.VITE_MQTT_BROKER_URL
  ?? 'wss://be2e9cb2203e45e3a2e11013afc84924.s1.eu.hivemq.cloud:8884/mqtt';
const MQTT_USER  = import.meta.env.VITE_MQTT_USER ?? 'esp32';
const MQTT_PASS  = import.meta.env.VITE_MQTT_PASS ?? 'Admin2023';

/**
 * Hook que mantém uma conexão MQTT persistente com o broker HiveMQ
 * e devolve o último payload recebido por tópico.
 *
 * @param {string[]} topics - Lista de tópicos para subscrever na montagem.
 * @returns {{ messages: Object, connected: boolean }}
 *   messages: objeto { [topico]: ultimoPayloadParsed }
 *   connected: true enquanto a conexão WebSocket estiver ativa
 */
export function useMqtt(topics = []) {
  const [messages, setMessages]   = useState({});
  const [connected, setConnected] = useState(false);
  const clientRef = useRef(null);

  useEffect(() => {
    // Gera um clientId único para evitar colisões de sessão
    const clientId = `sentinela_web_${Math.random().toString(16).slice(2, 8)}`;

    const client = mqtt.connect(BROKER_URL, {
      username:        MQTT_USER,
      password:        MQTT_PASS,
      clientId,
      reconnectPeriod: 5000,  // tenta reconectar a cada 5 s
      keepalive:       60,
    });

    client.on('connect', () => {
      setConnected(true);
      // Subscreve em todos os tópicos recebidos na montagem do hook
      if (topics.length > 0) {
        client.subscribe(topics, (err) => {
          if (err) console.error('MQTT: erro ao subscrever tópicos', err);
        });
      }
    });

    client.on('message', (topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());
        setMessages(prev => ({ ...prev, [topic]: data }));
      } catch {
        console.warn(`MQTT: payload não-JSON recebido no tópico "${topic}"`);
      }
    });

    client.on('offline',      ()    => setConnected(false));
    client.on('reconnect',    ()    => setConnected(false));
    client.on('error',        (err) => console.error('MQTT erro:', err));

    clientRef.current = client;

    // Encerra a conexão quando o componente for desmontado
    return () => {
      client.end(true);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // conecta apenas uma vez — os tópicos são estáveis na montagem

  /**
   * Publica uma mensagem em um tópico MQTT.
   * @param {string} topic
   * @param {object|string} payload — objeto será serializado em JSON
   * @returns {boolean} true se a mensagem foi enfileirada com sucesso
   */
  const publish = (topic, payload) => {
    if (!clientRef.current?.connected) {
      console.warn(`MQTT: tentativa de publicar em "${topic}" sem conexão ativa.`);
      return false;
    }
    const msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return clientRef.current.publish(topic, msg);
  };

  return { messages, connected, publish };
}
