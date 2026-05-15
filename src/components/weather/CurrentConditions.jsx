import { Thermometer, Droplets, Gauge, Waves, Eye, Wind } from "lucide-react";
import WindArrow from "./WindArrow";

function StatCard({ icon: Icon, label, value, unit, color = "primary" }) {
  const colorMap = {
    primary: "text-primary bg-primary/8",
    accent: "text-accent bg-accent/8",
    success: "text-success bg-success/10",
    warning: "text-warning bg-warning/10",
    ocean: "text-ocean bg-ocean/8",
  };

  return (
    <div className="bg-white rounded-2xl shadow-card p-4 flex items-center gap-3 hover:shadow-card-hover transition-shadow duration-200">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colorMap[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className="text-lg font-bold font-space text-foreground leading-tight">
          {value}
          {unit && <span className="text-sm font-normal text-muted-foreground ml-0.5">{unit}</span>}
        </p>
      </div>
    </div>
  );
}

export default function CurrentConditions({ data }) {
  const { current } = data;
  const oneDec = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(1) : v);
  const int0 = (v) => (Number.isFinite(Number(v)) ? String(Math.round(Number(v))) : v);
  const wind = Number(current.windSpeed);
  const heroBg = !Number.isFinite(wind)
    ? "#1d4ed8"
    : wind < 5
      ? "#38bdf8"
      : wind < 10
        ? "#1d4ed8"
        : wind < 15
          ? "#16a34a"
          : wind < 20
            ? "#eab308"
            : wind < 25
              ? "#dc2626"
              : "#7c3aed";

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-space font-semibold text-foreground text-lg">Condiciones Actuales</h2>
        <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
          {data.name}
        </span>
      </div>

      {/* Hero wind card */}
      <div className="rounded-2xl shadow-card p-6 mb-4 text-white relative overflow-hidden" style={{ backgroundColor: heroBg }}>
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-4 right-8 w-32 h-32 rounded-full border-2 border-white" />
          <div className="absolute top-8 right-12 w-20 h-20 rounded-full border-2 border-white" />
        </div>
        <div className="relative z-10 flex items-center justify-between">
          <div>
            <p className="text-white/70 text-sm font-medium mb-1">Viento</p>
            <div className="flex items-end gap-2">
              <span className="text-5xl font-bold font-space">{oneDec(current.windSpeed)}</span>
              <span className="text-xl text-white/80 mb-1">kn</span>
            </div>
            <p className="text-white/80 text-sm mt-1">
              Racha: <span className="font-semibold text-white">{oneDec(current.windGust)} kn</span>
            </p>
          </div>
          <div className="flex flex-col items-center gap-3">
            <WindArrow direction={current.windDir} size={72} />
            <span className="text-white font-semibold text-lg">{current.windDirText}</span>
          </div>
        </div>
      </div>

      {/* Grid of stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard icon={Thermometer} label="Temperatura" value={oneDec(current.temp)} unit="°C" color="warning" />
        <StatCard icon={Waves} label="Temp. del Mar" value={oneDec(current.seaTemp)} unit="°C" color="accent" />
        <StatCard icon={Droplets} label="Humedad" value={int0(current.humidity)} unit="%" color="primary" />
        <StatCard icon={Gauge} label="Presión" value={int0(current.pressure)} unit=" hPa" color="ocean" />
        <StatCard icon={Waves} label="Altura Ola" value={oneDec(current.waveHeight)} unit=" m" color="accent" />
        <StatCard icon={Eye} label="Visibilidad" value={current.visibility} color="success" />
      </div>
    </section>
  );
}
