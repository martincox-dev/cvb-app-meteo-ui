import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart, Bar } from "recharts";

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-border shadow-card rounded-xl px-4 py-3 text-sm">
        <p className="font-semibold text-foreground mb-2">{label}</p>
        {payload.map((entry, i) => (
          <p key={i} style={{ color: entry.color }} className="font-medium">
            {entry.name}: {entry.value} kn
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function HourlyChart({ hourly }) {
  return (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <h3 className="font-space font-semibold text-foreground mb-4">Viento Horario — Hoy</h3>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={hourly} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="windGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(213,80%,40%)" stopOpacity={0.15} />
              <stop offset="95%" stopColor="hsl(213,80%,40%)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(210,15%,92%)" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 11, fill: "hsl(215,15%,50%)" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "hsl(215,15%,50%)" }}
            tickLine={false}
            axisLine={false}
            domain={[0, 'auto']}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="wind"
            name="Viento"
            stroke="hsl(213,80%,40%)"
            strokeWidth={2.5}
            fill="url(#windGrad)"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="gust"
            name="Racha"
            stroke="hsl(196,80%,45%)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-3 justify-center text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-primary rounded inline-block" /> Viento (kn)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 border-t border-dashed border-accent rounded inline-block" /> Racha (kn)
        </span>
      </div>
    </div>
  );
}