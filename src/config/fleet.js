// Fonte única de verdade para a frota de bóias do Projeto Sentinela.
// Todos os componentes que precisam de IDs, nomes ou device IDs devem importar daqui.
// Nunca defina listas de bóias separadas em outros arquivos.
export const FLEET = [
  {
    id: 'SM-01',
    deviceId: 'esp_sururu',
    name: 'Bóia Mundaú Centro',
    location: 'Lagoa Mundaú',
    coordinates: "9°39'21.1\"S 35°46'12.4\"W",
    installedAt: '12/05/2023',
    lastMaintenance: '01/03/2024',
    battery: 85,
  },
  {
    id: 'SM-02',
    deviceId: null,
    name: 'Bóia Mundaú Sul',
    location: 'Lagoa Mundaú',
    coordinates: "9°41'10.5\"S 35°47'05.2\"W",
    installedAt: '20/08/2023',
    lastMaintenance: '15/02/2024',
    battery: 60,
  },
  {
    id: 'MG-01',
    deviceId: null,
    name: 'Bóia Manguaba Norte',
    location: 'Lagoa Manguaba',
    coordinates: "9°35'14.2\"S 35°50'22.1\"W",
    installedAt: '10/01/2024',
    lastMaintenance: '10/01/2024',
    battery: 92,
  },
];

// Retorna tópicos MQTT de todos os devices com hardware cadastrado.
// suffixes: substrings após o deviceId (ex: ['sensores', 'status'])
export const getMqttTopics = (suffixes = ['sensores', 'status']) =>
  FLEET
    .filter(b => b.deviceId)
    .flatMap(b => suffixes.map(s => `${b.deviceId}/${s}`));
