const WINDGURU_STATIONS = {
  "1305": "https://www.windguru.cz/station/1305",
  "2706": "https://www.windguru.cz/station/2706",
};

export default function WindguruWidget({ stationId, title }) {
  const baseUrl = WINDGURU_STATIONS[String(stationId)] || `https://www.windguru.cz/station/${stationId}`;

  return (
    <article className="bg-white rounded-xl border border-border/60 shadow-card overflow-hidden">
      <header className="px-4 py-3 border-b border-border/50 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <a
          href={baseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline font-medium whitespace-nowrap"
        >
          Abrir Windguru
        </a>
      </header>
      <div className="px-4 py-5 bg-muted/20">
        <p className="text-sm text-muted-foreground">
          Windguru bloquea la carga embebida en <code>iframe</code> en dominios externos.
        </p>
        <a
          href={baseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex mt-3 text-sm text-primary hover:underline font-medium"
        >
          Abrir estación {stationId} en Windguru
        </a>
      </div>
    </article>
  );
}
