import { AlertTriangle, CheckCircle, Info, Clock } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const levelConfig = {
  verde: {
    bg: "bg-success/8",
    border: "border-success/30",
    badge: "bg-success/15 text-success",
    icon: CheckCircle,
    iconColor: "text-success",
  },
  amarillo: {
    bg: "bg-warning/8",
    border: "border-warning/30",
    badge: "bg-warning/15 text-warning",
    icon: AlertTriangle,
    iconColor: "text-warning",
  },
  naranja: {
    bg: "bg-orange-50",
    border: "border-orange-200",
    badge: "bg-orange-100 text-orange-700",
    icon: AlertTriangle,
    iconColor: "text-orange-500",
  },
  rojo: {
    bg: "bg-destructive/8",
    border: "border-destructive/30",
    badge: "bg-destructive/15 text-destructive",
    icon: AlertTriangle,
    iconColor: "text-destructive",
  },
};

function AlertCard({ alert }) {
  const config = levelConfig[alert.level] || levelConfig.verde;
  const Icon = config.icon;

  const from = new Date(alert.validFrom);
  const to = new Date(alert.validTo);

  return (
    <div className={`rounded-2xl border p-4 ${config.bg} ${config.border} transition-all`}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <Icon className={`w-5 h-5 ${config.iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${config.badge}`}>
              {alert.levelLabel}
            </span>
            <span className="text-xs font-medium text-foreground">{alert.phenomenon}</span>
          </div>
          <p className="text-xs text-muted-foreground font-medium mb-1">{alert.area}</p>
          <p className="text-sm text-foreground leading-relaxed">{alert.description}</p>
          <div className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>
              {format(from, "EEE dd/MM HH:mm", { locale: es })} — {format(to, "HH:mm", { locale: es })}
            </span>
            <span className="ml-auto text-xs text-muted-foreground/70">Fuente: {alert.source}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AemetAlerts({ alerts }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-space font-semibold text-foreground text-lg">Alertas AEMET</h2>
        <a
          href="https://www.aemet.es/es/rss_info/avisos/val"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline font-medium"
        >
          Ver en AEMET →
        </a>
      </div>
      <div className="space-y-3">
        {alerts.map((alert) => (
          <AlertCard key={alert.id} alert={alert} />
        ))}
      </div>
    </section>
  );
}
