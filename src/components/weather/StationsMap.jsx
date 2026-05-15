import { MapContainer, TileLayer, Marker, Popup, Circle } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { Wind, Thermometer, Droplets } from "lucide-react";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function windColor(speed) {
  if (speed <= 8) return "#38bdf8";
  if (speed <= 14) return "#22c55e";
  if (speed <= 20) return "#eab308";
  if (speed <= 28) return "#f97316";
  return "#ef4444";
}

function createWindIcon(speed, isMain) {
  const color = windColor(speed || 0);
  const size = isMain ? 44 : 36;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 44 44">
    <circle cx="22" cy="22" r="20" fill="${color}" stroke="white" stroke-width="2.5" opacity="0.92"/>
    <text x="22" y="27" text-anchor="middle" font-size="${isMain ? 12 : 11}" font-weight="bold" fill="white" font-family="sans-serif">${Math.round(speed || 0)}</text>
  </svg>`;
  return L.divIcon({ html: svg, className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2] });
}

export default function StationsMap({ stations = [] }) {
  const main = stations[0];
  const center = main ? [main.lat, main.lon] : [40.065, 0.069];

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-space font-semibold text-foreground text-lg">Estaciones meteorológicas accesibles por API</h2>
        <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">Fuente: Windguru Stations API</span>
      </div>

      <div className="bg-white rounded-2xl shadow-card overflow-hidden">
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

        <MapContainer center={center} zoom={9} style={{ height: 480, width: "100%" }} scrollWheelZoom={false}>
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          {stations.map((st, idx) => (
            <Marker key={st.id || `${st.lat}-${st.lon}-${idx}`} position={[st.lat, st.lon]} icon={createWindIcon(st.wind, idx === 0)}>
              {idx === 0 && (
                <Circle center={[st.lat, st.lon]} radius={3000} pathOptions={{ color: windColor(st.wind), fillColor: windColor(st.wind), fillOpacity: 0.08, weight: 1.5 }} />
              )}
              <Popup maxWidth={240}>
                <div className="p-1 min-w-[200px]">
                  <p className="font-semibold text-sm text-foreground mb-2">{idx === 0 && <span className="text-primary">★ </span>}{st.name}</p>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-xs">
                      <Wind className="w-3.5 h-3.5 text-primary" />
                      <span className="text-muted-foreground">Viento:</span>
                      <span className="font-bold" style={{ color: windColor(st.wind) }}>{Math.round(st.wind || 0)} kn</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Wind className="w-3.5 h-3.5 text-accent" />
                      <span className="text-muted-foreground">Racha:</span>
                      <span className="font-semibold text-foreground">{Math.round(st.gust || 0)} kn</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Thermometer className="w-3.5 h-3.5 text-warning" />
                      <span className="text-muted-foreground">Temp:</span>
                      <span className="font-semibold text-foreground">{Number(st.temp || 0).toFixed(1)} °C</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Droplets className="w-3.5 h-3.5 text-sky" />
                      <span className="text-muted-foreground">Humedad:</span>
                      <span className="font-semibold text-foreground">{Math.round(st.humidity || 0)} %</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">Fuente: {st.source || "API"}</p>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </section>
  );
}
