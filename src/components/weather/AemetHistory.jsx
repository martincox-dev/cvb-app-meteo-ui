import { useState } from "react";
import { AlertTriangle, CheckCircle, Info, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const levelConfig = {
  verde:    { bg: "bg-success/8",      border: "border-success/30",     badge: "bg-success/15 text-success",         icon: CheckCircle,   iconColor: "text-success"    },
  amarillo: { bg: "bg-warning/8",      border: "border-warning/30",     badge: "bg-warning/15 text-warning",         icon: AlertTriangle, iconColor: "text-warning"    },
  naranja:  { bg: "bg-orange-50",      border: "border-orange-200",     badge: "bg-orange-100 text-orange-700",      icon: AlertTriangle, iconColor: "text-orange-500" },
  rojo:     { bg: "bg-destructive/8",  border: "border-destructive/30", badge: "bg-destructive/15 text-destructive", icon: AlertTriangle, iconColor: "text-destructive" },
};

// Mock historical alerts — Castellón litoral sur / Costeros Castellón sur
const HISTORY = [
  {
    id: "H010",
    level: "verde",
    levelLabel: "Sin Avisos",
    phenomenon: "General",
    area: "Litoral Sur de Castellón / Costeros Castellón Sur",
    description: "Sin avisos activos. Condiciones normales para la navegación de recreo en la zona sur del litoral castellonense.",
    validFrom: "2026-05-08T00:00:00",
    validTo: "2026-05-08T23:59:00",
    source: "AEMET",
  },
  {
    id: "H009",
    level: "amarillo",
    levelLabel: "Aviso Amarillo",
    phenomenon: "Viento",
    area: "Litoral Sur de Castellón",
    description: "Vientos del SSO con rachas de 40-50 km/h en la tarde-noche del jueves. Se recomienda precaución en embarcaciones menores y actividades náuticas.",
    validFrom: "2026-05-07T15:00:00",
    validTo: "2026-05-07T23:00:00",
    source: "AEMET",
  },
  {
    id: "H008",
    level: "naranja",
    levelLabel: "Aviso Naranja",
    phenomenon: "Fenómenos Costeros",
    area: "Costeros Castellón Sur",
    description: "Oleaje significativo de 1.5–2 m con período de 8–9 s. Puerto cerrado a embarcaciones de recreo de eslora inferior a 8 m.",
    validFrom: "2026-05-06T06:00:00",
    validTo: "2026-05-06T20:00:00",
    source: "AEMET",
  },
  {
    id: "H007",
    level: "amarillo",
    levelLabel: "Aviso Amarillo",
    phenomenon: "Lluvias",
    area: "Litoral Sur de Castellón",
    description: "Precipitaciones localmente fuertes (>20 mm/h) en zonas costeras del sur de Castellón. Posibles tormentas con aparato eléctrico.",
    validFrom: "2026-05-05T08:00:00",
    validTo: "2026-05-05T18:00:00",
    source: "AEMET",
  },
  {
    id: "H006",
    level: "verde",
    levelLabel: "Sin Avisos",
    phenomenon: "General",
    area: "Litoral Sur de Castellón / Costeros Castellón Sur",
    description: "Sin avisos activos. Viento flojo del NE. Mar en calma. Buenas condiciones para navegación.",
    validFrom: "2026-05-04T00:00:00",
    validTo: "2026-05-04T23:59:00",
    source: "AEMET",
  },
  {
    id: "H005",
    level: "rojo",
    levelLabel: "Aviso Rojo",
    phenomenon: "Fenómenos Costeros",
    area: "Costeros Castellón Sur",
    description: "Temporal de Levante con oleaje de 3–4 m y rachas superiores a 80 km/h. Puerto cerrado. Se suspenden todas las actividades náuticas.",
    validFrom: "2026-05-03T00:00:00",
    validTo: "2026-05-03T20:00:00",
    source: "AEMET",
  },
  {
    id: "H004",
    level: "naranja",
    levelLabel: "Aviso Naranja",
    phenomenon: "Viento",
    area: "Litoral Sur de Castellón",
    description: "Viento de Levante persistente con rachas de 60–70 km/h. Mar agitada con olas de 2–2.5 m en la costa.",
    validFrom: "2026-05-02T12:00:00",
    validTo: "2026-05-03T00:00:00",
    source: "AEMET",
  },
  {
    id: "H003",
    level: "amarillo",
    levelLabel: "Aviso Amarillo",
    phenomenon: "Viento",
    area: "Litoral Sur de Castellón / Costeros Castellón Sur",
    description: "Viento del E con rachas de 50 km/h. Marejada con olas de 1–1.5 m. Precaución en zonas de abrigo reducido.",
    validFrom: "2026-05-02T00:00:00",
    validTo: "2026-05-02T12:00:00",
    source: "AEMET",
  },
  {
    id: "H002",
    level: "verde",
    levelLabel: "Sin Avisos",
    phenomenon: "General",
    area: "Litoral Sur de Castellón / Costeros Castellón Sur",
    description: "Sin avisos activos para el fin de semana. Condiciones muy favorables: viento flojo variable, mar llana o rizada.",
    validFrom: "2026-05-01T00:00:00",
    validTo: "2026-05-01T23:59:00",
    source: "AEMET",
  },
  {
    id: "H001",
    level: "amarillo",
    levelLabel: "Aviso Amarillo",
    phenomenon: "Fenómenos Costeros",
    area: "Costeros Castellón Sur",
    description: "Oleaje de fondo de SSO residual de 1–1.5 m tras temporal de la semana anterior. Precaución en zonas de acceso al puerto.",
    validFrom: "2026-04-30T06:00:00",
    validTo: "2026-04-30T20:00:00",
    source: "AEMET",
  },
];

const ITEMS_INITIAL = 4;

function AlertRow({ alert }) {
  const config = levelConfig[alert.level] || levelConfig.verde;
  const Icon = config.icon;
  const from = new Date(alert.validFrom);
  const to = new Date(alert.validTo);
  const isPast = new Date() > to;

  return (
    <div className={`rounded-xl border p-3.5 ${config.bg} ${config.border} ${isPast ? "opacity-80" : ""} transition-all`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${config.iconColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${config.badge}`}>
              {alert.levelLabel}
            </span>
            <span className="text-xs font-medium text-foreground">{alert.phenomenon}</span>
            {isPast && (
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Archivado</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-medium mb-0.5">{alert.area}</p>
          <p className="text-sm text-foreground leading-relaxed">{alert.description}</p>
          <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>
              {format(from, "EEE dd/MM HH:mm", { locale: es })} — {format(to, "EEE dd/MM HH:mm", { locale: es })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AemetHistory() {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? HISTORY : HISTORY.slice(0, ITEMS_INITIAL);

  const counts = {
    rojo: HISTORY.filter(a => a.level === "rojo").length,
    naranja: HISTORY.filter(a => a.level === "naranja").length,
    amarillo: HISTORY.filter(a => a.level === "amarillo").length,
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-space font-semibold text-foreground text-lg">Historial de Avisos AEMET</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Litoral Sur de Castellón · Costeros Castellón Sur</p>
        </div>
        <a
          href="https://www.aemet.es/es/eltiempo/prediccion/avisos?p=46"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline font-medium"
        >
          Ver en AEMET →
        </a>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { label: "Avisos Rojos", count: counts.rojo, cls: "bg-destructive/10 text-destructive border-destructive/20" },
          { label: "Avisos Naranja", count: counts.naranja, cls: "bg-orange-50 text-orange-700 border-orange-200" },
          { label: "Avisos Amarillo", count: counts.amarillo, cls: "bg-warning/10 text-warning border-warning/20" },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border p-3 text-center ${s.cls}`}>
            <p className="text-2xl font-bold font-space">{s.count}</p>
            <p className="text-xs font-medium mt-0.5">{s.label}</p>
            <p className="text-xs opacity-70">últimos 10 días</p>
          </div>
        ))}
      </div>

      <div className="space-y-2.5">
        {visible.map(alert => <AlertRow key={alert.id} alert={alert} />)}
      </div>

      {HISTORY.length > ITEMS_INITIAL && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-4 w-full flex items-center justify-center gap-2 text-sm text-primary font-medium hover:underline py-2"
        >
          {expanded ? (
            <><ChevronUp className="w-4 h-4" /> Mostrar menos</>
          ) : (
            <><ChevronDown className="w-4 h-4" /> Ver {HISTORY.length - ITEMS_INITIAL} avisos más</>
          )}
        </button>
      )}
    </section>
  );
}