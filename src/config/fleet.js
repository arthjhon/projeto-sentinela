// Semente síncrona da frota: só identidade (código, serial, rótulo de lagoa). Não é a
// fonte da verdade: o cadastro é `map_buoys` (services/buoyRegistry.js); isto só vale
// como fallback e para os tópicos MQTT iniciais. Nada de campo inventado aqui
// (bateria, datas de instalação/manutenção, coordenadas): quem precisar lê do
// cadastro, do firmware (/status) ou do banco.
export const FLEET = [
  {
    id: 'SM-01',
    deviceId: 'snt-0001',
    // ids antigos da placa: leituras gravadas neles continuam no histórico
    deviceIdsAnteriores: ['esp_sururu'],
    name: 'Bóia Mundaú Centro',
    location: 'Lagoa Mundaú',
  },
  {
    id: 'SM-02',
    deviceId: null,
    name: 'Bóia Mundaú Sul',
    location: 'Lagoa Mundaú',
  },
  {
    id: 'MG-01',
    deviceId: null,
    name: 'Bóia Manguaba Norte',
    location: 'Lagoa Manguaba',
  },
];

// Retorna tópicos MQTT de todos os devices com hardware cadastrado.
// suffixes: substrings após o deviceId (ex: ['sensores', 'status']). O default
// inclui 'availability' (LWT do firmware — status real da bóia) e é o mesmo de
// topicsForRegistry (services/buoyRegistry.js): os dois ficam em sincronia.
export const getMqttTopics = (suffixes = ['sensores', 'status', 'availability']) =>
  FLEET
    .filter(b => b.deviceId)
    .flatMap(b => suffixes.map(s => `${b.deviceId}/${s}`));
