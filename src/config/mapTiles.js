// Basemap compartilhado do mapa público e do modal "Detalhes da bóia".
// CartoDB Dark Matter exige key desde 2026 (gratuita, sem conta:
// carto.com/basemaps/apikey — tiles sem key chegam com marca d'água "API KEY
// REQUIRED"). Com VITE_CARTO_BASEMAPS_KEY definida usa o Carto; sem ela cai no
// Esri World Dark Gray (sem cadastro), que é cinza-médio e ganha um filtro de
// escurecimento só nessa camada (`fallback: true`; cada mapa tem a sua classe CSS).
// Ordem {z}/{y}/{x} no Esri: serviços ArcGIS usam row/col, não x/y.
const CARTO_KEY = import.meta.env.VITE_CARTO_BASEMAPS_KEY;

export const TILES = CARTO_KEY
  ? {
      url: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`,
      subdomains: 'abcd',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      fallback: false,
    }
  : {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      attribution: '&copy; <a href="https://www.esri.com">Esri</a>',
      fallback: true,
    };
