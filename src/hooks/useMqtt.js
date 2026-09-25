import { useEffect, useRef, useState } from 'react';
import mqtt from 'mqtt';
import { parseMqttPayload } from '../utils/mqttPayload';
import { newTopicsOnly } from '../utils/mqttTopics';

// Configurações do broker HiveMQ Cloud.
// Todas as três variáveis são obrigatórias em .env.local:
//   VITE_MQTT_BROKER_URL=wss://<seu-cluster>.hivemq.cloud:8884/mqtt
//   VITE_MQTT_USER=<usuario>
//   VITE_MQTT_PASS=<senha>
const BROKER_URL = import.meta.env.VITE_MQTT_BROKER_URL;
const MQTT_USER  = import.meta.env.VITE_MQTT_USER;
const MQTT_PASS  = import.meta.env.VITE_MQTT_PASS;

if (!BROKER_URL || !MQTT_USER || !MQTT_PASS) {
  console.error('useMqtt: VITE_MQTT_BROKER_URL, VITE_MQTT_USER e VITE_MQTT_PASS são obrigatórios em .env.local');
}

/**
 * Hook que mantém uma conexão MQTT persistente com o broker HiveMQ
 * e devolve o último payload recebido por tópico.
 *
 * @param {string[]} topics - Lista de tópicos para subscrever na montagem.
 * @returns {{ messages: Object, connected: boolean, publish: Function, addTopics: Function }}
 *   messages: objeto { [topico]: ultimoPayloadParsed }
 *   connected: true enquanto a conexão WebSocket estiver ativa
 */
export function useMqtt(topics = []) {
  const [messages, setMessages]   = useState({});
  const [connected, setConnected] = useState(false);
  const clientRef = useRef(null);
  const extraTopicsRef = useRef(new Set());

  useEffect(() => {
    if (!BROKER_URL || !MQTT_USER || !MQTT_PASS) return;

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
      // Subscreve a união dos tópicos da montagem com os adicionados via
      // addTopics — necessário tanto na primeira conexão (quando addTopics
      // já rodou antes do 'connect', ex. registro dinâmico do Supabase)
      // quanto em toda reconexão (mqtt.js reemite 'connect'; sessões são
      // limpas, então o broker esquece as subscrições anteriores).
      const allTopics = newTopicsOnly(new Set(), [...topics, ...extraTopicsRef.current]);
      if (allTopics.length > 0) {
        client.subscribe(allTopics, (err) => {
          if (err) console.error('MQTT: erro ao subscrever tópicos', err);
        });
      }
    });

    client.on('message', (topic, payload) => {
      setMessages(prev => ({ ...prev, [topic]: parseMqttPayload(payload.toString()) }));
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
   * Subscreve em tópicos adicionais após a montagem do hook.
   * Útil quando novas bóias são cadastradas dinamicamente (ex.: registro
   * Supabase, cujo fetch normalmente resolve antes do 'connect' MQTT numa
   * montagem nova). Idempotente — chamadas repetidas com a mesma lista
   * (ex.: a cada atualização do registro) não geram subscribe duplicado.
   * Se o cliente ainda não estiver conectado, os tópicos só ficam
   * registrados aqui; o handler 'connect' os subscreve quando a conexão
   * (ou reconexão) acontecer.
   * @param {string[]} newTopics
   */
  const addTopics = (newTopics) => {
    if (!newTopics?.length) return;
    const toAdd = newTopicsOnly(extraTopicsRef.current, newTopics);
    if (toAdd.length === 0) return;
    toAdd.forEach((topic) => extraTopicsRef.current.add(topic));
    if (clientRef.current?.connected) {
      clientRef.current.subscribe(toAdd, (err) => {
        if (err) console.error('MQTT: erro ao subscrever novos tópicos', err);
      });
    }
  };

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

  return { messages, connected, publish, addTopics };
}
