import WindArrow from "./WindArrow";

function windBg(speed) {
  if (speed <= 8)  return "bg-sky-100 text-sky-700";
  if (speed <= 14) return "bg-green-100 text-green-700";
  if (speed <= 20) return "bg-yellow-100 text-yellow-700";
  if (speed <= 28) return "bg-orange-100 text-orange-700";
  return "bg-red-100 text-red-700";
}

function waveBg(h) {
  if (h <= 0.3) return "text-success";
  if (h <= 0.7) return "text-warning";
  if (h <= 1.2) return "text-orange-500";
  return "text-destructive";
}

export default function WindguruTable({ data }) {
  const allSlots = ["02h", "08h", "14h", "20h"];

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-space font-semibold text-foreground text-lg">Tabla de Pronóstico</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
            Modelo: {data.model}
          </span>
          <a
            href="https://www.windguru.cz/49374"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline font-medium"
          >
            WindGuru →
          </a>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/60">
                <th className="text-left p-3 pl-4 font-semibold text-muted-foreground text-xs w-20">Día / Hora</th>
                {data.rows.map((row) =>
                  row.slots.map((slot) => (
                    <th
                      key={`${row.date}-${slot.hour}`}
                      className="p-2 text-center font-medium text-xs text-muted-foreground min-w-[64px]"
                    >
                      <div className="font-semibold text-foreground">{row.date}</div>
                      <div>{slot.hour}</div>
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {/* Wind speed row */}
              <tr className="border-t border-border/50">
                <td className="p-3 pl-4 text-xs font-semibold text-muted-foreground whitespace-nowrap">
                  Viento (kn)
                </td>
                {data.rows.map((row) =>
                  row.slots.map((slot) => (
                    <td key={`wind-${row.date}-${slot.hour}`} className="p-2 text-center">
                      <span className={`inline-block px-2 py-1 rounded-lg text-xs font-bold ${windBg(slot.wind)}`}>
                        {slot.wind}
                      </span>
                    </td>
                  ))
                )}
              </tr>

              {/* Gust row */}
              <tr className="border-t border-border/50 bg-muted/20">
                <td className="p-3 pl-4 text-xs font-semibold text-muted-foreground whitespace-nowrap">
                  Racha (kn)
                </td>
                {data.rows.map((row) =>
                  row.slots.map((slot) => (
                    <td key={`gust-${row.date}-${slot.hour}`} className="p-2 text-center">
                      <span className="text-xs text-muted-foreground font-medium">{slot.gust}</span>
                    </td>
                  ))
                )}
              </tr>

              {/* Direction row */}
              <tr className="border-t border-border/50">
                <td className="p-3 pl-4 text-xs font-semibold text-muted-foreground whitespace-nowrap">
                  Dirección
                </td>
                {data.rows.map((row) =>
                  row.slots.map((slot) => (
                    <td key={`dir-${row.date}-${slot.hour}`} className="p-2 text-center">
                      <div className="flex justify-center">
                        <WindArrow
                          direction={slot.dir}
                          size={24}
                          color="hsl(213,80%,40%)"
                        />
                      </div>
                    </td>
                  ))
                )}
              </tr>

              {/* Waves row */}
              <tr className="border-t border-border/50 bg-muted/20">
                <td className="p-3 pl-4 text-xs font-semibold text-muted-foreground whitespace-nowrap">
                  Ola (m)
                </td>
                {data.rows.map((row) =>
                  row.slots.map((slot) => (
                    <td key={`wave-${row.date}-${slot.hour}`} className="p-2 text-center">
                      <span className={`text-xs font-bold ${waveBg(slot.waves)}`}>{slot.waves}</span>
                    </td>
                  ))
                )}
              </tr>

              {/* Period row */}
              <tr className="border-t border-border/50">
                <td className="p-3 pl-4 text-xs font-semibold text-muted-foreground whitespace-nowrap">
                  Período (s)
                </td>
                {data.rows.map((row) =>
                  row.slots.map((slot) => (
                    <td key={`period-${row.date}-${slot.hour}`} className="p-2 text-center">
                      <span className="text-xs text-muted-foreground">{slot.period}s</span>
                    </td>
                  ))
                )}
              </tr>

              {/* Temp row */}
              <tr className="border-t border-border/50 bg-muted/20">
                <td className="p-3 pl-4 text-xs font-semibold text-muted-foreground whitespace-nowrap">
                  Temp (°C)
                </td>
                {data.rows.map((row) =>
                  row.slots.map((slot) => (
                    <td key={`temp-${row.date}-${slot.hour}`} className="p-2 text-center">
                      <span className="text-xs text-foreground font-medium">{slot.temp}°</span>
                    </td>
                  ))
                )}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 p-4 border-t border-border/50 bg-muted/20">
          <span className="text-xs text-muted-foreground font-medium">Viento:</span>
          {[
            { label: "≤8 kn", cls: "bg-sky-100 text-sky-700" },
            { label: "9–14 kn", cls: "bg-green-100 text-green-700" },
            { label: "15–20 kn", cls: "bg-yellow-100 text-yellow-700" },
            { label: "21–28 kn", cls: "bg-orange-100 text-orange-700" },
            { label: ">28 kn", cls: "bg-red-100 text-red-700" },
          ].map((l) => (
            <span key={l.label} className={`text-xs px-2 py-0.5 rounded font-medium ${l.cls}`}>
              {l.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}