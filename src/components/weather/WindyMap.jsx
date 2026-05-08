import { useState } from "react";
import { Map, Layers, ExternalLink, Cpu } from "lucide-react";

const LAYERS = [
  { id: "wind",     label: "Viento",      windyId: "wind" },
  { id: "waves",    label: "Oleaje",      windyId: "waves" },
  { id: "rain",     label: "Lluvia",      windyId: "rain" },
  { id: "temp",     label: "Temperatura", windyId: "temp" },
  { id: "pressure", label: "Presión",     windyId: "pressure" },
];

const MODELS = [
  { id: "ecmwf",  label: "ECMWF",  desc: "Global · Alta resolución" },
  { id: "arome",  label: "AROME",  desc: "Francia/Iberia · 1.3km" },
  { id: "gfs",    label: "GFS",    desc: "NOAA · Global" },
  { id: "icon",   label: "ICON",   desc: "DWD · Europa" },
];

// Benicàssim coordinates
const LAT = 40.065;
const LON = 0.069;
const ZOOM = 9;

export default function WindyMap() {
  const [activeLayer, setActiveLayer] = useState("wind");
  const [activeModel, setActiveModel] = useState("arome");

  const iframeSrc = `https://embed.windy.com/embed2.html?lat=${LAT}&lon=${LON}&detailLat=${LAT}&detailLon=${LON}&width=650&height=450&zoom=${ZOOM}&level=surface&overlay=${activeLayer}&product=${activeModel}&menu=&message=true&marker=true&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=kt&metricTemp=%C2%B0C&radarRange=-1`;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-space font-semibold text-foreground text-lg flex items-center gap-2">
          <Map className="w-4 h-4 text-primary" />
          Mapa Windy — Benicàssim
        </h2>
        <a
          href={`https://www.windy.com/${LAT}/${LON}?${activeLayer},${ZOOM}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
        >
          Abrir en Windy
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Model selector */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Cpu className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <span className="text-xs text-muted-foreground font-medium mr-1">Modelo:</span>
        {MODELS.map((model) => (
          <button
            key={model.id}
            onClick={() => setActiveModel(model.id)}
            title={model.desc}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all
              ${activeModel === model.id
                ? "bg-ocean text-white shadow-sm"
                : "bg-white border border-border text-muted-foreground hover:border-ocean/40 hover:text-ocean"
              }`}
          >
            {model.label}
          </button>
        ))}
      </div>

      {/* Layer selector */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Layers className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        {LAYERS.map((layer) => (
          <button
            key={layer.id}
            onClick={() => setActiveLayer(layer.windyId)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all
              ${activeLayer === layer.windyId
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-white border border-border text-muted-foreground hover:border-primary/40 hover:text-primary"
              }`}
          >
            {layer.label}
          </button>
        ))}
      </div>

      {/* Map iframe */}
      <div className="bg-white rounded-2xl shadow-card overflow-hidden">
        <iframe
          title="Windy Map Benicàssim"
          src={iframeSrc}
          width="100%"
          height="450"
          frameBorder="0"
          className="block w-full"
          style={{ minHeight: 320 }}
        />
      </div>
      <p className="text-xs text-muted-foreground mt-2 text-right">
        Datos: Windy.com · Modelo: <span className="font-medium">{MODELS.find(m => m.id === activeModel)?.label}</span>
        {" "}({MODELS.find(m => m.id === activeModel)?.desc}) · Unidades en nudos y °C
      </p>
    </section>
  );
}