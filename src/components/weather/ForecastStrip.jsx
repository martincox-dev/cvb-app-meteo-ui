import { Sun, Cloud, CloudRain, CloudSun } from "lucide-react";
import WindArrow from "./WindArrow";

const weatherIcons = {
  sunny: Sun,
  cloudy: Cloud,
  rainy: CloudRain,
  "partly-cloudy": CloudSun,
};

const seaStateColor = {
  "Llana": "text-success",
  "Rizada": "text-success",
  "Marejadilla": "text-warning",
  "Marejada": "text-destructive",
};

function windColor(speed) {
  if (speed <= 10) return "bg-success/15 text-success";
  if (speed <= 18) return "bg-warning/15 text-warning";
  if (speed <= 25) return "bg-orange-100 text-orange-600";
  return "bg-destructive/15 text-destructive";
}

export default function ForecastStrip({ forecast }) {
  return (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <h3 className="font-space font-semibold text-foreground mb-4">Previsión 7 días</h3>
      <div className="grid grid-cols-7 gap-2">
        {forecast.map((day, i) => {
          const Icon = weatherIcons[day.icon] || Sun;
          return (
            <div
              key={i}
              className={`flex flex-col items-center gap-2 p-2.5 rounded-xl transition-colors
                ${i === 0 ? "bg-primary/8 ring-1 ring-primary/20" : "hover:bg-muted"}`}
            >
              <span className={`text-xs font-semibold ${i === 0 ? "text-primary" : "text-muted-foreground"}`}>
                {day.day}
              </span>
              <Icon className={`w-5 h-5 ${i === 0 ? "text-primary" : "text-muted-foreground"}`} />
              <WindArrow
                direction={parseInt(day.dir === "SSO" ? 218 : day.dir === "ESE" ? 112 : day.dir === "ENE" ? 68 : day.dir === "SO" ? 225 : day.dir === "E" ? 90 : 0)}
                size={28}
                color={i === 0 ? "hsl(213,80%,40%)" : "hsl(215,15%,60%)"}
              />
              <span className="text-xs text-muted-foreground font-medium">{day.dir}</span>
              <div className={`text-xs font-bold px-2 py-0.5 rounded-full ${windColor(day.maxWind)}`}>
                {day.maxWind} kn
              </div>
              <div className={`text-xs font-semibold ${seaStateColor[day.seaState] || "text-muted-foreground"}`}>
                {day.waveH}m
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}