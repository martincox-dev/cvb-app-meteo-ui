import { MapContainer, TileLayer, Marker, Popup, Circle } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { Wind, Thermometer, Droplets } from "lucide-react";

// Fix leaflet default marker icons in Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function windColor(speed) {
  if (speed <= 8)  return "#38bdf8";
  if (speed <= 14) return "#22c55e";
  if (speed <= 20) return "#eab308";
  if (speed <= 28) return "#f97316";
  return "#ef4444";
}

function createWindIcon(speed, isMain) {
  const color = windColor(speed);
  const size = isMain ? 44 : 36;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 44 44">
    <circle cx="22" cy="22" r="20" fill="${color}" stroke="white" stroke-width="2.5" opacity="0.92"/>
    <text x="22" y="27" text-anchor="middle" font-size="${isMain ? 12 : 11}" font-weight="bold" fill="white" font-family="sans-serif">${speed}</text>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

// Mock stations — Castellón province coastal stations
const STATIONS = [
  {
    id: "cvb",
    name: "CVB – Puerto Benicàssim",
    lat: 40.065,
    lon: 0.069,
    isMain: true,
    wind: 14,
    gust: 20,
    dir: "SSO",
    temp: 22.4,
    humidity: 68,
    source: "Estación Club de Vela",
  },
  {
    id: "oropesa",
    name: "Oropesa del Mar",
    lat: 40.104,
    lon: 0.128,
    wind: 12,
    gust: 17,
    dir: "S",
    temp: 22.1,
    humidity: 65,
    source: "AEMET 8500X",
  },
  {
    id: "castellon",
    name: "Castellón de la Plana",
    lat: 39.986,
    lon: -0.036,
    wind: 10,
    gust: 14,
    dir: "SO",
    temp: 23.8,
    humidity: 55,
    source: "AEMET 8500",
  },
  {
    id: "vinaros",
    name: "Vinaròs",
    lat: 40.469,
    lon: 0.473,
    wind: 18,
    gust: 25,
    dir: "NE",
    temp: 20.5,
    humidity: 72,
    source: "AEMET 8293X",
  },
  {
    id: "peniscola",
    name: "Peñíscola",
    lat: 40.362,
    lon: 0.406,
    wind: 16,
    gust: 22,
    dir: "NNE",
    temp: 21.0,
    humidity: 70,
    source: "AEMET 8301",
  },
  {
    id: "nules",
    name: "Nules – La Vall d'Uixó",
    lat: 39.858,
    lon: -0.154,
    wind: 8,
    gust: 11,
    dir: "O",
    temp: 24.5,
    humidity: 50,
    source: "AEMET 8486X",
  },
  {
    id: "sagunto",
    name: "Puerto de Sagunto",
    lat: 39.670,
    lon: -0.220,
    wind: 9,
    gust: 13,
    dir: "OSO",
    temp: 23.2,
    humidity: 58,
    source: "AEMET 8416Y",
  },
];

export default function StationsMap() {
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-space font-semibold text-foreground text-lg">
          Estaciones Meteorológicas — Provincia de Castellón
        </h2>
        <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
          Datos simulados · Actualización: cada 10 min
        </span>
      </div>

      <div className="bg-white rounded-2xl shadow-card overflow-hidden">
        {/* Wind speed legend */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border/50 bg-muted/20">
          <span className="text-xs font-semibold text-muted-foreground">Viento:</span>
          {[
            { label: "≤8 kn", color: "#38bdf8" },
            { label: "9–14 kn", color: "#22c55e" },
            { label: "15–20 kn", color: "#eab308" },
            { label: "21–28 kn", color: "#f97316" },
            { label: ">28 kn", color: "#ef4444" },
          ].map((l) => (
            <span key={l.label} className="flex items-center gap-1.5 text-xs font-medium">
              <span className="w-3 h-3 rounded-full inline-block border border-white/50" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>

        <MapContainer
          center={[40.065, 0.069]}
          zoom={9}
          style={{ height: 480, width: "100%" }}
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {STATIONS.map((st) => (
            <Marker
              key={st.id}
              position={[st.lat, st.lon]}
              icon={createWindIcon(st.wind, st.isMain)}
            >
              {st.isMain && (
                <Circle
                  center={[st.lat, st.lon]}
                  radius={3000}
                  pathOptions={{ color: windColor(st.wind), fillColor: windColor(st.wind), fillOpacity: 0.08, weight: 1.5 }}
                />
              )}
              <Popup className="leaflet-popup-custom" maxWidth={240}>
                <div className="p-1 min-w-[200px]">
                  <p className="font-semibold text-sm text-foreground mb-2">
                    {st.isMain && <span className="text-primary">★ </span>}
                    {st.name}
                  </p>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-xs">
                      <Wind className="w-3.5 h-3.5 text-primary" />
                      <span className="text-muted-foreground">Viento:</span>
                      <span className="font-bold" style={{ color: windColor(st.wind) }}>{st.wind} kn</span>
                      <span className="text-muted-foreground">({st.dir})</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Wind className="w-3.5 h-3.5 text-accent" />
                      <span className="text-muted-foreground">Racha:</span>
                      <span className="font-semibold text-foreground">{st.gust} kn</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Thermometer className="w-3.5 h-3.5 text-warning" />
                      <span className="text-muted-foreground">Temp:</span>
                      <span className="font-semibold text-foreground">{st.temp} °C</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Droplets className="w-3.5 h-3.5 text-sky" />
                      <span className="text-muted-foreground">Humedad:</span>
                      <span className="font-semibold text-foreground">{st.humidity} %</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
                    Fuente: {st.source}
                  </p>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </section>
  );
}