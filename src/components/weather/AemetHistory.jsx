import { useState } from "react";
import { AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const levelConfig = {
  verde: { bg: "bg-success/8", border: "border-success/30", badge: "bg-success/15 text-success", icon: CheckCircle, iconColor: "text-success" },
  amarillo: { bg: "bg-warning/8", border: "border-warning/30", badge: "bg-warning/15 text-warning", icon: AlertTriangle, iconColor: "text-warning" },
  naranja: { bg: "bg-orange-50", border: "border-orange-200", badge: "bg-orange-100 text-orange-700", icon: AlertTriangle, iconColor: "text-orange-500" },
  rojo: { bg: "bg-destructive/8", border: "border-destructive/30", badge: "bg-destructive/15 text-destructive", icon: AlertTriangle, iconColor: "text-destructive" },
};

function AlertRow({ alert }) {
  const cfg = levelConfig[alert.level] || levelConfig.verde;
  const Icon = cfg.icon;
  const from = new Date(alert.validFrom);
  const to = new Date(alert.validTo);
  return (
    <div className={`rounded-xl border p-3.5 ${cfg.bg} ${cfg.border} transition-all`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${cfg.iconColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>{alert.levelLabel}</span>
            <span className="text-xs font-medium text-foreground">{alert.phenomenon}</span>
          </div>
          <p className="text-xs text-muted-foreground font-medium mb-0.5">{alert.area}</p>
          <p className="text-sm text-foreground leading-relaxed">{alert.description}</p>
          <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>{format(from, "EEE dd/MM HH:mm", { locale: es })} — {format(to, "EEE dd/MM HH:mm", { locale: es })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AemetHistory({ alerts = [] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? alerts : alerts.slice(0, 6);
  const countBy = (lvl) => alerts.filter((a) => a.level === lvl).length;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-space font-semibold text-foreground text-lg">Historial de Avisos AEMET</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Últimos avisos recibidos por API</p>
        </div>
        <a href="https://www.aemet.es/documentos_d/eltiempo/prediccion/avisos/rss/CAP_AFAZ771204_RSS.xml" target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline font-medium">
          RSS Castellón Litoral Sur →
        </a>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { label: "Rojos", count: countBy("rojo"), cls: "bg-destructive/10 text-destructive border-destructive/20" },
          { label: "Naranja", count: countBy("naranja"), cls: "bg-orange-50 text-orange-700 border-orange-200" },
          { label: "Amarillo", count: countBy("amarillo"), cls: "bg-warning/10 text-warning border-warning/20" },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl border p-3 text-center ${s.cls}`}>
            <p className="text-2xl font-bold font-space">{s.count}</p>
            <p className="text-xs font-medium mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {alerts.length === 0 ? (
        <div className="rounded-xl border p-4 text-sm text-muted-foreground bg-white">Sin historial disponible desde API en este momento.</div>
      ) : (
        <>
          <div className="space-y-2.5">{visible.map((a) => <AlertRow key={a.id} alert={a} />)}</div>
          {alerts.length > 6 && (
            <button onClick={() => setExpanded((v) => !v)} className="mt-4 w-full flex items-center justify-center gap-2 text-sm text-primary font-medium hover:underline py-2">
              {expanded ? <><ChevronUp className="w-4 h-4" /> Mostrar menos</> : <><ChevronDown className="w-4 h-4" /> Ver más avisos</>}
            </button>
          )}
        </>
      )}
    </section>
  );
}
